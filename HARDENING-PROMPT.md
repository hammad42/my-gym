# MyGym hardening — audit request

> Paste this whole file into the session. It is self-contained.
> Everything under "Already verified" was checked by reading this repo on
> 2026-09-16 — treat it as established, not as work to redo.

## What this project is

`mygym-pwa` — a local-first workout tracker. React 18 + Vite + TypeScript +
Tailwind + Dexie (IndexedDB) + `dexie-react-hooks`. Optional Google Sheets
backup through a Google Apps Script webhook. Service worker in `public/sw.js`
stamped per build by `scripts/version-sw.mjs`. Deployed to Cloudflare Workers
Static Assets (`wrangler.toml`, `not_found_handling = "single-page-application"`)
via `.github/workflows/deploy-cloudflare.yml`.

Dexie tables: `exercises`, `routines`, `routineExercises`, `sessions`, `sets`,
`settings`.

**There is no PIN/security module, no OCR, and no receipt/photo storage.** Do
not invent work in those areas.

## Already verified good — do not redo or "fix"

Reading the source confirmed these are handled. Leave them alone; if you change
them, you must justify the specific failure the change prevents:

- **CSP includes the Apps Script response host.** `public/_headers`,
  `netlify.toml`, and `vercel.json` all list `https://script.google.com` **and**
  `https://script.googleusercontent.com`. This is the flaw that caused
  "Failed to fetch" while data still reached the sheet in a sibling project —
  it is **not** present here.
- **The service worker ignores cross-origin requests.** `public/sw.js` compares
  `new URL(event.request.url).origin !== self.location.origin` and returns
  early, so authenticated Google responses are never cached.
- **No secret-in-URL fallback.** `src/lib/googleSheets.ts` contains no
  `?key=` query-string auth path.
- **Script version detection exists.** The template emits `scriptVersion` and
  supports a keyless `?action=ping`; `APPS_SCRIPT_PROTOCOL_VERSION` is defined.
- **The backup is uploaded in parts, not one cell.** `syncStart` / `syncPart` /
  `syncCommit` / `readParts` append parts as rows and read them back by
  concatenation. The 50,000-character single-cell limit is therefore already
  avoided — do not "add chunking"; it exists in a different shape.
- **Restores preserve this device's credential.** `mergeRestoredSettings` in
  `src/lib/sanitize.ts` keeps the local `secretKey`, clamps `weekly_goal` and
  `default_rest_seconds` to UI ranges, and documents which fields travel with
  the data vs. with the device. This is good; keep the pattern.
- **Restores are confirmed before replacing.** `handleImportFile` shows a
  pending-import summary (session/set counts) instead of writing immediately,
  and clear/reset have confirm states.
- **The auto-sync effect does not loop on failure.** Its dependency array uses
  narrow primitives (`enabled`, `webAppUrl`, `autoSyncTwiceDaily`, `lastSyncTime`,
  `defer`) and it reads live data through `dataRef`, so writing an error status
  does not re-trigger the effect. **Do not add backoff for a loop that is not
  happening** — verify before touching this file.

---

## Part 1 — Confirmed gaps (fix these)

Each was confirmed by reading the code below. Reproduce, then fix.

### 1. Mobile backup download is broken by a race (highest user impact)

`src/lib/exportImport.ts:58-68` — `downloadBackup` calls
`URL.revokeObjectURL(url)` **synchronously** right after `a.click()`. On iOS
Safari and installed PWAs this races the download start, and the anchor-download
trick is unreliable there anyway, so "Export backup" appears to do nothing.

In a sibling project the same pattern was the reported symptom "one-tap backup
export not working". Fix:
- revoke the object URL on a **delay** (≈10s), never synchronously;
- when `navigator.canShare({ files })` is available, use the Share sheet (its
  "Save to Files" action) instead of the anchor — on iOS the anchor silently
  no-ops;
- set `a.rel = 'noopener'` and hide/remove the anchor properly.

Add a test asserting `revokeObjectURL` is **not** called synchronously (the
existing expectations may assert the opposite — update them, and say so).

### 2. Backup validation is too weak to protect the database

`src/lib/exportImport.ts:45-55` — `isBackupPayload` checks `app === 'mygym'` and
that `exercises`, `routines`, `sessions`, `sets` are arrays. Two problems:

- **`routine_exercises` is in `BackupPayload` but never validated.** A file
  missing it passes the guard and then restore hands `undefined` to whatever
  consumes it.
- **There is no per-row validation at all.** Any object with the right top-level
  shape gets written straight into IndexedDB. Compare with the sibling project,
  which validates every account/transaction/budget row and refuses unsafe ones
  (e.g. a transfer with no destination, impossible dates, non-finite amounts).

Fix: a strict validator that runs **before** anything is cleared or written,
validates every row's required fields and types (ids, dates as real calendar
dates, finite numbers, weight/reps bounds, referential integrity from
`sets → sessions`, `routineExercises → routines/exercises`), drops bad rows with
**named warnings shown to the user**, and is used by **both** the file-import and
the Sheets-restore paths. Today `handleRestoreFromSheets`
(`src/screens/SetupScreen.tsx:168-201`) calls `restoreFromBackup(res.data, ...)`
with the raw response — route it through the same validator.

Watch for the silent-rollover trap while you are here: `new Date('2026-99-99')`
is invalid but `new Date(2026, 1, 31)` silently becomes March 3. Reject
impossible dates explicitly.

### 3. The Apps Script clears the backup before the new one exists

`src/lib/googleSheets.ts` — `syncStart` does `backup.clear()` and then the
client streams `syncPart` rows into it. If the upload dies partway (bad
connection, script quota, tab closed), the sheet is left holding a **partial or
empty backup and the previous good one is gone**. This is the multi-part version
of clear-before-write, and it is the most dangerous flaw in the sync path.

Fix (mirror the sibling project's approach):
- write the incoming parts to a **staging** sheet and swap it into `_MyGymBackup`
  only after `syncCommit` succeeds, deleting the old sheet last;
- or version the snapshot (generation marker) so a partially written run is
  never treated as the current backup, and `readBackup` refuses an incomplete
  one instead of returning it.

### 4. Concurrent writers can interleave and corrupt the backup

There is no `LockService` in the template (`grep -c LockService` → 0). Two
devices or two browser tabs syncing at once can interleave `clear()` and the
appended parts. Wrap the whole write in
`LockService.getScriptLock(); lock.waitLock(30000); try { ... } finally { lock.releaseLock(); }`.

### 5. User text is written into cells as live formulas

There is no `safeText` helper (`grep -c safeText` → 0), so workout names, notes,
exercise names and routine names reach `setValues`/`setValue` raw. Values
starting with `= + - @` execute as formulas in Google Sheets, and a CSV-quoted
cell does **not** prevent it. Add a helper that prefixes an apostrophe (forcing
literal text) for every text cell, on every sheet the script writes, and keep
numeric columns numeric.

Note this is a **data-integrity/security** issue, not cosmetic: it triggers when
someone opens the sheet, and the same text can arrive from an imported backup
file or a shared routine.

### 6. Two CI workflows both deploy on every push

`.github/workflows/deploy-cloudflare.yml` (`cloudflare/wrangler-action@v3`,
`command: deploy`) and `.github/workflows/deploy.yml` (Netlify,
`npx netlify-cli deploy --prod --dir=dist`) both trigger on push. Cloudflare is
the host; the Netlify workflow is dead weight that can fail noisily or
double-deploy. Confirm with me which is authoritative, then delete the other,
along with the now-unused `netlify.toml` and any `.netlify/` directory.
`vercel.json` is likewise unused — say so rather than deleting it silently.

### 7. The detected script version is never shown to the user

`src/lib/googleSheets.ts` can report `scriptVersion`, but
`grep -n scriptVersion src/screens/SetupScreen.tsx` finds nothing — so the
detected version is computed and then not surfaced anywhere. This matters because
of the classic Apps Script trap: **editing the script editor does not change what
the `/exec` URL runs.** Changing the deployed code requires
Deploy → Manage deployments → pencil → **Version: New version** → Deploy, and the
URL never changes. A user who pasted new code and skipped that step looks
completely up to date and is not.

Fix: on Test Connection, detect the version, persist it, and show it in Settings:
"Apps Script vN — up to date" / "vN deployed, but vM is current" with the exact
redeploy steps and an explicit note that the URL does not change. Record the
version **even when the auth test fails** — "old script deployed" is frequently
the actual cause of a failure whose editor code looks current.

The sibling project just shipped exactly this; reuse the approach.

---

## Part 2 — Verify before you touch (do not assume)

Report a finding for each of these; fix only what you can demonstrate.

1. **Does Workers Static Assets actually serve `public/_headers`?** `_headers`
   is a Cloudflare **Pages** convention. This project deploys as **Workers
   Static Assets** from `dist/`, and a previous commit removed `_redirects` in
   favour of `wrangler.toml` routing — which suggests header/redirect handling
   was already found unreliable here. **Check the live response**, not the file:
   `curl -sI https://<your-worker-host>/ | grep -i content-security-policy`.
   If nothing comes back, the app is running with **no CSP at all** — which would
   also explain why sync works while leaving the app unprotected. That is a
   finding worth reporting precisely.
2. **Is there a first-upload guard on auto-backup?** `isBackupDue(undefined)`
   returns true, so a freshly configured URL with auto-sync enabled may upload
   immediately. If auto-sync defaults to on, someone who pastes a URL in order to
   **recover** an existing backup can overwrite it with this device's demo data.
   Check the default and whether anything blocks the first automatic upload.
3. **Does the restore path re-point the sync destination?** Confirm that an
   incoming `settings.google_sheets.webAppUrl` from an untrusted backup file
   cannot silently redirect future uploads. (`mergeRestoredSettings` preserves
   the local *secret*; verify what it does with the *URL*.)
4. **Is a Sheets restore gated the same way as a file restore?** The file path
   shows a confirmation; confirm the Sheets path does too, and that a failed or
   partial response cannot clear live data.
5. **Exercise-restore safety** (`handleRestoreExercise`,
   `src/screens/SetupScreen.tsx:287`): confirm it cannot duplicate or overwrite an
   existing exercise's logged sets.

---

## Part 3 — Standards to follow

1. **Evidence before claims.** Reproduce each bug before asserting a root cause.
   Separate *verified*, *source-confirmed but not executed*, and *hypothesis*.
   Never present the third as the first.
2. **Charge each change to a cause.** If you cannot describe the failure a change
   prevents, do not make it. In particular: do not add retry/backoff to the
   auto-sync effect (see "Already verified") and do not re-add chunking to the
   Apps Script (parts already exist).
3. **Regression tests must be non-vacuous** — they must fail on the old code and
   pass on the new. Then run the **whole** suite (`npm test`), not just your file,
   and report the before → after count. Current suite is ~270 tests across
   `src/test/*`; do not let that number drop.
4. **Fail safe, not silent.** Prefer refusing an action with a clear message over
   a fallback that quietly does the wrong thing.
5. **Atomic writes for anything user-visible.** Write new, verify, then swap.
   Never clear before you can replace. (This is the core of gap #3.)
6. **Honest UI state.** Do not show "Connected" for a saved URL you have not
   authenticated. When something is unknown, say "unknown".
7. **Report truthfully.** If a test fails, say so with the output. If a step was
   skipped or unverifiable (no iPhone, no production credentials), say that
   plainly instead of implying it works.

---

## Part 4 — Verification I expect

Give, per fix, the cheapest evidence that actually proves it:

- **Tests:** command + result counts, plus the assertion that would have failed
  before your change.
- **Build:** `npm run build` passes (it runs `tsc`, so type errors block it).
- **Live deployment** — against the real URL, not the source:
  - `curl -sI <url> | grep -i content-security-policy` (see Part 2 item 1)
  - `curl -s <url>/sw.js | grep -o 'mygym-pwa-[a-f0-9]*'` and confirm it matches
    the cache name your build stamped
  - grep the deployed bundle for a distinctive string from your fix
- **Behavioral:** drive the real browser for UI flows — click Export and assert
  the download event fires, import a deliberately corrupt backup and assert it is
  rejected with the reason shown, run a sync and inspect the sheet.
- **Google side:** if you change the Apps Script, say plainly that I must
  re-copy it into Apps Script and deploy a **New version**, and give the exact
  steps. Consider making the script report its own protocol version so this is
  verifiable rather than assumed.

Do not describe an unverified deployment as working.

---

## Part 5 — Deliverables

1. **Audit report** — findings grouped P1 (release-blocking) / P2 (meaningful) /
   P3 (polish), each with file:line, the failure it causes, and its evidence;
   plus a short "already good here" section, because a list of only problems
   misrepresents the codebase. Include Part 2's verification answers even where
   the answer is "no issue found".
2. **Fixes** — logical commits whose messages state the failure prevented, not
   the function touched.
3. **Test count delta** — before → after, with the full suite passing.
4. **Device test checklist** — each fix as a numbered test with steps and an
   explicit ✅ pass / ❌ fail, written so a condition **cannot pass for the wrong
   reason** (e.g. do not say "the backup has several rows" when a small backup
   legitimately has one). Do not list code-level guarantees as if I could provoke
   them on a phone.
5. **"What no deploy can do for you"** — the manual steps, stated explicitly and
   with the reason (here: re-pasting/redeploying the Apps Script, and reopening
   the app twice so the new service worker activates).

**Start with the audit. Do not change code until I approve the findings.**

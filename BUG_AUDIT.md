# MyGym — Bug Audit & Remediation Reference

**Document version:** 2.1
**Last updated:** 2026-09-15
**Codebase revision:** `2b28e36` + Part 2 fixes (all 282 tests passing across 11 suites)
**Auditor:** automated deep-QA pass (static review + test suite + live-browser verification)

---

## 0. How to use this document

This file is written to be processed by an LLM (or a new developer) **without reading the rest of the repository first**.

- **Part 1** lists bugs that were found in the first audit round. **All 16 are FIXED.** Do not re-fix them. Each entry records the root cause and the applied fix so you can understand the current design and avoid regressing it.
- **Part 2** lists bugs found in the second audit round. **All 13 are FIXED.** Each entry records the root cause, applied fix, and regression tests in `src/test/audit_part2_fixes.test.tsx` (and `src/test/audit_fixes.test.tsx`).
- **Section 3** lists behaviours that *look* like bugs but are deliberate. Read this before "fixing" anything that seems wrong.
- **Section 4** contains conventions and hard-won gotchas (Dexie, the Google Sheets protocol, build/deploy). Violating these has already caused real defects.

**Document layout:** Section 0 (this) → 1 Project context → 2 Severity index → **Part 1** fixed bugs → **Part 2** fixed bugs → 3 Intentional behaviours → 4 Conventions & gotchas → 5 Test coverage → 6 Roadmap → Appendix.

---

## 1. Project context

### 1.1 What the product is

**MyGym** is an offline-first, local-first gym workout planner and logger, delivered as an installable PWA. There is no backend and no user account: all data lives in the browser's IndexedDB. A single optional cloud feature (Google Sheets backup) is opt-in and pushes a copy to a spreadsheet the user owns.

Two ways to install: open the URL in a mobile browser and "Add to Home Screen", or just use it in the browser.

| Item | Value |
|---|---|
| Live app | `https://my-gym-hammad42.netlify.app` |
| Repository | `https://github.com/hammad42/my-gym` |
| Hosting | Netlify (production), auto-deployed from `main` |
| CI/CD | `.github/workflows/deploy.yml` — runs tests, builds, deploys on every push to `main` |
| Google Sheet webhook | Apps Script Web App, protocol **v2** (chunked upload) |

### 1.2 Technology stack

| Layer | Technology |
|---|---|
| UI | React 18, TypeScript (strict), Vite 6 |
| Styling | Tailwind CSS 3, dark theme, mobile-first (max-width 448px shell) |
| Icons | lucide-react |
| Persistence | Dexie 4 over IndexedDB, database name `GymDatabase` |
| Reactive queries | `dexie-react-hooks` → `useLiveQuery` |
| Tests | Vitest 3 + jsdom + fake-indexeddb + @testing-library/react |
| PWA | Hand-written service worker (`public/sw.js`), build-stamped cache name |
| Backup protocol | Google Apps Script Web App, JSON over POST, chunked at 30,000 chars |

### 1.3 Architecture at a glance

```
src/
├─ App.tsx                  screen router, useLiveQuery wiring, nav guard, storage-failure banner
├─ main.tsx                 React root + service-worker registration
├─ registerServiceWorker.ts dev: unregister SW; prod: register
├─ index.css                Tailwind layers, safe-area helpers, .tnum
├─ types/
│  └─ index.ts              all domain types + estimateOneRepMax + volumeOf
├─ lib/
│  ├─ db.ts                 Dexie schema, seeding, atomic writes, restore, unit migration
│  ├─ drafts.ts             in-progress workout draft persistence (Dexie v2 table)
│  ├─ workout.ts            the stats engine: resolution, summaries, streaks, PRs, series
│  ├─ formatters.ts         date/duration/weight/volume/clock formatting
│  ├─ sampleData.ts         default exercises, routines, 6 weeks of demo history
│  ├─ sanitize.ts           credential stripping + restore-merge semantics
│  ├─ exportImport.ts       JSON backup build/validate/download
│  └─ googleSheets.ts       sync client, chunking, Apps Script template, version detection
├─ hooks/
│  └─ useGoogleSheetsAutoSync.ts   12-hour background sync
├─ components/              Header, BottomNav, ExerciseIcon, RoutineEditor
├─ screens/                 Home, LogWorkout, History, Routines, Progress, Setup
└─ test/                    10 suites, 262 tests
```

**Screen flow:** six screens — `home`, `history`, `add` (log a workout), `routines`, `progress`, `setup`. Only the active screen is mounted (screen identity is persisted in `localStorage` under `mygym_active_screen`). Every screen except the Log screen holds its transient state in `useState` only, so local state resets on tab switch (see A12).

### 1.4 Data model (IndexedDB, Dexie)

Database `GymDatabase`, declared versions **v1** and **v2** (v2 adds `drafts`; additive upgrade, no data loss).

| Table | Primary key | Indexes | Purpose |
|---|---|---|---|
| `exercises` | `id` | `name, muscle_group, equipment, is_default, is_archived` | exercise library |
| `routines` | `id` | `name, is_archived` | workout templates |
| `routine_exercises` | `id` | `routine_id, exercise_id, order` | planned lines inside a routine |
| `sessions` | `id` | `date, routine_id, created_at` | one logged workout |
| `sets` | `id` | `session_id, exercise_id, set_number, created_at` | one logged set |
| `settings` | `id` (always `'general'`) | — | preferences + Sheets config |
| `drafts` | `id` (always `'active'`) | `updatedAt` | the in-progress workout (v2) |

Key field semantics:

- `SetLog.weight` — a **dimensionless float**. There is no per-row unit tag; the active unit lives in `settings.weight_unit`. This is the root of BUG-02 and A2.
- `SetLog.is_warmup` — excluded from volume, reps and personal records; **counted** in set totals (deliberate — see Section 3).
- `SetLog.reps` — also used to store *seconds/minutes* for time-based exercises such as Plank and Treadmill (the root of A7).
- `Settings.google_sheets.secretKey` — a credential. Must never be persisted into the sheet, an export, or an imported payload (see Section 3.2).

### 1.5 Commands

```bash
npm install          # install dependencies
npm run dev          # dev server on http://localhost:5174
npm test             # vitest run — 282 tests across 11 suites
npm run build        # tsc --noEmit + vite build + stamp sw.js cache version
npm run preview      # serve the production build locally
```

There is no linter configured; `tsc` (strict, `noUnusedLocals`) is the static gate and `npm run build` runs it.

### 1.6 Key invariants (do not break these)

1. **Warm-up sets** are excluded from `totalVolume`, `totalReps`, per-muscle-group volume, and PRs — but count toward set totals. All four aggregates must agree; there is a test asserting session volume == week volume == muscle-group volume.
2. **The Sheets `secretKey` never leaves the device inside a payload.** It rides only as the top-level auth field of a request. It must be stripped from JSON exports, from the copy of settings stored in the sheet, and must never be adopted from an imported/restored payload.
3. **Restores never destroy the device's credentials.** `mergeRestoredSettings` always keeps the local secret.
4. **The webhook fails closed.** The Apps Script refuses every request until `SECRET_KEY` is changed from the shipped placeholder.
5. **The client must never send v2 partitioned actions to a v1 script.** A v1 script has no unknown-action guard and would treat `sync-start` as a whole-sync with no data, clearing the sheets and reporting success. Protocol version is probed before choosing (see BUG-14).
6. **Writes that touch multiple tables are transactional** (`db.transaction('rw', [...])`), e.g. `saveWorkout`, `deleteSession`, `saveRoutineExercises`, `restoreFromBackup`.

---

## 2. Severity index

Severity reflects user impact, not effort: **Critical** = unrecoverable data loss or silently wrong data presented as correct; **High** = data loss or wrong data with a plausible trigger; **Medium** = degraded behaviour, or a trap that bites later; **Low** = rough edges and hygiene.

### Part 1 — Fixed (first audit round)

| ID | Title | Severity | Status |
|---|---|---|---|
| BUG-01 | In-progress workout destroyed by any navigation | Critical | Fixed |
| BUG-02 | Unit switch relabelled history instead of converting | Critical | Fixed |
| BUG-03 | JSON import replaced all data with no confirmation | High | Fixed |
| BUG-04 | Rest timer silent, drifts, dies on navigation | High | Fixed |
| BUG-05 | No unsaved-changes guard when leaving the log screen | High | Fixed |
| BUG-06 | Warm-up sets inflated volume totals | Medium | Fixed |
| BUG-07 | Future dates accepted silently | Medium | Fixed |
| BUG-08 | Restore/import reverted the device's preferences | Medium | Fixed |
| BUG-09 | Auto-sync could fire mid-workout | Medium | Fixed |
| BUG-10 | Private-browsing storage failure was silent | Low | Fixed |
| BUG-11 | Duration forced to 1 minute; decimal reps truncated | Low | Fixed |
| BUG-12 | Restored `weekly_goal` was unclamped | Low | Fixed |
| BUG-13 | Stale `pendingRoutineId` after finishing a workout | Low | Fixed |
| BUG-14 | Google Sheets sync broken in real browsers (CSP + service worker) | Critical | Fixed |
| BUG-15 | Sheets sync died once the log exceeded ~50 KB | Critical | Fixed |
| BUG-16 | v2 client would have made a v1 script silently blank the sheets | Critical | Fixed |

### Part 2 — Fixed (second audit round)

| ID | Title | Severity | Status |
|---|---|---|---|
| A1 | Stale draft can silently swallow logged sets after a restore | High | Fixed |
| A2 | Unit conversion is not atomic, so it can mislabel everything | High | Fixed |
| A3 | Auto-sync effect thrashes; its 15-minute interval never fires | Medium | Fixed |
| A4 | Manual syncs have no offline guard; offline failures show as errors | Medium | Fixed |
| A5 | Archiving an exercise is a one-way door (no un-archive) | Medium | Fixed |
| A6 | Epley 1RM has no rep ceiling | Medium | Fixed |
| A7 | Time-based exercises are modelled as reps | Low | Fixed |
| A8 | Floating promise in the Dexie `populate` handler | Low | Fixed |
| A9 | Duplicate exercise blocks merge (set numbering per exercise) | Low | Fixed |
| A10 | No React error boundary — one render error bricks the app | Low | Fixed |
| A11 | `SetLog.notes` is write-only (dead field) | Low | Fixed |
| A12 | Non-Log screens lose state on tab switch (no per-screen state) | Low | Fixed |
| A13 | `sliceBySize` casts away the discriminated union | Low | Fixed |

Totals: **Part 1** 16 fixed (5 Critical, 3 High, 4 Medium, 4 Low). **Part 2** 13 fixed (2 High, 4 Medium, 7 Low). Overall: **29 bugs audited and resolved (0 open)**.

---

## Part 1 — Fixed bugs (context for the current design)

Keep these as design rationale. Each entry: root cause → applied fix. Section 5 names the test that guards it.

### BUG-01 — In-progress workout destroyed by any navigation · Critical · FIXED
**Symptom:** filling six sets, tapping History to check a past PR, then returning to Log = everything gone; likewise on refresh.
**Root cause:** all logging state was `useState` in `LogWorkoutScreen`, which unmounts on tab change.
**Fix:** added the Dexie **v2 `drafts` table** plus `src/lib/drafts.ts`. The screen auto-saves on every change and restores on mount, showing a "Resumed your unfinished workout" banner with a **Start fresh** action. The draft is cleared on successful save. `draftHasContent()` prevents persisting an untouched form.
**Related open work:** the restore path does not validate exercise ids → **A1**.

### BUG-02 — Unit switch relabelled history instead of converting · Critical · FIXED
**Symptom:** logging 80 kg for six months then switching to lb displayed "80 lb"; all volume and progression numbers became wrong.
**Root cause:** `SetLog.weight` is a dimensionless float; `weight_unit` was presentation-only.
**Fix:** `convertStoredWeights(target)` in `db.ts` rewrites every set weight and session body weight in one transaction (rounding to 2 dp so kg→lb→kg round-trips within 0.01). The Settings toggle opens a confirmation explaining the rewrite and the converted row count is reported.
**Related open work:** the conversion and the label write are still two transactions → **A2**.

### BUG-03 — JSON import replaced all data with no confirmation · High · FIXED
**Root cause:** the file input's `onChange` called `restoreFromBackup` immediately.
**Fix:** the parsed file is staged in `pendingImport` state and a confirmation panel shows what will be replaced ("holds N session(s)… replaces the M session(s) on this device"). Nothing is written until confirmed. Content validation was already sound (`isBackupPayload`).

### BUG-04 — Rest timer silent, drifts, dies on navigation · High · FIXED
**Root cause:** `setInterval(() => setRestRemaining(r => r - 1), 1000)` — a decrementing counter, no feedback, cleared on unmount.
**Fix:** the timer is now **deadline-based** (`deadlineRef` holds an absolute timestamp; each tick recomputes from `Date.now()`), so background throttling and screen sleep cannot drift it. On completion it fires `signalRestComplete()` (Web Audio tone + `navigator.vibrate`). The deadline is persisted in the draft as `restDeadline`, so a rest survives navigation and resumes with the correct remaining time — an already-expired rest does not resume or beep.
**Known limitation:** on iOS Safari the tone may not play because the audio context is created outside a user gesture; vibration works on Android. Capturing an audio context on the first tap would fix it.

### BUG-05 — No unsaved-changes guard · High · FIXED
**Fix:** `navigateWithGuard()` in `App.tsx` intercepts every screen change; the Log screen reports dirtiness via `onDirtyChange`. Leaving a dirty workout asks `window.confirm` (native dialog — functional but visually inconsistent with the app; a styled modal is a pending polish item).

### BUG-06 — Warm-up sets inflated volume · Medium · FIXED
**Root cause:** `summarizeSession`, `summarizeWeek` and `volumeByMuscleGroup` summed `volumeOf()` over all sets, while the PR engine and progression series already skipped warm-ups — so the app contradicted itself.
**Fix:** all three now `continue` on `is_warmup`, giving one consistent rule. **Expected, intentional side effect:** weekly volume drops ~10–15 % for sessions that logged a warm-up. Set counts are unaffected.

### BUG-07 — Future dates accepted · Medium · FIXED
**Fix:** `max={today}` on the date input plus a submit guard (`if (date > today)`) with a clear error. Relevant because week buckets are date-driven, so a future session would have counted toward a week that had not happened.

### BUG-08 — Restore reverted the device's preferences · Medium · FIXED
**Root cause:** `mergeRestoredSettings` spread all incoming settings over the current row.
**Fix:** explicit field-by-field semantics — `google_sheets`: local credential always wins; `weight_unit`: **the backup wins** (the unit describes the incoming weights, so keeping the device's label would mislabel every restored set); `weekly_goal` / `default_rest_seconds`: **the device wins** (preferences of the person holding the phone, not properties of the data) and both are clamped (1–14, 15–600 s). This is deliberate — see Section 3.3.

### BUG-09 — Auto-sync could fire mid-workout · Medium · FIXED
**Fix:** `useGoogleSheetsAutoSync(..., defer)` is passed `activeScreen === 'add'`, so a background upload cannot start while logging.
**Related open work:** the effect's dependency array still causes it to re-run on every write → **A3**.

### BUG-10 — Private-browsing storage failure was silent · Low · FIXED
**Fix:** a failure from `initializeDatabase()` sets `storageFailed`, rendering a red banner explaining that local storage is unavailable and workouts cannot be saved on this device.

### BUG-11 — Duration forced to 1 minute; decimal reps truncated · Low · FIXED
**Root cause:** `Math.max(1, parseInt(duration, 10) || 0)` and `parseInt(s.reps, 10)`.
**Fix:** duration is `0–900` (a cardio-only entry may legitimately be 0), reps accept decimals (`step="any"`, stored rounded to 2 dp), and a shared `num()` helper parses non-negative values consistently for volume and save.

### BUG-12 — Restored `weekly_goal` unclamped · Low · FIXED
**Fix:** `clamp()` inside `mergeRestoredSettings` bounds the weekly goal (1–14) and rest timer (15–600 s), and ignores a non-numeric or bogus `weight_unit`.

### BUG-13 — Stale `pendingRoutineId` · Low · FIXED
**Fix:** `onDone` clears `pendingRoutineId` (and the dirty flag) before navigating home.

### BUG-14 — Google Sheets sync broken in real browsers · Critical · FIXED
**Context:** the feature worked from `curl` and Node but failed on the deployed site.
Two independent causes, both invisible to non-browser testing:
1. Apps Script answers a POST with a **302 redirect to `script.googleusercontent.com`**; the Content-Security-Policy only allowed `script.google.com`, so the redirected request was blocked. CSP is not enforced by curl or Node, which is why the earlier tests passed.
2. The **service worker intercepted cross-origin GETs** and answered a failed upstream call with its own synthetic `503 Offline`, masking the real cause.
**Fix:** added `https://script.googleusercontent.com` to `connect-src` in both `vercel.json` and `netlify.toml`, and scoped the service worker's `fetch` handler to same-origin requests only.
**Lesson:** any change to the Sheets integration must be verified **in a real browser**, not with curl.

### BUG-15 — Sync died once the log exceeded ~50 KB · Critical · FIXED
**Measured:** 66 KB payload → `Failed to fetch`; the same data minus sets → saved; 43 KB → saved. Apps Script rejects a POST body above roughly 50 KB **before the script runs**. Because the payload grows with history, the backup worked at first and then silently stopped — the worst failure mode for a backup.
A second, latent instance of the same ceiling: the raw backup was stored in a **single spreadsheet cell**, and Sheets caps a cell at 50,000 characters, so restore would have broken past that too.
**Fix:** protocol **v2** — `buildSyncParts()` slices every table into parts bounded by `SYNC_PART_CHARS = 30000`, uploaded via `sync-start` → `sync-part` ×N → `sync-commit`. The script stores one part per row and reassembles on commit and on fetch. Export/downloaded JSON is unaffected.

### BUG-16 — v2 client would have made a v1 script silently blank the sheets · Critical · FIXED
**Context:** this was caught while shipping BUG-15's fix, before release.
**Root cause:** the deployed v1 Apps Script has **no unknown-action guard** — it treats *any* POST as a whole-payload sync. Sending it `sync-start` (which carries no data) would have made it clear the sheets, write nothing, and return `success`; the client would then have reported a successful backup over an emptied spreadsheet.
**Fix:** `detectScriptVersion()` probes `GET ?action=ping` for `scriptVersion` before choosing a protocol. A version `< 2` (or undetectable, treated as legacy) uses the single-shot `sync` action and, if that fails with a bare fetch error, tells the user to paste the current Apps Script. The v2 template also returns an explicit error for unknown actions, and a contract test asserts the template keeps that guard.

---

## Part 2 — Fixed bugs (second audit round)

Each entry: severity · files · root cause · reproduction · impact · applied fix & tests. Line numbers refer to revision `2b28e36`.

---

### A1 — Stale draft can silently swallow logged sets · **High** · FIXED

**Affected:** `src/lib/db.ts` (`restoreFromBackup`, `resetDatabaseWithSampleData`, `clearAllLogs`), `src/screens/LogWorkoutScreen.tsx`
**Root cause.** Three operations replaced application data without clearing `db.drafts`, and the Log screen restored draft blocks verbatim without validating `exercise_id` against the current exercise library.
**Applied fix:**
1. `db.drafts.clear()` is called within the atomic transactions of `restoreFromBackup`, `resetDatabaseWithSampleData`, and `clearAllLogs`.
2. In `LogWorkoutScreen.tsx`, restored draft blocks are validated against current exercises. Any block referencing an unknown exercise ID is filtered out and a notice banner (`setDraftNotice`) informs the user: *"Some exercises in your draft no longer exist and were removed."*
**Tests:** `src/test/audit_part2_fixes.test.tsx` ("A1: clearing or resetting data clears drafts in database", "A1: LogWorkoutScreen drops draft blocks with unknown exercise IDs and displays notice banner").

---

### A2 — Unit conversion is not atomic, so it can mislabel everything · **High** · FIXED

**Affected:** `src/screens/SetupScreen.tsx`, `src/lib/db.ts` (`applyUnitChange`), `src/test/audit_fixes.test.tsx`
**Root cause.** Converting weights and updating settings were two separate awaits with no shared transaction and no idempotency guard.
**Applied fix:**
1. Created `applyUnitChange(target: 'kg' | 'lb')` in `src/lib/db.ts` which runs a single atomic transaction over `db.sets`, `db.sessions`, and `db.settings`.
2. Includes an idempotency guard: if `settings.weight_unit === target`, it immediately returns `{ sets: 0, sessions: 0 }` as a no-op without converting.
3. Converted `SetupScreen.tsx` to use `applyUnitChange`.
**Tests:** `src/test/audit_part2_fixes.test.tsx` ("A2: applyUnitChange executes atomically and is idempotent"), and updated `src/test/audit_fixes.test.tsx`.

---

### A3 — Auto-sync effect thrashes; its interval never fires · **Medium** · FIXED

**Affected:** `src/hooks/useGoogleSheetsAutoSync.ts`
**Root cause.** The effect's dependency array contained all five `useLiveQuery` arrays, which obtain new object references on every write, causing constant teardown and recreation of the 15-minute sync interval and online listeners.
**Applied fix:**
`dataRef` holds the live query arrays (`exercises`, `routines`, `routineExercises`, `sessions`, `sets`) and is updated synchronously on render. The `useEffect` dependencies are reduced to primitives (`enabled`, `webAppUrl`, `autoSyncTwiceDaily`, `lastSyncTime`, `defer`), allowing the 15-minute interval to persist cleanly across data writes.
**Tests:** `src/test/audit_part2_fixes.test.tsx` ("A3: useGoogleSheetsAutoSync hook does not thrash interval when data array references change").

---

### A4 — Manual syncs have no offline guard · **Medium** · FIXED

**Affected:** `src/App.tsx` (`handleHeaderQuickSync`), `src/screens/SetupScreen.tsx` (`handleSyncNow`, `handleTestSheetsConnection`, `handleRestoreSheetsBackup`)
**Root cause.** Manual sync actions lacked a check for `navigator.onLine`, triggering raw fetch failures and setting `lastSyncStatus: 'error'` even when merely disconnected.
**Applied fix:**
Added `navigator.onLine` checks before initiating syncs in `App.tsx` and `SetupScreen.tsx`. When offline, a clear message *"You're offline — this device will sync when you're back online."* is displayed and `lastSyncStatus` is not corrupted.
**Tests:** `src/test/audit_part2_fixes.test.tsx` ("A4: manual quick sync in Header guards against offline without setting error status", "A4: manual sync and test connection in SetupScreen guard against offline").

---

### A5 — Archiving an exercise is a one-way door · **Medium** · FIXED

**Affected:** `src/screens/SetupScreen.tsx`
**Root cause.** Archiving set `is_archived: true`, but there was no UI section to view or restore archived exercises.
**Applied fix:**
Added a collapsible "Archived (N)" section in `SetupScreen.tsx` matching the routines UI pattern. Users can restore any archived exercise (`is_archived: false`), or permanently hard-delete unreferenced archived exercises with confirmation.
**Tests:** `src/test/audit_part2_fixes.test.tsx` ("A5: SetupScreen reveals archived exercises and allows restoring or permanently deleting unreferenced exercises").

---

### A6 — Epley 1RM has no rep ceiling · **Medium** · FIXED

**Affected:** `src/types/index.ts` (`estimateOneRepMax`), `src/lib/workout.ts` (`computePersonalRecords`)
**Root cause.** Epley formula `weight * (1 + reps / 30)` was uncapped, generating absurd 1RMs for high rep counts and bodyweight/time-based exercises.
**Applied fix:**
1. Added `maxReps = 15` parameter to `estimateOneRepMax`. If `reps > maxReps`, it returns `0`.
2. `computePersonalRecords` skips sets with 0 1RM (unless weight > 0 for 1RM calculation) and skips non-reps metric exercises from 1RM estimation.
**Tests:** `src/test/audit_part2_fixes.test.tsx` ("A6: estimateOneRepMax caps at 15 reps and ignores >15 reps for 1RM estimation", "A6: computePersonalRecords does not generate distorted 1RM records for high rep counts").

---

### A7 — Time-based exercises are modelled as reps · **Low** · FIXED

**Affected:** `src/types/index.ts`, `src/lib/sampleData.ts`, `src/lib/workout.ts`, `src/screens/LogWorkoutScreen.tsx`, `src/screens/HistoryScreen.tsx`
**Root cause.** All exercises assumed reps; duration exercises (planks, running) inflated `totalReps`.
**Applied fix:**
1. Added `ExerciseMetric = 'reps' | 'seconds' | 'minutes'` to `Exercise.metric` (defaulting to `'reps'`).
2. Tagged sample exercises "Plank (seconds)" (`metric: 'seconds'`) and "Treadmill Run (minutes)" (`metric: 'minutes'`).
3. `summarizeSession` calculates `totalSeconds` and excludes seconds/minutes from `totalReps`.
4. In `LogWorkoutScreen` and `HistoryScreen`, time-based inputs and chips display appropriate units (`sec`, `min`) instead of `reps`.
**Tests:** `src/test/audit_part2_fixes.test.tsx` ("A7: summarizeSession segregates time-based metrics into totalSeconds without inflating totalReps", "A7: LogWorkoutScreen adjusts input placeholder and step according to exercise metric").

---

### A8 — Floating promise in the Dexie `populate` handler · **Low** · FIXED

**Affected:** `src/lib/db.ts`
**Root cause.** `this.bulkAddSampleLogs()` was not returned in `this.on('populate')` and did not await its writes, potentially committing before sample sessions and sets were written.
**Applied fix:**
`this.on('populate')` returns `this.bulkAddSampleLogs()`, which now awaits `this.sessions.bulkAdd` and `this.sets.bulkAdd`, keeping the populate transaction open until all records are stored.
**Tests:** `src/test/audit_part2_fixes.test.tsx` ("A8: populate handler returns promise and commits all sample sessions and sets").

---

### A9 — Duplicate exercise blocks merge · **Low** · FIXED

**Affected:** `src/screens/LogWorkoutScreen.tsx`
**Root cause.** Multiple blocks could select the same exercise, causing set numbering to merge and rendering confusingly.
**Applied fix:**
In `LogWorkoutScreen.tsx`, exercise `<select>` dropdowns disable exercises already selected in other blocks, matching the pattern in `RoutineEditor`. Added a submission guard preventing save if duplicate exercise blocks exist.
**Tests:** `src/test/audit_part2_fixes.test.tsx` ("A9: LogWorkoutScreen disables already-selected exercises in other blocks and prevents duplicate block submission").

---

### A10 — No React error boundary · **Low** · FIXED

**Affected:** `src/components/ErrorBoundary.tsx` [NEW], `src/main.tsx`
**Root cause.** Any unhandled render error caused a white screen crash with no recovery path.
**Applied fix:**
Created `ErrorBoundary` component with a recovery panel offering "Reload Page" and "Go to Home" (which clears `mygym_active_screen` from `localStorage`), and wrapped `<App />` with `<ErrorBoundary>` in `main.tsx`.
**Tests:** `src/test/audit_part2_fixes.test.tsx` ("A10: ErrorBoundary catches render errors, shows recovery UI, and Go to Home clears active screen").

---

### A11 — `SetLog.notes` is write-only · **Low** · FIXED

**Affected:** `src/screens/LogWorkoutScreen.tsx`, `src/screens/HistoryScreen.tsx`
**Root cause.** `SetLog.notes` was defined in the schema but was hardcoded to empty string and never displayed.
**Applied fix:**
1. In `LogWorkoutScreen.tsx`, each set row has a note toggle button that reveals an inline note input, saving the note to `SetLog.notes`.
2. In `HistoryScreen.tsx`, set notes are displayed in the expanded set chip with a note icon.
**Tests:** `src/test/audit_part2_fixes.test.tsx` ("A11: LogWorkoutScreen allows adding notes per set and saves them into SetLog.notes", "A11: HistoryScreen displays set notes when present").

---

### A12 — Non-Log screens lose their state on tab switch · **Low** · FIXED

**Affected:** `src/screens/HistoryScreen.tsx`, `src/screens/ProgressScreen.tsx`, `src/screens/SetupScreen.tsx`
**Root cause.** Screen state was held purely in local `useState`, resetting whenever switching tabs.
**Applied fix:**
Synchronized key non-sensitive view state to `sessionStorage`:
- `HistoryScreen`: search query (`mygym_history_search`) and expanded session ID (`mygym_history_expanded`).
- `ProgressScreen`: selected exercise ID (`mygym_progress_exercise`).
- `SetupScreen`: unsubmitted Sheets URL input (`mygym_setup_sheets_url`).
**Tests:** `src/test/audit_part2_fixes.test.tsx` ("A12: HistoryScreen preserves search query and expanded session across remounts", "A12: ProgressScreen preserves selected exercise across remounts", "A12: SetupScreen preserves unsubmitted Sheets URL draft across remounts").

---

### A13 — `sliceBySize` casts away the discriminated union · **Low** · FIXED

**Affected:** `src/lib/googleSheets.ts`
**Root cause.** `sliceBySize` took `kind: string` and used `{ k: kind, items: batch } as SyncPart`, defeating type checking.
**Applied fix:**
Refactored `sliceBySize` to accept `K extends SyncPartItemKind` where `SyncPartItemKind = SyncPart['k']` and return `PartForKind<K>[]`, guaranteeing at compile time that only valid kinds with their matching item types can be created.
**Tests:** `src/test/audit_part2_fixes.test.tsx` ("A13: sliceBySize enforces type-safe SyncPart discriminated union without loose type assertion").

---

## 3. Intentional behaviours — do NOT "fix" these

### 3.1 Warm-up sets are excluded from volume
`is_warmup` sets are skipped by `summarizeSession`, `summarizeWeek`, `volumeByMuscleGroup`, `computePersonalRecords` and `exerciseProgressSeries`, but **counted** in `totalSets`. Consequence: weekly volume fell ~10–15 % for sessions that logged a warm-up when BUG-06 was fixed. This consistency is deliberate and covered by a test asserting session volume == week volume == muscle-group volume.

### 3.2 The Sheets secret is never stored in a payload
It is sent only as the top-level `secretKey` auth field of a request. It is stripped from JSON exports, from the settings copy stored inside the sheet, and it is never adopted from an imported or restored payload (the local credential always wins). Verified against a live spreadsheet. Tests must keep asserting this.

### 3.3 Restore merges settings asymmetrically
On restore/import: the **backup** supplies `weight_unit` (it labels the incoming weights); the **device** keeps `weekly_goal` and `default_rest_seconds` (preferences of the person, not properties of the data); the **device** always keeps its `google_sheets.secretKey`. Values are clamped (goal 1–14, rest 15–600 s).

### 3.4 Protocol version is probed before syncing
The client asks for `scriptVersion` via `GET ?action=ping` and only uses partitioned actions on v2. A v1 script must never receive `sync-start` — see BUG-16; doing so previously would have blanked the user's spreadsheet while reporting success.

### 3.5 Time-based exercises currently store seconds in `reps`
This is a known modelling weakness (tracked as A7), not an intentional design. Do not "fix" it by silently converting existing values without a migration.

---

## 4. Conventions, gotchas and constraints

### 4.1 Dexie / IndexedDB
- **Adding a table or index requires a version bump**: `this.version(N).stores({ ... })`. Declare only what changed + the new table; Dexie merges. The v2 upgrade that added `drafts` was verified non-destructive against a live database (22 sessions / 296 sets preserved).
- **Multi-table writes must be transactional** — use `db.transaction('rw', [...tables], fn)`. Never leave a multi-step mutation (like A2) outside one.
- `db.ts` imports `WorkoutDraft` as a **type-only** import to avoid a runtime cycle with `drafts.ts` (which imports `db`). Keep it `import type`.
- `useLiveQuery` returns a **new array identity on every write** — never put those arrays in an effect's dependency list (A3).

### 4.2 Google Sheets protocol (v2)
- Upload flow: `sync-start` → `sync-part` ×N → `sync-commit`. Parts are bounded by `SYNC_PART_CHARS = 30000`.
- The ~50 KB Apps Script POST ceiling and the 50,000-character spreadsheet cell limit are the two hard constraints that shaped this design. Do not revert to a single whole-payload POST.
- `GOOGLE_APPS_SCRIPT_TEMPLATE` in `src/lib/googleSheets.ts` is the single source of the server code, shown to users in Settings (copy button). **Any change to the wire format must change the template and `APPS_SCRIPT_PROTOCOL_VERSION` together**, and the protocol-contract tests in `src/test/googleSheets.test.ts` must be updated to match.
- **Verify Sheets changes in a real browser.** curl and Node do not enforce CSP and will report success on a broken integration (BUG-14).
- `scripts/test-sheets.mjs` is a read-only health check: `SHEETS_URL=… SHEETS_SECRET=… node scripts/test-sheets.mjs`.

### 4.3 Service worker
- `public/sw.js` is **scoped to same-origin requests only**. Do not re-broaden it to third-party calls: it previously masked sync failures behind a synthetic `503 Offline`.
- The cache name is stamped with a content hash of `dist/assets` by `scripts/version-sw.mjs` during `npm run build`. A new build changes `sw.js`, which triggers reinstall + old-cache eviction. Never hand-edit the stamped name.
- Dev mode unregisters the SW so Vite HMR is never blocked.

### 4.4 Tests
- 262 tests in 10 suites; run with `npm test`.
- IndexedDB is provided by `fake-indexeddb/auto` in `src/test/setup.ts`; **each test file gets a fresh in-memory database**, so cross-file isolation is automatic — but *within* a file you must clear tables (and `localStorage`, which persists the active tab) in `beforeEach`/`afterEach`.
- `resetDatabaseWithSampleData()` deliberately **preserves** the Sheets credential, so tests must explicitly clear `google_sheets` if they need isolation from a previous test.
- Rendering a screen that reads Dexie is **asynchronous**: use `findBy*`/`findAllBy*`, not `getBy*`, for anything populated by a query or a draft restore.
- Prefer assertions on the database (`db.sessions.get(id)`) over transient UI text, since flash messages auto-clear after 2.5 s.

### 4.5 Build and deploy
- `npm run build` runs `tsc` first — strict mode with `noUnusedLocals`/`noUnusedParameters`, so unused imports fail the build.
- Pushing to `main` triggers GitHub Actions: `npm ci` → `npm test` → `npm run build` → `netlify deploy --prod`. **A failing test blocks the deploy.**
- The Netlify site needs "Who has access: Anyone" (Netlify Access gate is otherwise on by default for this team). The site has no GitHub OAuth link, which is why deploys run through Actions rather than Netlify's native Git integration.

### 4.6 Windows development notes
- `msvcp140.dll` is required by PyMuPDF and is not installed system-wide; a copy was placed next to `python.exe` for the document-build tooling. Unrelated to the app runtime.
- No LibreOffice or PowerPoint on this machine, so `.pptx` files cannot be rendered locally for visual inspection.
- Fonts used by the guide/deck builders are the local Windows set (`C:\Windows\Fonts`), not the Linux paths in the PDF skill's reference docs.

---

## 5. Test coverage map

| Suite | Tests | Guards |
|---|---|---|
| `workout.test.ts` | 15 | core stats: 1RM, volume, resolution, PRs |
| `workout_deep.test.ts` | 45 | ISO week boundaries, streak rules, PR tie-breaking, warm-up exclusion, per-aggregate agreement |
| `db.test.ts` | 6 | schema, seeding, atomic save, cascade delete |
| `db_deep.test.ts` | 24 | restore path, preference semantics, clamping, backup validation, large restores |
| `googleSheets.test.ts` | 60 | sanitization, chunk partitioning, protocol selection (incl. the v1-wipe guard), client/script contract |
| `formatters.test.ts` | 13 | date/duration/weight/volume/clock formatting |
| `sampleData.test.ts` | 7 | seed integrity, referential integrity, progression |
| `ui_screens.test.tsx` | 51 | every screen: rendering, interactions, settings, Sheets flows |
| `app_integration.test.tsx` | 9 | routing, live queries, end-to-end log → history, delete |
| `audit_fixes.test.tsx` | 32 | one or more regression tests per fixed bug in Part 1 (drafts, unit conversion, timer, guards, import confirmation) |
| `audit_part2_fixes.test.tsx` | 20 | regression tests covering all 13 Part 2 bugs (A1 through A13) |

**Total: 282 tests across 11 suites (all passing).** All previously identified Part 2 coverage gaps are now fully guarded by `audit_part2_fixes.test.tsx` and updated tests in `audit_fixes.test.tsx`.

---

## 6. Suggested roadmap

**Tier 1 — correctness (recommended next work; each item is small and independently testable)**
A1, A2, A3, A4, A10, A8, A13, plus an end-to-end CI test of log → save → history (currently covered only by manual browser runs).

**Tier 2 — data model (do before a year of logs accumulate; these become migrations)**
A7 (metric on exercises), A6 (cap Epley), A5 (un-archive + real delete), A9 via `superset_group` on `SetLog`.

**Tier 3 — product**
Body-weight trend chart (the data is already captured and synced but never visualised); per-set notes (A11); per-screen state restoration (A12); RPE/RIR tracking; barbell plate calculator; supersets/dropsets; CSV export; real charting library.

---

## Appendix — severity definitions

| Severity | Definition |
|---|---|
| **Critical** | Unrecoverable data loss, or silently wrong data presented as correct, on a plausible user path |
| **High** | Data loss or wrong data with a realistic trigger; or a security/credential exposure |
| **Medium** | Degraded behaviour, user-visible inconsistency, or a trap that will bite as data grows |
| **Low** | Rough edges, dead code/fields, missing affordances, robustness hygiene |

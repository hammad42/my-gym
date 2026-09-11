# MyGym — Offline Workout Planner & Logger

A 100% offline, local-first PWA for planning gym routines and logging exercises.
Built with the same technology and architecture as the Paisa expense tracker:

- **React 18 + TypeScript + Vite** — single-page app, mobile-first layout
- **Dexie (IndexedDB)** — all data stays in the browser; nothing leaves your device
- **Tailwind CSS** — dark theme, IBM Plex typography
- **Service worker PWA** — installable, works fully offline
- **Vitest** — unit tests over the data layer and stats engine

## Features

- **Home** — weekly goal progress, streak, volume/sets/time summary, one-tap routine start
- **Routines** — plan workout templates (exercise order, target sets × reps); start one to pre-fill a log
- **Log Workout** — pick a routine or go free-form; per-set weight/reps with warmup flag, live estimated 1RM, rest timer, duplicate-set carry-forward
- **History** — searchable, grouped by date, expandable session details, per-exercise best set, delete with confirmation
- **Progress** — sessions-per-week bars, volume by muscle group, per-exercise progression chart, personal records (Epley e1RM)
- **Settings** — kg/lb, weekly goal, rest timer length, exercise library management, JSON export/import, clear logs, reset to demo data

## Getting started

```bash
npm install
npm run dev        # http://localhost:5174
npm test           # vitest
npm run build      # typecheck + production build + service-worker version stamp
npm run preview    # serve the production build
```

On first launch the database is seeded with a demo exercise library, three
routines (Push/Pull/Legs) and ~6 weeks of sample sessions so charts and PRs
have data to show. Use Settings → "Clear all logged workouts" for a clean
start, or "Reset to demo data" to restore the seed.

## Google Sheets backup

Optional cloud backup that mirrors your workouts into a Google Sheet you own.
The app keeps working fully offline; sync happens in the background when you're
online, or on demand via the **Sheets** button in the header.

Setup (one time, ~5 minutes):

1. In the app: **Settings → Google Sheets Backup → Show setup instructions &
   Apps Script code**, then press **Copy Apps Script code**.
2. Create a blank spreadsheet at [sheets.new](https://sheets.new), open
   **Extensions → Apps Script**, delete the placeholder code and paste the copy.
3. Change `SECRET_KEY` in the script to your own private password (min 8
   characters). Until you do, the webhook deliberately refuses every request.
4. **Deploy → Manage deployments**, then edit the existing deployment (pencil
   icon) with *Version: New version*. First time only: **Deploy → New
   deployment → Web app**, with *Execute as: Me* and *Who has access: **Anyone***.
   Authorize, then copy the Web App URL.
5. Back in the app: paste the URL and the same secret, **Save**, **Test**, then
   **Sync now**.

The sync writes five tabs: **Workout Log** (a readable row per set), **Sessions**
(per-workout summary with volume and reps), **Exercises**, **Routines**, and
`_MyGymBackup` (the raw parts used for recovery).

### Why uploads are chunked

The payload is uploaded in size-bounded parts. Apps Script rejects a single POST
body above roughly 50 KB at the network layer — the request fails with a bare
`Failed to fetch` before the script runs — so a whole-payload sync stops working
once the training log grows. The spreadsheet also caps a cell at 50,000
characters, so the stored backup is spread across rows rather than living in one
cell.

The client asks the deployment for its `scriptVersion` before syncing and picks
the protocol accordingly. A deployment still running the older script would treat
the newer actions as a whole-payload sync and blank the sheets, so an out-of-date
script is deliberately never sent the partitioned actions — it falls back to the
single request and, once that no longer fits, tells you to paste the updated code.

### Security model

Both properties below are inherited from the expense-tracker this architecture is
based on:

- The webhook **fails closed**. Because the deployment is public, an unchanged
  default password would expose your whole training history, so the script
  refuses every request until `SECRET_KEY` is actually changed.
- The secret is sent only as the request's top-level auth field. It is stripped
  from the copy of the settings stored in the sheet, from JSON exports, and from
  every other payload that leaves the device (see `src/lib/sanitize.ts`).


Check a deployment from the command line without writing any data:

```bash
SHEETS_URL="https://script.google.com/macros/s/…/exec" \
SHEETS_SECRET="your-secret" \
node scripts/test-sheets.mjs
```

## Architecture

```
src/
├── App.tsx                  # screen router + reactive Dexie queries
├── main.tsx                 # React root + service-worker registration
├── types/index.ts           # domain types (Exercise, Routine, Session, SetLog…)
├── lib/
│   ├── db.ts                # Dexie schema, seeding, atomic workout/routine writes
│   ├── sampleData.ts        # default library, routines, 6 weeks of demo history
│   ├── workout.ts           # resolution + stats: summaries, PRs, progress series
│   ├── formatters.ts        # dates, weights, volume, clock display
│   └── exportImport.ts      # JSON backup/restore
├── components/              # Header, BottomNav, ExerciseIcon, RoutineEditor
├── screens/                 # Home, LogWorkout, History, Routines, Progress, Setup
└── test/                    # vitest suites (db, workout, formatters, sampleData)
```

`npm run build` stamps a content hash into the service worker's cache name
(`scripts/version-sw.mjs`), so every deploy reliably evicts old caches.
Deploy configs for Vercel (`vercel.json`) and Netlify (`netlify.toml`) are
included.

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

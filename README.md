# Fitness Tracker

A mobile-first personal diet and workout tracker that runs entirely on your phone. It is a React, TypeScript, Vite, Tailwind CSS and Recharts PWA. All data is stored on the device in the browser's IndexedDB: no server, no account, works offline. Food nutrition is entered by you and is not presented as independently verified.

## Install on iPhone

1. Open the app's GitHub Pages address in **Safari** (for example `https://<your-username>.github.io/fitness-tracker/`).
2. Tap Share → **Add to Home Screen**.
3. Always open it from the Home Screen icon. Its data is separate from the Safari tab's data.

### Your data

- Data lives only on that iPhone, inside the Home Screen app. Deleting the app from the Home Screen deletes its data.
- **Back up regularly:** Settings → *Export JSON backup*, then save it to Files or iCloud Drive.
- To move to a new phone, or recover: Settings → *Restore backup*, then pick the file. This replaces everything on the device.

## Deploying (GitHub Pages)

Every push to `main` builds and publishes the app with `.github/workflows/deploy.yml`. One-time setup in the GitHub repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Updates reach the phone automatically the next time the app is opened while online.

## Development

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`. Production build: `npm run build`. For a sub-path build like Pages uses, set `BASE_PATH=/fitness-tracker/`.

## Code

- `src/api.ts`: on-device data layer (IndexedDB), with nutrition snapshots, dashboard and weekly calculations, export and import.
- `src/App.tsx`: the UI.
- `backend/`: the original FastAPI/SQLite server. The app no longer uses it; it's kept for reference.

## Features

- Dashboard with daily nutrition totals, optional editable targets, remaining amounts, and weekly activity; switch days to view or log the past.
- Food library with raw/cooked/packaged distinctions, per-100 g nutrition and saved servings (e.g. "1 bowl" = 80 g).
- Fast meal logging: search, recent foods, quick portions; meals keep a nutrition snapshot and can be edited later.
- Workout logging with sets, reps and kg; repeat a past session, "last time" numbers, exercise suggestions, and a rest timer.
- Progress tab: food and workout streaks, daily averages and target adherence, calories chart, body weight with a 7-day trend, and per-exercise charts (heaviest set, volume).
- Barcode scanning: fills in a food from Open Food Facts (only the barcode number is sent), marked "check against the label"; a barcode can also be typed.
- Water tracking against an optional daily target, and a short note per day.
- Swipe left to delete with Undo (no confirmation pop-ups).
- kg or lb for body weight and lifts (data is always stored in kg), and Auto / Dark / Light appearance. These are per-device settings, not part of backups.
- Backups through the iOS share sheet with a 7-day reminder, and restore from a backup file.
- Installable, offline-capable PWA that checks for updates whenever it's opened; charts and the scanner load on demand.

Code: `src/api.ts` (data layer), `src/App.tsx` (main UI), `src/Progress.tsx` (Progress tab), `src/Barcode.tsx`, `src/RestTimer.tsx`, `src/Swipe.tsx`, `src/prefs.ts` (units/theme), `src/utils.ts`.

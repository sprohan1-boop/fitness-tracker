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

- Dashboard with daily nutrition totals, optional editable targets, remaining amounts, and weekly activity.
- Manually managed food library with raw/cooked/packaged distinctions and per-100 g nutrition.
- Portion-based meal logging with nutrition calculated from the selected food entry and a saved nutrition snapshot.
- Workout logging with exercises, sets, reps, and metric weights.
- JSON backup export and restore.
- Installable, offline-capable PWA.

# DaVinci Decoders

Interactive training web application for Science Olympiad Division A (Elementary) **DaVinci Decoders** event under SoCal rules.

Designed for fast, kid-friendly practice on Chromebooks, tablets, laptops, and mobile phones with native keyboards and official resource sheet tables.

---

## Development & Scripts

Inside the `app/` directory:

- `npm run dev` — Start local Vite development server (HMR enabled).
- `npm run build` — TypeScript type-check (`tsc -b`, including `scripts/`) and bundle for production.
- `npm run lint` — Fast linting via `oxlint`.
- `npm run preview` — Locally preview the production build in `./dist`.

---

## Optional Firebase Setup (Cloud Sync, Leaderboards, & Practice Tests)

The app runs out-of-the-box in **Guest Mode** using `localStorage`. To enable Google Sign-In, classroom roster gating, cross-device progress sync, leaderboards, and timed practice tests, create an `app/.env.local` file with your Firebase web config:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=...
```

---

## Deployment

Deployments to **GitHub Pages** and **Firestore Security Rules** are fully automated:
- Any push to the `main` branch triggers `.github/workflows/deploy.yml`.
- Build artifacts from `./dist` are served with relative paths (`base: './'`).
- Post-deploy steps automatically sync `/classroom_config/app_version` (`npm run deploy:version`), publish `firestore.rules` (`npm run deploy:rules`), and prune orphaned quote flags (`npm run prune:flags`) when `FIREBASE_SERVICE_ACCOUNT` is configured (requires the `Firebase Rules API` enabled on the GCP project plus `Cloud Datastore User` and `Firebase Rules Admin` IAM roles).
- **Forcing Open Tabs to Reload (`criticalVersion` Sentinel):** Routine deploys keep `"criticalVersion": 0` in `app/package.json` and do not interrupt open tabs. When shipping a critical fix that must kick off all older tabs, increment `"criticalVersion"` (e.g. `0` → `1`) in `app/package.json` before deploying (or bump `criticalVersion` directly on `/classroom_config/app_version` in the Firestore Web Console). Open tabs listen in real time to `/classroom_config/app_version` and display a non-dismissible reload modal when outdated, while `firestore.rules` immediately cuts off both reads and writes for clients below the required `criticalVersion`.
- **Resetting Leaderboard Scores:** `/profiles/{uid}.drillScores` in Firestore is authoritative over `localStorage` for signed-in users. Deleting or editing a drill entry inside `/profiles/{uid}.drillScores` in the Firestore Web Console automatically clears/updates the student's local score cache on reload and via live profile snapshots.
- Note: Pair programming commits should remain local until ready for deployment.

---

## URL Parameters & Deep Linking

- `?drill=<id>` — Directly opens a memorization/flashcard drill (`offsets`, `atbash`, `pigpen`, `galactic`).
- `?cipher=<id>` — Directly opens a full-quote cipher decoding workspace (`atbash`, `pigpen`, `galactic`).
- `?cipher=<id>&q=<quoteId>` — Directly opens a specific quote puzzle (e.g. `?cipher=pigpen&q=25`).
- `?tests=true` — Opens the Practice Tests catalog (when signed in on the team roster).
- `?test=<testId>` — Directly opens or resumes a timed practice test session.
- `?results=<testId>` — Opens the scored breakdown for a completed practice test.

---

## Folder Map

```
app/
  public/
    references/        # Official SoCal reference sheet image assets (PNGs)
    favicon.svg        # App icon
  scripts/
    seedTest.ts        # Firestore practice test packet seeder (type-checked via tsconfig.node.json)
  src/
    assets/fonts/      # Cipher web fonts (Standard Galactic Alphabet, Knights Templar)
    components/
      auth/            # Google Sign-In badge and allowlist notice modal
      common/          # Shared accessible UI primitives (Modal)
      drills/          # Drill workspaces (LetterOffsetDrill, SymbolDrill, LookupCipherDrill) & shared subcomponents
      leaderboard/     # Real-time leaderboards modal
      menu/            # Main Menu dashboard & header
      options/         # Classroom Options & Settings modal
      symbols/         # SVG glyph renderers (Pigpen, Galactic)
      test/            # Timed Practice Test runner, workspace, review, briefing, and results views
      workout/         # General Practice circuit summary modal
    context/           # React authentication context & provider
    data/              # Quote database (lazy-loaded) and drill configurations
    hooks/             # Reusable hooks (useSpacedDeck, useVelocityTracker, useWorkoutCircuit, viewport/scroll)
    services/          # Local storage, Firebase client, cloud sync, leaderboards, and practice test services
    styles/            # Modular CSS stylesheets (base, menu, modal, drills, leaderboard, test)
    types/             # Core TypeScript interfaces and types
    utils/             # Pure cipher math, formatting, test progress, and URL routing helpers
    index.css          # Stylesheet entrypoint importing src/styles/*.css
```

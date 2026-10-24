# DaVinci Decoders

Interactive training web application for Science Olympiad Division A (Elementary) **DaVinci Decoders** event under SoCal rules.

Designed for fast, kid-friendly practice on Chromebooks, tablets, laptops, and mobile phones with native keyboards and official resource sheet tables.

---

## Development & Scripts

Inside the `app/` directory:

- `npm run dev` — Start local Vite development server (HMR enabled).
- `npm run build` — TypeScript type-check (`tsc -b`) and bundle for production.
- `npm run lint` — Fast linting via `oxlint`.
- `npm run preview` — Locally preview the production build in `./dist`.

---

## Deployment

Deployments to **GitHub Pages** are fully automated:
- Any push to the `main` branch triggers `.github/workflows/deploy.yml`.
- Build artifacts from `./dist` are served with relative paths (`base: './'`).
- Note: Pair programming commits should remain local until ready for deployment.

---

## URL Parameters & Deep Linking

- `?drill=<id>` — Directly opens a drill (`offsets`, `atbash`, `pigpen`, `galactic`).
- `?drill=<id>&q=<quoteId>` — Directly opens a specific quote puzzle (e.g. `?drill=pigpen&q=25`).
- `?unlocked=<id1,id2,...>` — One-click classroom sync link generated from ⚙️ Options to configure which ciphers appear in General Practice on student devices.

---

## Folder Map

```
app/
  public/
    references/        # Official SoCal reference sheet image assets (PNGs)
    favicon.svg        # App icon
  src/
    components/        # UI components (drills, options modal, glyphs)
    data/              # Quote database and drill configurations
    utils/             # Pure cipher math, letter grouping, and routing helpers
    services/          # Local storage and state persistence
    types/             # Core TypeScript interfaces and types
    index.css          # Main styling and mobile viewport layout
```

# Jurassic Stack

A browser dino-survival game — hunt, tame, ride, build, survive — on one handcrafted island.
Vanilla three.js + TypeScript + Vite. Private hobby project for four friends.

- **Plan of record:** [PLAN.md](PLAN.md) · **Task ledger:** [CHECKLIST.md](CHECKLIST.md)
- North star: *stupidly fun, honestly made* — a polished core, a chaotic surface, an island that
  means something, and an optional guided arc over a survival creative sandbox.

## Dev

```bash
npm install
npm run dev       # Vite dev server
npm run build     # tsc + vite build → dist/
npm run preview   # serve the build
```

Deploys as a static site (Vercel via `vercel.json`; Netlify config included as backup).

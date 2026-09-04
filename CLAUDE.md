# Jurassic Stack

Browser ARK-like survival game (hunt, tame, ride, build) on one handcrafted island. Private,
non-commercial, for four friends. Vanilla three.js + strict TypeScript + Vite, static deploy on
Vercel. **No React, no framework.**

- `PLAN.md` is the plan of record (vision, decisions, stack, assets, island plan, arc). Read it before
  designing anything. If it conflicts with anything else, PLAN.md wins.
- `CHECKLIST.md` is the task ledger. Work one milestone chunk per session; tick a box only when it's
  proven (build + screenshot/scripted check) and committed.

## Conventions (inherited from ~/Repositories/minecraft-JS — the house pattern)

- Flat modules in `src/scripts/*.ts`, entry `main.ts`. DOM HUD elements live in `index.html` and are
  managed from scripts — UI is plain DOM over the canvas, never a framework.
- Strict tsconfig; `npm run build` = `tsc && vite build` and must stay clean — tsc is the lint gate.
- Vite `base: './'` (relative asset URLs) — do not change; it's what makes the same dist work on
  Vercel root and sub-path hosts.
- Verification harnesses are root-level or `tools/` `.mjs` scripts using `playwright-core` (screenshots,
  benches, smoke checks) against `vite preview` or the dev server. Screenshots go to `shots/` (gitignored).
- Static assets in `public/` (`models/`, `textures/`). Heavy raw asset archives stay out of git.
- Multiplayer (M9) is PeerJS host-authority P2P — minecraft-JS `src/scripts/net.ts` is the reference.
  Never introduce a server; the deploy must stay static.

## Rules that bite

- **Asset licensing:** free roster per PLAN.md. Anything gray-provenance ⇒ repo stays private, never
  deploy it publicly. Record every model in `ASSETS.md` (source URL, license, clips) at intake — no
  model enters `src`/`public` without passing `tools/gate.mjs`.
- **Species are data.** All dino behavior/stats/clips come from the species table; one generic brain.
  Never special-case a species in code.
- **The jank fence:** controls, camera, saves, and hit fairness stay polished; emergent chaos
  (ragdolls, dino decisions, physics) is licensed. Bug triage: "funny or frustrating?" first.
- Fixed-timestep simulation; pause the loop on `document.hidden`; clamp dt.
- Verify before claiming done: `npm run build`, then the milestone's gate in CHECKLIST.md.
- **The hand-made mandate (user, 2026-09-04):** world geometry is traced by hand, every vertex a
  decision — rivers as paths, lakes/forests/glades as polygons in `tools/hand-geometry.mjs`. No
  center+radius+noise, no sine meanders; any such shortcut still in the bake (swamp, desert, plains
  edges) gets replaced on touch. Trace against the planning map (`node tools/map.mjs`, `--region`
  and `--ppm` to zoom), re-bake (`node tools/bake-island.mjs` → `heightmap.bin`, `biomes.bin`,
  `forest.bin`, `world-meta.json`, then `node tools/bake-navmesh.mjs`), and let the validators fail
  loudly. Runtime reads the baked grids (`heightAt`, `biomeAt`, `forestMaskAt`), never the polygons.

## Dev commands

- `npm run dev` — Vite dev server
- `npm run build` — tsc + vite build (must pass before any "done")
- `npm run preview` — serve dist locally

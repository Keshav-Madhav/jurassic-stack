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
  decision. `tools/hand-geometry.mjs` holds the whole island: the COAST outline, the RANGES' crests
  (a height per vertex = the skyline), the HOLM plateau, the RIVER (legs + still ring + ford), the
  LAKES/reservoir shorelines, the FORESTS and glades, and the RUINS' coordinates. No
  center+radius+noise, no sine meanders; the shortcuts still in the bake (swamp, desert, plains
  edges) get replaced on touch (M10c). Workflow: trace against the planning map (`node tools/map.mjs`
  — `--sketch` draws the geometry alone before any bake, `--region`/`--ppm` zoom), re-bake (`node
  tools/bake-island.mjs` → `heightmap.bin` (row-delta int16), `biomes.bin`, `forest.bin`,
  `world-meta.json`; then `node tools/bake-navmesh.mjs`), and let the validators fail loudly (uphill
  river, ring off level, lake below its shore, ruin wet/steep/wooded/unreachable). Runtime reads the
  baked grids (`heightAt`, `biomeAt`, `forestMaskAt`) and `world-meta.json`, never the polygons.
- **The canvas is 4×4 km** (HALF_SIZE 2048, 2049² @ 2 m, 32×32 chunks + 8×8 far super-chunks).
  Gates and QA tools read coordinates from the world (`__g.game.spawn()`, `gateSite()`, meta) — never
  hardcode a position. Every round re-shoots `tools/aerial.mjs` and `tools/qa-forest.mjs --tris` and
  keeps the per-view triangle/draw-call/JS-ms numbers honest: culling and LODs are part of the
  feature, not a follow-up. `tools/qa-crater.mjs` shoots the finale (ravine, crater, beacon lit,
  credits). When reachability fails, `NAV_PROBE="x,z;x,z" node tools/bake-navmesh.mjs` adds probe
  targets, and the navmesh is written regardless so `findClosestPoint`/`computePath` can bisect it.
- **Draw calls are the frame budget** (M18): this scene is CPU-bound on `renderer.render` — ~15 µs a
  call — so the wood-line view must stay near 400 calls (`tools/qa-draw.mjs` prints calls per family
  and per scatter kind). Anything new that draws: give it a distance it stops at, fold submeshes,
  batch per 256 m cell. Anything new with a material or texture: it must exist in the scene (even
  hidden) before the load-time warm-up in `main.ts`, or hook `Dino.onFirstRig`-style — a first-sight
  compile is a 100–200 ms stall. Never calibrate or measure a rig that isn't attached to the scene.
- **Hand shelves and cuts are re-laid after erosion.** Anything the player must walk (the Ravine
  floor, the crater bench, the gate apron) is asserted again in the `reassert` pass — droplets and
  talus turn a designed ramp into steps the navmesh won't climb.

## Dev commands

- `npm run dev` — Vite dev server
- `npm run build` — tsc + vite build (must pass before any "done")
- `npm run preview` — serve dist locally

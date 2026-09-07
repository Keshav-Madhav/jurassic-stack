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
- **Rig materials are shared across clones** (M29): `SkeletonUtils.clone` keeps the GLB's materials, so
  any tweak in a per-dino `load()` runs once PER CLONE — a ×1.6 tint became ×1.6⁴⁰. Multiplicative or
  one-time material edits go in `loadModel()` (once per URL, guarded); per-instance looks (the alpha)
  clone the material first. `__g.game.rigAlbedos()` prints colour × texture average per species.
- **Flat grey is plaster; hex is dark** (M22/M27): under this sun + ACES any untextured mid-grey renders
  white — give stone `makeStone()` (stone-material.ts, world-space triplanar) rather than a darker
  colour. And `new Color(0x4a4440)` is sRGB → 0.068 linear; when a value is meant in linear terms use
  `setRGB()`. A probe printing `material.color.toArray()` settles it in one line.
- **Object count is the frame budget** (M24): three.js walks every object in the scene graph every
  frame — hidden or not — for `updateMatrixWorld` and `projectObject`; 18K objects cost 12 ms of CPU
  before a single draw call. Anything with a "hidden" state (a far cell, a dormant dino, a chunk at
  another LOD, a distant ruin) is DETACHED from the graph, never `visible = false`. The warm-up in
  `main.ts` re-attaches everything once (`showAll()`), so a new detachable layer must join it.
  `tools/qa-gpu.mjs` (GPU timer queries) tells GPU time from CPU time before anyone guesses.
- **Point lights go through the LightRig** (M20/M31): the island has THREE point lights, and
  `lights.ts` walks them to the three nearest emitters five times a second. Anything that glows
  registers an emitter (`lights.add({x, y, z, intensity, distance, color})`) and mutates its
  intensity to flicker; nothing creates a `PointLight`. Never hide a light with `visible = false` —
  the scene's light count is a shader define, and changing it recompiles every material (a
  multi-second freeze). Measured cost of a light on this GPU: ~0 ms (3 vs 10 is the same frame,
  `gate-perf --lights=7`) — the rig is for the recompile hazard and for uncapping the fires, not fps.
- **Measure at 2560×1440, warm, frozen, vsync off, p10** (M31): four earlier profiles were wrong in
  four different ways. Attribution must be ADDITIVE (hide everything, reveal one layer at a time) —
  hiding one layer of an overdrawn scene just moves its pixels to the layer behind. The world must be
  frozen (`__g.setFrozen(true)`) or a passing herd moves the number 3 ms. Chrome needs
  `--disable-gpu-vsync --disable-frame-rate-limit` or every frame reads 16.7 ms. And nothing is warm
  for 30 seconds: spawn reads 11 ms until then and 6.5 ms after. `tools/qa-gpu.mjs`,
  `tools/gate-perf.mjs` and `tools/qa-hitch.mjs` all do this; see PERFORMANCE.md.
- **Sound: `sfx.ts` for events, `ambience.ts` for the bed** (M35). One AudioContext, opened by
  ambience on the first gesture; sfx hangs its own bus off it. Events call `sfx.play(id, { at })`
  with a WORLD POSITION and let the mixer do distance and pan — never gate on distance at the call
  site. Animals do not name samples: they call `this.say('roar' | 'call' | 'hurt' | 'die' | 'eat')`
  and `Dino.onVoice` in main.ts picks the sample and the pitch from the species. New samples go in
  `BANK` (they are all preloaded — a sample that has not decoded does not play) and in ASSETS.md
  with their CC0 provenance. `tools/gate-sound.mjs` proves a sound actually reached the speakers,
  which is the only way to test a mix you cannot hear.
- **`ready` means WARM** (M34): the boot card (index.html `#boot`) stays up until every species has
  compiled its shaders, uploaded its skin, captured its impostor card and been drawn into the shadow
  map once. Anything new that a player meets later — a species, a buildable, a biome's props — must
  either exist before the load warm-up or warm itself behind that card. `renderer.compile(root,
  camera, scene)` compiles a DETACHED, HIDDEN root against the live scene (it walks with `traverse`,
  not `traverseVisible`), which is how a rig warms without ever being drawn cold.
- **A hitch is a first sight** (M31): the steady frame is fine (5–7 ms GPU at 2560×1440). What the
  player feels is the frame that uploads 54 textures or compiles 21 shaders because they walked
  somewhere new. Anything that loads a model registers it with `registerWarmRoot()` (uploads.ts) so
  the upload warden pushes its textures to the GPU before anything draws them; anything that compiles
  at runtime uses `renderer.compileAsync`. `tools/qa-hitch.mjs` walks a lap and prints the worst
  frame per region with its section breakdown, plus programs and textures created.
- **Hand shelves and cuts are re-laid after erosion.** Anything the player must walk (the Ravine
  floor, the crater bench, the gate apron) is asserted again in the `reassert` pass — droplets and
  talus turn a designed ramp into steps the navmesh won't climb.

## Dev commands

- `npm run dev` — Vite dev server
- `npm run build` — tsc + vite build (must pass before any "done")
- `npm run preview` — serve dist locally

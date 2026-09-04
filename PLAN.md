# Jurassic Stack — Plan of Record

A browser ARK-like survival game: hunt, tame, ride, build, survive, on one handcrafted island.
Private and non-commercial, built to eventually be played with three friends.

This file is the repo-local equivalent of the "Jurassic Stack" dossier artifact
(https://claude.ai/code/artifact/b72ce357-5e46-4c50-8e0b-eed312c561af). If they diverge, this file wins.
Research verified 2026-09-01 against npm/GitHub (three.js r185 current). Task ledger: `CHECKLIST.md`.

---

## North star: stupidly fun, honestly made

A polished core, a chaotic surface, an island that means something. Every trade-off filters through one
question: **does this make a better story at the table?**

This is a toy, not a product — built for four people, measured by whether somebody laughed out loud,
whether tonight's session produced a moment that gets retold next week. The game is a machine that
produces stories. Four pillars:

1. **A polished floor.** Everything the player touches fifty times an hour gets real polish passes until
   it feels *good*, not merely functional: movement, camera, riding, combat feel, the taming ritual,
   building snap, inventory flow, saves. Chaos is only funny on a solid floor (Gang Beasts plays as
   slapstick but its inputs are tight). If the core fights the player, jank stops being comedy and
   becomes an excuse.
2. **Chaos on the surface.** The emergent layer is licensed to be unhinged: physics interactions, dino
   pathfinding "decisions", stampedes, chain reactions, ragdolls on every death/knockout/high-speed
   dismount (one instrument in the orchestra, not the song). Mess is *aimed* at the layer where it
   generates stories and kept out of the floor. Bug triage asks "funny or frustrating?" before
   "correct or incorrect?"; a funny bug gets promoted to mechanic before it gets fixed.
3. **An island that means something.** The map is the narrative: a lost civilization's ruins densify
   from broken beach fragments to intact inland temples. Difficulty is geography — a legible danger
   gradient from the gentle spawn coast to the interior. The volcano at the island's heart is visible
   from the first beach: the ending, in view the entire game.
4. **A sandbox with a shape.** Survival creative sandbox first — tame, build, explore, forever, no
   obligation. The arc (below) is an optional guided path, Minecraft-style: the Ender Dragon exists
   and nobody makes you go.

**Enforcement rule:** every feature must serve the floor, feed the chaos, or advance the arc.
A feature that does none of those is a checklist item wearing a costume, and it gets cut.

---

## Decisions on record

1. **Full ARK clone out; full ARK loop in.** One dense island — **4×4 km since 2026-09-04** (the
   2×2 km original was too small to carry its own water story; see "The island v2 — the Lasso") —
   15+ species, ~30 items, the complete hunt → tame → ride → build → survive loop. Density beats
   acreage: the bigger canvas exists to give one river, two lakes and a reservoir room to breathe,
   not to spread the same content thinner.
2. **The island is handcrafted — authored as code, not randomized.** A composition file places every
   mountain, ridge spline, river, and ruin deliberately; an erosion bake makes it look real; the baked
   heightmap/splatmaps/prop placements are committed one-time artifacts.
3. **The AI authors, the human directs.** Built through a screenshot-review loop (authored camera
   vantages, including eye level) plus automated validators. Two jobs stay human: art direction
   (~1–2 h/week reacting to screenshot batches) and playtesting (game feel lives in hands on WASD).
4. **Free assets only, eyes open.** Private non-commercial → the censused free roster. Gray-provenance
   assets keep the repo private and never deploy publicly under the author's name. CC-BY-NC picks cap
   any future public release; accepted.
5. **Single-player first; four-friend co-op later via P2P.** Following the minecraft-JS pattern:
   static Vite build on Vercel, so co-op is **PeerJS/WebRTC with the host player's browser as the
   authority** — no server at all. A bounded milestone, not the MMO cliff. Not started until the
   single-player loop is fun.
6. **Caves are portal-loaded spaces, not voxel terrain.** Hand-placed interiors entered through
   terrain openings (the ARK approach), not a marching-cubes rewrite.
7. **Flyers and swimmers are systems, not species.** A Pteranodon is a new movement mode and camera
   rig (+~2 weeks), not a 16th land dino. Land roster first.
8. **Sandbox first; the arc is optional guidance.** Progression is diegetic and capability-gated:
   no XP walls, quest logs, NPCs, or cutscenes.
9. **Build pattern = minecraft-JS.** Vanilla three.js + strict TypeScript + Vite (`base: './'`),
   flat `src/scripts/*.ts` modules, DOM HUD over the canvas, root-level playwright-core `.mjs`
   harness scripts, `vercel.json` static deploy (netlify.toml backup). No React, no framework.

## The six technical calls

1. **Ship WebGL2; port to WebGPU later.** The perf-critical libraries (InstancedMesh2, pmndrs
   postprocessing, N8AO) are WebGL-only. Isolate shader customizations so the TSL port is a port.
2. **Art direction (decided at M2, 2026-09-01): filmic-vivid hybrid keyed to time of day.**
   The M2 batch (PBR raptor in the Quaternius forest) settled it: ACES filmic base at midday,
   grading ramping toward the vivid treatment (warmer key, saturated fog, colored rim) as sun
   elevation drops — the user picked filmic-noon and vivid-golden as the two ends of one curve.
   Mixed fidelity (PBR creatures in a low-poly world) holds. Provisional caveat: judged without
   real sky/shadows/rays — re-review checkpoint when Sky + CSM + post land at M5/M6.
3. **A free 15+ dino roster is real.** ~20 rigged+animated species censused, ~13 original CC-BY.
   Costs: style spread (three fidelity tiers) and animation poverty on some originals.
4. **Physics is Rapier, pathfinding is Recast — both bake-friendly.** `rapier3d-compat` with a
   heightfield collider; `recast-navigation-js` navmesh baked in Node at build time, DetourCrowd at
   runtime.
5. **Rivers are solved in three.js core.** Official `Water2` addon = flow-map water. Ocean (`Water` +
   Gerstner layer), `Sky`, and CSM shadows are official addons too.
6. **Biomes (ill-inc) is the genre reference codebase** — MIT, production browser MMO with ECS,
   crafting, inventory, building, admin editor. Study before designing any gameplay system.

---

## Feasibility & effort

| Phase | Contents | Wall-clock (steady part-time) |
|---|---|---|
| Graybox + core loop | flat island through the real chunk renderer, shared mover, one dino; gather → craft → build → tame → ride, zero polish | 2–3 weeks |
| World pass | real island bake, biomes, rivers/lakes/ocean/waterfalls, ruins | 1–2 months |
| Optimization suite | foliage at scale, LODs/billboards, CSM, post, KTX2 streaming, settings menu | 1–2 months profile-iterate |
| Species & depth | roster to 15+ via species table, combat, survival tuning | cheap per-unit, ongoing |
| Co-op (stretch) | PeerJS host-authority for 4 players | ~1 month |
| **Full vision** | everything above, single-player complete | **~4–8 months elapsed** |

**Division of labor.** Claude: all systems, island authoring, asset intake/licensing, profiling,
E2E checks. Human: art direction (screenshot batches), playtesting feel, the taste calls.

**The scoping trap.** Taming-and-riding is the demo. The graybox of the *entire* loop ships before any
visual polish. Only three things are built for scale from day one (they can't be retrofitted): the
chunk grid, instancing discipline, and the data-driven species table — a stats/behavior/clip-map row
per species and one generic dino brain, so dino #15 is an afternoon, not a rewrite.

---

## The stack (verified 2026-09-01)

| System | Pick | License |
|---|---|---|
| Framework | **Vanilla three.js + TypeScript + Vite** (minecraft-JS pattern); DOM HUD; no React | MIT |
| Physics | `@dimforge/rapier3d-compat` 0.20 — heightfield terrain, capsule movers, sensor water volumes | Apache-2.0 |
| Character control | Rapier `KinematicCharacterController` in our own "mover" class, shared by player + rideables | — |
| Pathfinding | `recast-navigation-js` — navmesh baked at build time (Node), DetourCrowd for chase/follow; steering for ambient wander | MIT |
| Creature AI | `yuka` steering + FSM (frozen-but-done software) driving the Rapier movers; hand-roll (~500 lines) acceptable fallback | MIT |
| Ragdolls | Hand-rolled on Rapier impulse joints — rig-builder walks each skeleton once → 6–12 jointed capsules; passive only, transient, freeze after settling | ours |
| Terrain render | Hand-rolled fixed chunk grid (~16×16 × 128 m), 3–4 index-buffer LODs + skirts (SimonDev refs) | ours |
| Terrain shader | Splatmap + height-weighted blend + slope-gated triplanar + texture bombing via `three-custom-shader-material` | MIT |
| Erosion | Hand-rolled Node bake script: droplet (SebLague port, ~150 LOC) + thermal (~30 lines) | ours |
| Water / sky | Official addons: `Water2` (rivers/lakes, flow maps), `Water` + hand-rolled Gerstner (ocean), `Sky` + PMREM rebake (day-night); baked shore-distance foam; height-fog chunk patch | MIT |
| Foliage | `@three.ez/instanced-mesh` (InstancedMesh2) — per-instance BVH culling + LOD + shadow LOD; billboard cross far-LOD; agargaro octahedral impostors when released | MIT |
| Raycasts | `three-mesh-bvh` — building placement, ground snap, projectiles | MIT |
| Skinned crowds | Distance-throttled `AnimationMixer`, shared skeletons per species, ≤40 bones LOD0; distant = position+state tick, no skeleton | patterns |
| Shadows | Built-in three CSM addon (`three/addons/csm/`) — NOT the dead `three-csm` npm package | MIT |
| Post | pmndrs `postprocessing` + `n8ao` (halfRes/samples wired to settings); AVOID realism-effects | Zlib / ISC |
| Particles | `three.quarks` + quarks.art WYSIWYG editor | MIT |
| Asset pipeline | `gltf-transform`: meshopt (not Draco) + KTX2 (ETC1S albedo / UASTC normals+ORM; watch alpha-foliage fringing); island streamed as chunked GLBs | MIT |
| Saves | `idb-keyval` blobs (Dexie only if saves outgrow blobs) | Apache-2.0 |
| Input | Hand-rolled key state for movement (minecraft-JS style); `tinykeys` for menu chords | MIT |
| Co-op | `peerjs` — host-authority P2P, later milestone | MIT |
| Profiling | `stats-gl` (CPU+GPU ms), Spector.js, three.js DevTools extension | — |
| Map editor | Fork of `ZyFou/ProceduralTerrains` (MIT) for brushes/prop painting → heightmap/splat/prop JSON | MIT |

**Renderer:** WebGL2 (`WebGLRenderer`) now. WebGPU/TSL port is a later milestone, not a blocker
(r185 addons already ship TSL twins: SkyMesh, WaterMesh, Water2Mesh, CSMShadowNode).

**Reference codebases:** Biomes (ill-inc, MIT — gold standard for genre architecture);
SimonDev repos (Quick_3D_MMORPG, ProceduralTerrain_Part10, Quick_Grass); Sketchbook (character state
machine patterns; archived); dgreenheck + vyse12138 minecraft clones (chunking, save/load);
brunosimon/infinite-world (unlicensed — study only); **local `~/Repositories/minecraft-JS`**
(the house pattern: build, deploy, harness scripts, PeerJS net code in `src/scripts/net.ts`).

---

## Assets

**Dino roster (censused 2026-09-01).** ~20 rigged+animated species at $0 in three fidelity tiers.
Build around tier (a); decimate tier (b) fills; Quaternius CC0 six as instant fallbacks.

Tier (a) — game-ready 8–26K-face PBR, CC-BY unless noted:
- Velociraptor (26 clips), Stegosaurus (13), Pachycephalosaurus (21) — ferociousindustries.matthias:
  sketchfab.com/models/8f1744af7b0847a2aabe3df90be802f0 / ec254ea1554941fe8a131f62db0faf3d / 6eea5cee4afa4730bf75c6329a43e56d
- T-Rex (5 clips) — LasquetiSpice: sketchfab.com/models/38007d947ae74dea83988cb0b08ee053
- Triceratops (13, Unity root-motion) — sketchfab.com/models/d5658e6fe77d40bda00d59bb840cd856
- Brachiosaurus (5) — ValeGoG: sketchfab.com/models/fa1f38e22804414da22b464e0ac0e794
- Therizinosaurus (4) — victory_: sketchfab.com/models/de82fe0d9e3f468b95790c0ef517723e
- Allosaurus (8, **NC**) — sketchfab.com/models/5de1fcc39f314723b5e230ab0730f713
- Carnotaurus (8, origin unclear) — sketchfab.com/models/41927d12f870431f92613025e8816839
- Terror bird (11, origin unclear) — sketchfab.com/models/41ce87a9f3a3498da1141b7645e0e4fb
- Pteranodon (3, flyer) — sketchfab.com/models/7d7683df41d1405283f160e81a5dff1b
- Columbian mammoth (3, NHMLA museum, **NC-SA**, stylized 1.7K) — sketchfab.com/models/e47d442b22d64fbd9a3b7a539fc47987

Tier (b) — heavy sculpts to decimate (mostly 1 clip): Spinosaurus (~98K, c11709dbf9e3472f9533343f1f342564),
Mosasaurus (67K, **NC**, 4a1feecff6c7468b8c07ba0ad439e0e0), Sauropelta (83K, c6373f12f3954facb8d5fe48055c9161),
Dilophosaurus (87K, 3 clips, 32ed5b98069b4acd8865ac506a2b9b4f), Quetzalcoatlus (200K).
Weak spots: Gallimimus/Baryonyx exist only as rips — skip or Quaternius-substitute.

Fallback + fauna: Quaternius Animated Dinosaur Pack (6 species, 6 clips each, CC0, glTF via
poly.pizza/bundle/Animated-Dinosaur-Bundle-SmoLdBLO2K) + Ultimate Animated Animals (12 species, CC0).
Upgrade path if style spread annoys: polyperfect packs ($50, ~23 consistent species, buy direct).

**Rules from the census:** rips (Primal Carnage/JWA/ARK/Turok relabeled CC-BY) are void licenses —
mostly unnecessary now; anything used keeps the repo private. Sketchfab auto-glTF sometimes breaks
multi-clip exports — spot-check every download in gltf-viewer. Download and archive local copies
immediately; listings vanish.

**Player:** KayKit character + 133 CC0 survival animations (chop/dig/fish/hammer/pickaxe) —
kaylousberg.itch.io/kaykit-character-animations. Mixamo for one-off clips (bake onto one skeleton in
Blender; avoid runtime retargeting; humanoids only).

**Nature:** Quaternius Stylized Nature MegaKit (116 models, 40 trees) + Ultimate Nature (150, CC0);
biome variety = re-tint flat colors. Kenney Nature Kit filler.
**Ruins/building:** Quaternius Ultimate Modular Ruins (90 pieces) + KayKit Medieval Builder /
Dungeon Remastered (caves). All CC0.
**Textures:** stylized CC0 (FreeStylized, OGA hand-painted) over vertex-colored terrain; PolyHaven/
ambientCG (CC0) if realistic wins the art test.
**Audio:** Kenney (CC0), Sonniss GDC bundles (royalty-free, no attribution), freesound CC0-filtered.

---

## The island: authoring plan

- **Composition file → erosion bake → committed artifacts.** Declarative features (peaks, ridge
  splines, valleys, biome zones, river paths, ruin sites, spawn zones) → Node droplet+thermal erosion
  → heightmap, splat weights, flow maps, prop placements as committed files. Deterministic, diffable.
- **Screenshot loop + validators.** Every bake re-shoots authored vantages (top-down, oblique,
  eye-level) for art review; validators fail the bake on floating rocks, underwater trees, ruins on
  40° slopes, spawn zones inside cliffs, uphill river segments.
- **Water.** Rivers are splines: mesh extruded along them, spline tangent = current force inside the
  volume. Lakes carved; ocean on the west edge; waterfalls at cliff transitions (bent-plane shader +
  quarks mist).
- **Fill.** Biomes as hand-painted zones (forest, jungle, swamp, snow highlands, beach) driving ground
  palette + foliage set + spawn table. Foliage scattered by painted density masks with a fixed seed.
  Ruins: 5–6 prefabs placed by rules, sunk, partially deleted, overgrown. Caves: portal interiors.
- **Scale:** 4×4 km (was 2×2), dense. The composition encodes the arc: gentle spawn coast, danger
  gradient inland, ruins densifying toward the caldera, volcano sightline from spawn.
- **The hand-made mandate (2026-09-04).** World geometry is traced by hand, every vertex a decision:
  the coastline, the river, lakes, forests, glades, biome edges and ruin sites all live as polygons and
  paths in `tools/hand-geometry.mjs`, traced against the planning map (`tools/map.mjs`). Formula
  shortcuts (center+radius+noise, sine meanders, seeded masks) are gone or go on touch. The bake
  carves what is drawn, erodes it, and its validators fail loudly (uphill river, lake below its
  shore, ruin standing in trees, ruin unreachable).

## The island v2 — the Lasso (2026-09-04, supersedes the two-river layout)

The 2 km island carried two rivers, three lakes, a swamp and a desert and read as a diorama. The v2
story is fewer, larger, deliberate features on a 4 km canvas. North is −z; spawn stays on the south
coast; the volcano stays north-centre, the ending in view from the first beach.

**One river — the Lasso.** It rises at the coast and returns to the coast, and in between it ties a
knot around an island-within-the-island:

- **The Wellspring.** The river is born at the north-east shore where the East Range meets the sea: a
  gorge opens onto the ocean and the river pours out of its mouth from a spring pool a few dozen metres
  up (~36 m) — from the beach it looks like the river comes out of the sea cliffs. That elevation is
  what gives the inflow leg its gradient and its current.
- **The inflow leg** runs south-west inland, downhill the whole way, to **the Knot**.
- **The Knot and the Reservoir.** At the Knot the river crosses itself: four arms of water meet
  (inflow, outflow, ring-north, ring-south) in one deep, wide basin — the Reservoir, the island's
  deepest fresh water (~14 m surface, 10+ m deep). The swamp sits in its lee: the extra wetness is why.
- **The Ring — the waterlock.** From the Knot the river circles a ~700 m island-within-the-island, **the
  Holm**, and comes back to the Knot. The ring is dead water: level surface at the Knot's elevation, no
  current at all — `riverFlowAt` returns nothing inside it, swimmers drift nowhere. The current dies
  where the inflow meets the Reservoir and picks up again where the outflow leaves it.
- **The outflow leg** runs from the Knot south-east, downhill, deltas through the swamp, and reaches the
  sea. Gradient: Wellspring 36 m → Knot 14 m → sea 0, over ~1.4 km each way.
- **The Ford.** One shallow gravel bar on the ring's far (west) side, knee-deep and walkable: the only
  way onto the Holm without swimming, and the only way a dino gets across. The navmesh reachability
  validator depends on it.
- **The Holm.** Old-growth of **redwoods** — the tallest trees on the island (60–80 m, bare red
  trunks, narrow high crowns), and they grow *nowhere else*. From anywhere on the south half you can
  see the Holm's canopy standing above every other wood. It holds a ruin.

**Two lakes + the Reservoir.** Neither lake touches the river, and they sit at different heights:

- **Lake Aster** — the big lowland lake in the west (~500 m across, surface ~9 m), traced shoreline with
  bays and a peninsula; the Westwood on its north shore, the desert's edge on its south.
- **The Alpine Tarn** — a small lake among the mountains, high in the West Range (~230 m), cold and
  clear, snow on its rim. A destination, not scenery: a keystone climb ends there.

**Mountains, bigger.** Two ranges as hand-traced crest paths with a height at every vertex: the **West
Range** (long, N–S along the west side, peaks 350–420 m, the Tarn in its saddle) and the **East Range**
(NE quadrant, peaks ~340 m; the Wellspring gorge cuts its seaward foot). Snow above ~200 m, terraced
rock bands on the flanks, real passes where the crest heights dip. **The volcano** grows with the map
(rim ~320 m); the caldera gate stands at its south foot, visible on approach.

**Biomes by hand, bigger.** The **swamp** (~700 m) wraps the Reservoir's east and south and the
outflow delta. The **desert** (~1 km) fills the south-west rain shadow behind the West Range, between
Lake Aster and the south-west coast. **Plains** open the south-centre between the spawn beach and the
ring — herds, bush seas, the odd lone tree. **Alpine** is altitude. All edges traced polygons, none of
them round.

**Forests, as dense as v1's M9g.** The Southwood (first forest, a meadow north of the beach), the Holm
redwoods, the Eastbank along the inflow gorge, pines on both ranges' flanks and the northern rise, the
Westwood above Lake Aster, the Lakeshore. Glades at every ruin plus two meadows.

**Ruins, hand-placed** along the arc gradient: beach statue → coast shrine → the Holm temple → highland
arch → foothill vault → caldera gate, each site a chosen coordinate validated flat, dry, reachable.

**Performance is part of the story at 4 km** — the map only grows if it stays 60 fps: 32×32 terrain
chunks with 4 LODs and frustum culling; scatter in 256 m supercells with distance-culled ground cover
and three tree LOD bands (full / coarse / blob) per cell; nothing beyond the fog paid for at full
detail; per-vantage triangle budgets checked by the QA harness; dino updates throttled by distance.
Any step that breaks the budget is not done.

**Build order (one round each, verified and committed before the next):**
M10a canvas + coast + landmass + ranges + volcano + the Lasso river (structure, still ring,
reservoir, ford) · M10b the two lakes · M10c biome edges by hand (swamp, desert, plains) · M10d
forests retraced + the Holm redwoods · M10e ruins hand-placed + the caldera gate visible · M10f swamp
and desert flora · M10g ground clutter · M10h boulders and outcrops.

## The arc: an optional guided path

Sandbox first — no dialogue, no quest log, no obligation. For anyone who wants direction, five acts
told through geography, ruins, and what you can't survive yet (v1 design, playtest-subject):

1. **Washed ashore — the gentle coast.** First fire, driftwood tools, thatch hut. The volcano is
   visible from the spawn beach — the ending, in view from minute one. First ruin: a broken statue
   pointing inland. That statue is the entire tutorial.
2. **First tame — the forest.** Torpor-knock a raptor-class. First capability gate: the grasslands are
   patrolled by things that outrun you on foot. Mounted, the island opens.
3. **Saddle up — grasslands & rivers.** Bigger tames, the real base, rivers as highways. Each major
   ruin holds a **keystone** and a climbable vantage revealing the next region — map unlock by
   climbing and looking, not UI.
4. **The dark places — swamp, snow, caves.** Environmental gates: cold demands fur gear off megafauna,
   the swamp demands an aquatic tame; three fear-themed caves (dark, deep water, tight squeezes) each
   guard a keystone.
5. **The summit.** All keystones unseal the caldera door; the island's one scripted monster — an
   oversized alpha apex — guards it. Your tame army is your progression made flesh. Behind the door:
   what the ruin-builders left, and a choice — light the great beacon and roll credits, or keep living
   as the island's new apex. Either way the sandbox continues.

**The Wayfinder:** a compass relic on the first beach that points to the next arc beat. Carry it =
guided playthrough; leave it in a chest = pure sandbox. One item replaces the tutorial/quest system.

**Rules:** capability gates, not level gates. The ruins are the tech tree (recipes past timber tier
learned from tablets — engrams as archaeology). Tames are the skill tree. Nothing in the arc grants
anything the sandbox can't get.

## Multiplayer: the four-friend plan (later)

PeerJS host-authority P2P, per minecraft-JS (`src/scripts/net.ts` there is the reference): the host
player's browser owns the world (dino AI, taming, building, inventory, time); guests predict their own
character and interpolate the rest. No server, works on static Vercel hosting. Interest management,
sharding, and anti-cheat deliberately skipped (friends-only trust). Persistence = host's save file.

---

## Hand-write list (no library covers these)

| System | Notes | Rough size |
|---|---|---|
| Terrain chunk renderer | fixed grid, index-buffer LODs, skirts | ~1 week |
| Splat terrain shader | height-blend, triplanar, texture bombing on CSM | ~2 days |
| Erosion bake script | droplet + thermal, Node, one-time | ~2 days |
| Grass wind shader | vendored from reference repos, per-chunk | ~2 days |
| Gerstner ocean layer | ~80 lines GLSL + CPU mirror for buoyancy | ~2 days |
| Waterfall + height fog | scrolling sheet shader; fog chunk patch | ~3 days |
| Riding / mounting | seat-bone attach, input redirect, camera boom | ~1 week |
| Swimming / buoyancy | sensor volumes, movement mode, Archimedes | ~3 days |
| Ragdoll rig builder | Rapier joint chains from skeletons; death, KO, dismount | ~1 week |
| Taming & creature FSMs | torpor, feeding, loyalty — data-driven species table | ~1–2 weeks |
| Building snap system | socket grid: foundation → wall → ceiling | ~1–2 weeks |
| Inventory / crafting / HUD | DOM over the canvas (minecraft-JS pattern) | ~2 weeks |
| Spawn & biome tables | zones painted in the editor, data-driven | ~3 days |
| Progression layer | keystones, recipe tablets, Wayfinder, caldera finale | ~1–2 weeks |

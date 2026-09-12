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
10. **Performance is a contract, not a phase (2026-09-07).** Reference machine: an integrated-GPU
    Windows laptop at 1080p, **30+ fps at native resolution**. Proxy: the M5 Pro at 2560×1440,
    ≤ 12 ms GPU per frame, gated. Resolution scaling is the player's last resort, never the default
    fix. The causes, the levers in order and the instruments are in **`PERFORMANCE.md`**; every lever
    is measured at the user's pixel count before it lands. (The old plan said "profile-iterate" and
    QA ran at 1280×720 — a quarter of the real screen. That is how "60 fps" and "dips to 30" were both
    true.)
11. **Death costs something.** Dying drops what you carry into a corpse bag at the spot (recoverable
    for ~5 minutes); you respawn at your bedroll if you placed one, else the beach. Health, food and
    water reset. No XP, no levels — the pack is the stake. (Today death is a free teleport; survival
    can't matter until it isn't.)
12. **One visual identity, graded in post.** The assets are four styles (Sketchfab textured dinos,
    Quaternius flat dinos, Kenney kit, hand-built trees) and it shows. Decision: commit to stylized and
    unify with one colour LUT at the end of the frame (cheap, one pass) before considering the
    polyperfect pack. Materials are normalised on intake (metalness 0, roughness ≥ 0.55, albedo in
    10–25% — the M29 audit) so the LUT has a consistent input.
13. **Day length 15 min** (was 10): a campfire evening gets to breathe; survival drains rescale with
    `DAY_LENGTH_S` automatically.

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
| Performance contract | see `PERFORMANCE.md`: light culling, opaque grass, depth pre-pass, sky cubemap, far terrain, occlusion queries, shadow caching, KTX2, presets — measured at 2560×1440, gated ≤ 12 ms GPU | 3–4 rounds, then held by the gate |
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

**Behind the door (M17, 2026-09-05): the Ravine and the Crater.** The door in the rock face opens on a
hand-traced **slot canyon** — 16 m wide, walls at 67°, a floor that climbs 71 → 175 m over a 380 m
switchback up the cone's south flank (`RAVINE` in `tools/hand-geometry.mjs`; cut before erosion so the
walls weather with the cone, re-laid after it so talus and silt can't step the floor). It tops out on
the **crater bench**, a 175 m shelf sunk 100 m under the rim — the summit is a real bowl now, not a
dished dome — where the Beacon's court stands: eight columns, two guardians facing the mouth, an arch,
and the basalt brazier itself (`beacon.ts`). Bare ash: no grass, no flora, only rockfall. The navmesh
admits exactly the slot floor and the bench inside the cone; the population never spawns there. The
scripted alpha guarding the door and the "keep living" choice remain as written below.

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

**The volcano is found, not shown (2026-09-05).** Real fog now (subtle onset ~140 m, gone by
~1.5 km): from the spawn beach you see the meadow, the wood line and haze — the ranges, the Holm's
redwoods and the volcano reveal themselves as you go inland. This revises the M2 "volcano visible
from minute one" pillar on purpose: the user asked for fog that hides the far skyline from a fresh
spawn, and the arc gains a first reveal. The beach statue still points the way.

**Survival (M21, 2026-09-06).** Food, water, stamina — tuned for the 10-minute day (a full stomach
~1.5 days, a full waterskin under a day), stamina gating the sprint (9 s burst, 6 s refill, winded
under 25). Carcasses harvest into raw meat + hide, campfires cook, the saddle costs hide: kill → skin
→ cook → ride is now one loop. Still to come: cold on the ranges (fur off mammoths, PLAN beat 4),
torpor as a player stat, water/food from more sources (fruit trees, springs), and a hunger drive for
the dinos themselves.

**The ecology (M19, 2026-09-05).** The species table gained `diet` and a third temperament
(`defensive`), and the one generic brain gained a half-second *think*: carnivores hunt what they can
take and feed on the kill, skittish herbivores flee, defensive ones stand their ground against anything
smaller and charge inside 16 m, herds drift together. Balance rule of thumb: a predator wins the hunts
it picks but pays for it (a carno takes a trike at ~10 bites and leaves with a quarter of its health).
Player-facing aggro is unchanged. Still to come here: hunger as a drive (not just a cooldown), tames
defending their owner, alpha variants, the ragdoll for kills.

**Later, deliberately not now (user, 2026-09-05):** terrain **tessellation / displacement** for
close-range ground detail (rocky lips, ruts, root bulges) — worth doing once the current budget
has headroom; it competes with everything else for GPU time.

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

*Status 2026-09-12 (after M91): beats 1–3 and 5 are built (the beach statue, twelve keystones / eight
open the door, the caldera door in the Ravine's throat, the Gatekeeper alpha, the crater Beacon and
credits). Beat 4: **cold shipped M50**; the caves shipped M51 and were **CUT in M80** (see below);
the aquatic tame is excluded by the user. Survival (M21), the ecology (M19), the first-minutes hints
(M30), the ruins-as-tech-tree (M68), the Wayfinder item (M71) and the animation pass (M83–M91) are
in. **Note that only M76 and earlier are deployed** — see "What is left", §0.*

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
4. **The dark places — swamp, snow.** Environmental gates: cold demands fur gear off megafauna,
   the swamp demands an aquatic tame.

   **The caves are cut (M80, user's call: "completely remove caves… not just broken, they are not
   even close to 0.1% of correct").** A heightmap cannot have an overhang, so M51 built each one as
   a BOWL sunk into a hillside with a stone roof laid over it. That is not a cave — it is a pit with
   a lid, and no amount of tuning the darkness or the shell was going to make walking down into a
   dish feel like going underground. Cutting beats polishing something whose foundation is wrong.
   If caves come back they need decision 6's answer, which this project already wrote down and then
   did not follow: **portal-loaded interiors**, a separate hand-built space entered through a door,
   not terrain at all.
5. **The summit.** All keystones unseal the caldera door; the island's one scripted monster — an
   oversized alpha apex — guards it. Your tame army is your progression made flesh. Behind the door:
   what the ruin-builders left, and a choice — light the great beacon and roll credits, or keep living
   as the island's new apex. Either way the sandbox continues. *(Built M17: the Ravine climbs to the
   crater bench; E at the brazier with all five keystones lights it — fire, embers, a light the crater
   reads by, a swell in the ambience — and the credits card fades in over the world with the tally:
   keystones, tames, pieces built, island days lived. Any key dismisses; `beaconLit` is saved. The alpha
   at the door is still to come.)* *(M20: the Gatekeeper stands — an alpha rex on the causeway, slain
   once and for all when it falls. Twelve keystones now, eight open the door.)*

**The Wayfinder:** a compass relic on the first beach that points to the next arc beat. Carry it =
guided playthrough; leave it in a chest = pure sandbox. One item replaces the tutorial/quest system.
*(2026-09-07: still the N key + a toast. Make it the item — carried in a slot, a small compass rose
on the HUD that points, stowed in a chest to go sandbox. The M30 hints cover the first minutes.)*

**Remaining order (2026-09-07) — SUPERSEDED. Kept for the strikethroughs, which record what the
rounds actually cost; the list of what is LEFT is the audit below it, which was taken from the code
rather than from this list.**
1. **Animals alive** (feel) · ~~light culling + sky cubemap~~ **DONE M31 — and the round found the
   real enemy: hitches, not fill** (the steady frame is 5–7 ms GPU at 2560×1440; first sight of a
   region was costing 100–500 ms — closed in M33/M34/M36) · ~~sound~~ **DONE M35** (74 CC0 samples)
   · ~~the build tier from ruins~~ **DONE M68** (`engrams.ts` — a tablet at a ruin teaches a recipe).
2. ~~Ragdolls~~ **M41 did the honest version** — a directed, accelerating topple with a landing
   thud, not a jointed ragdoll · **opaque grass + far terrain** (perf, B+E — still open, and see the
   verdict below) · **the visual LUT + material normalisation** (polish — superseded by M42's post
   chain) · ~~cold on the ranges~~ **DONE M50**.
3. ~~Tames defend you~~ **DONE M36** · ~~hunger drive~~ **DONE** (`satiety` gates the hunt) ·
   **depth pre-pass + occlusion queries** (perf, C+F — still open) · ~~settings menu~~ **DONE M40**
   (key rebinding still open) · ~~waterfalls + swamp/pine interiors~~ **DONE M72/M73**.
4. ~~The Wayfinder item~~ **DONE M71** · **corpse bag death** (still open) · **shadow caching +
   KTX2** (perf, G+H — still open) · **playtest ritual: F8 report dump** (still open) · ~~caves~~
   **SHIPPED M51, CUT M80**.
5. ~~Roster honesty~~ **DONE M52**. The flyer and the aquatic are movement modes (decision 7).
6. **Co-op** last, as decided.

---

# WHAT IS LEFT — a full audit (2026-09-12, after M91)

*Taken from the code, not from memory: every "not built" below was checked by reading the source or
measuring the running game, and the measurements are quoted where they exist. Ordered by what a
player would notice first, not by what is easiest.*

## 0. The one that blocks everything else

**Fifteen rounds are not live.** `origin/main` is **M76**; local is **M91**. The deployed game has
none of: the caves cut (M80), the mountains reshaped with traversable summits and shoulders
(M81/M82), the woods re-traced with blended biomes (M79), the map's marker fix (M80), the whole
animation pass (M83–M91), or the rivers you can see into (M90). Everything is committed and green.
**Nothing else on this list matters until this is pushed.**

## 1. Decisions that are the user's, not the engine's

| | What | Why it is a decision |
|---|---|---|
| **Oxygen** | You can dive since M86 and nothing stops you staying down for ever | A sixth vital: a new bar, a new HUD row, a new save field, a drowning rule. The alternative — a soft timer that just pushes you up — is cheaper and less ARK |
| **Attacking from a mount** | `swing()` returns early while riding, so a tamed T-Rex is a fast way to travel and nothing else | Every piece exists (per-species attack clips, damage, reach, cooldown). It is a design call about whether mounts fight, not a build problem |
| **Replacing three rigs** | `dilo`, `sauropelta`, `spino` ship **one animation each**, re-timed for idle/walk/run/attack/death | Nothing in the repo can replace them; the Quaternius fallbacks are Apato/Parasaur/Stego/TRex/Trike/Raptor. A download, a licence line in ASSETS.md, and a re-check of facing, seat and clip slots |
| **Source maps in the deploy** | `sourcemap: true` ships **11 MB per deployment** | Harmless to players (Vercel serves brotli; the wire cost is already fine) but it is what filled the 10 GB storage quota. Keep for production debugging, or drop |

## 2. Attacking and being attacked

The thinnest system in the game, and the one a survival player spends the most time inside.

- **Melee is one button with no timing.** LMB swings on a 0.45 s cooldown; there is no **block**, no
  **parry**, no **dodge roll** (the rig ships a `Roll` clip nothing plays), no wind-up you can read
  on an animal before it commits. Every fight is walk-in-and-click.
- **No ranged weapon at all.** The spear is melee; its `throw` slot is a swing variant, not a
  projectile. No bow, no thrown spear, no sling — so there is no way to open a fight at range, which
  is what makes a big predator survivable without a mount.
- **No damage feedback on the player beyond a red vignette and a flinch.** No hit direction
  indicator, no stagger, no knockback on you (animals take knockback; you do not).
- **No weak points or hit zones.** A blow to the tail and a blow to the head are the same blow.
- **Torpor is invisible until you read the nameplate.** A KO has a number and no body language until
  it drops; the rigs that have a stagger clip could show the fight turning.
- **Dino attacks do not telegraph.** `attackCooldown` fires the clip and the damage on the same
  frame, so there is nothing to react to — a 0.3 s wind-up with the damage on the follow-through is
  the single cheapest fix here.
- **No aggro readability.** Nothing tells you an animal has noticed you except that it starts moving.
  A call, a posture, a nameplate state — the sound bank already has calls (M35).

## 3. Mechanics and progression

- **Tames are flat.** No levels, no stats, no breeding, no eggs, no imprinting, no taming
  *effectiveness*. A tamed raptor on day one is identical to one on day thirty. This is the largest
  single missing system measured against the genre.
- **No tame commands.** They follow and they guard (M36), and that is it: no *stay*, no *attack
  target*, no *whistle*, no *passive/aggressive* stance, no **tame inventory** (a pack animal that
  cannot carry anything is a horse, not a mule).
- **No corpse bag on death** (PLAN item 4). Death costs the walk back and a day's meals; your pack is
  kept, so there is no real stake.
- **Inventory has no weight and no stack limits** — `counts` is a `Map<ItemId, number>`. Carrying
  9,999 stone is free, which removes the reason for a base, for a chest, and for a pack animal.
- **Twenty-four items, fifteen recipes.** The tiers stop at timber: no stone tier, no metal, no
  cooking beyond meat-on-a-fire, no water container (you drink at the edge and cannot carry water),
  no repair, no durability.
- **Building is ten pieces and no openings**: foundation, wall, ceiling, campfire, torch, bedroll,
  workbench, chest, fence, canopy. **No door, no doorway, no window, no stairs or ramp, no pitched
  roof** — so a hut is a box you cannot get into without leaving a wall out.
- **One save slot**, and `warmth` is **not in it** (`save.survival` carries food/water/stamina only),
  so the cold resets on every reload.
- **No hostile pressure on a base.** Nothing ever attacks what you built.

## 4. Feel and physics

- **No fall damage.** You can step off the 410 m summit and walk away. This is the single biggest
  "the world does not take itself seriously" gap left, and the landing crouch (M88) already measures
  the impact speed that would drive it.
- **No crouch, no prone, no lean, no climb, no vault.** The character walks, runs, jumps, swims and
  dives; nothing else. `ControlLeft` is unbound.
- **No swim stamina and no current danger.** Rivers push you (`riverFlowAt`) but cannot drown or
  sweep you anywhere you care about.
- **Nothing has mass.** No push between the player and animals, no ragdoll (M41's topple is the
  honest stand-in), no physics props you can knock over, no trees that fall.
- **No hit-stop, no camera shake on landing, no controller support.**
- **Keys cannot be rebound** (settings has render scale, shadows, grass, draw distance, volume,
  sensitivity, FOV). Bound today: `W A S D Shift Space E F C T M N O Tab F3 Esc`.

## 5. Animation, after the pass (M83–M91)

The pass covered: directional locomotion, the swim, the dive, held tools, the armed idle, hurt,
interact/eat/place, the riding straddle and per-species seats, dino flinch, death, attack variety,
and head-tracking. What it could not reach:

- **Eleven of fifteen rigs have no flinch clip**, and there is no honest substitute in an attack or
  a death clip. Those species do not wince.
- **Four rigs — `trike`, `carno`, `sauropelta`, `spino` — name every bone `Bone.001`.** That one
  fact is why they do not head-track *and* why the facing probe cannot read them. It is a property
  of those three assets plus the trike, not four separate problems.
- **A held torch is unlit.** You place a torch to light ground; carrying one is carrying a stick.
- **No turn-in-place, no walking-pace backpedal twin** (`Run_Back` is retimed), **no idle breaks**.
- **The one-clip rigs idle by playing their walk cycle at a third speed.** Checked in M89 and left
  alone: photographed undisturbed they read as standing animals, and the obvious fix risks the
  failure M52 already hit.

## 6. HUD, UI and the map

- **The map has no fog of war and no discovery.** In survival it shows the island, the water and
  your own buildings; in creative it reveals every ruin and keystone. Nothing is *earned* by walking
  — which was the design in the arc ("map unlock by climbing and looking").
- **No player-placed markers or waypoints**, no route line, no distance readout, no tame icons, no
  death marker.
- **The inventory panel is a list.** No drag, no split stacks, no sorting, no item tooltips beyond
  the name, no equipment slots (armour is a stat, not a slot).
- **No crafting queue and no progress** — crafting is instant on click.
- **No death screen, no respawn choice** (bedroll or beach is decided for you), **no pause menu**
  (settings is a gear panel), **no key help beyond `?`**.
- **Emoji item icons.** Legible and zero-cost, and the one piece of the UI that reads as a prototype.
- **Nothing is localised, and nothing is accessible**: no colour-blind palette, no text scaling, no
  subtitle track for the audio cues, no remappable keys (again).

## 7. Visual, terrain and the world

- **The Alpine Tarn waterfall**, deferred in M72 *with the measurements already taken*: the west rim
  is a 10–20 m thick, 3 m high dam (234 m at x −1310, 226 at x −1330) and past it the flank falls
  **226 → 120 m over seventy metres** — a ~57° horsetail visible from Dune Bay and the whole west
  coast. Parked because a 6.5 m slot down that flank crossed the keystone climb; **M81/M82 reshaped
  that entire range afterwards, so the blocker may simply be gone.** It needs a re-measure, not a
  redesign.
- **No weather.** No rain, no storm, no wind gusts you can see, no fog banks, no snow on the tops
  that falls. The sky has cloud cards and a day-night grade and nothing else changes, ever.
- **No seasons, no tides, no moon phase.**
- **Water is one look everywhere except the rivers** (M90 gave rivers depth-and-angle clarity; the
  sea and the lakes are still flat sheets). No caustics, no refraction offset, no foam on the
  shoreline of a lake, no wake behind a swimmer or a boat (there are no boats).
- **No underwater life.** The sea floor has rocks and weed and nothing that moves — and since M86 it
  is somewhere you can actually go, which makes the emptiness visible.
- **No birds, no insects, no small life.** The ambience has birdsong with nothing in the air making
  it.
- **Interiors are two idioms** (swamp, pine). PLAN decision 6's answer for caves — portal-loaded
  hand-built spaces behind a door — was written down, ignored in M51, and is still the only honest
  route back to underground content.
- **The ruins are six prefab arrangements across twenty-three sites.** Repetition is visible once
  you have walked the island.
- **No LODs on the dino rigs** (impostor cards exist for distance; the near tiers are one mesh).

## 8. Audio

- 74 CC0 samples (M35) plus a procedural ambience bed. Open: **no music at all**, no reverb by
  space (a gorge sounds like a beach), no occlusion, no distinct footstep sets beyond ground type,
  no combat impact layering, no stingers for the arc beats.

## 9. Performance — the honest verdict

**This is not where the value is.** `PERFORMANCE.md`'s own conclusion, unchanged: the remaining fill
levers (**B** opaque grass, **C** depth pre-pass, **E** far-terrain material, **F** occlusion
queries, **G** shadow caching, **H** KTX2, **I** presets) are together worth **~3 ms of a 5.5 ms
frame that already meets its 12 ms contract**, and every one of them is unproven against
measurement. Re-measured 2026-09-12: a full island lap is **worst frame 28.8 ms, one hitch over
25 ms, p50 3–5 ms**.

Open hitch items, all small:
- **H6** — a teleport rebuilds terrain synchronously (~770 ms). QA-only today, but the same code path
  runs at load.
- **H7** — ~30–50 textures still upload on first sight of the plain, reachable from neither the scene
  nor the registered roots. ~16 ms, drained by the warden.
- **H8c** — one `MeshDepthMaterial` compile for an instanced tree trunk at the foothills. **The doc
  says 165 ms; measured 25 ms on 2026-09-12** — it is the single hitch in the lap above.

Not doing, and why, stays as recorded: N8AO, tessellation, WebGPU.

## 10. Stale in the repo

- **This section's predecessor** — the "Remaining order (2026-09-07)" list above — listed as
  remaining several things that shipped in M31–M68. Fixed by this audit.
- **`PERFORMANCE.md` H8c says 165 ms**; it is 25 ms.
- **`tools/shots.mjs`'s eleven authored vantages predate the world changes.** Several now teleport
  into water that did not exist when they were written; one fires the swim hint from "spawn".
- **`tools/artdir.mjs` is an M2-era asset-intake harness** and no longer describes anything shipped.
- **11 MB of source maps per deployment** (see §1).

## 11. Explicitly not doing (decisions on record)

- **The aquatic tame** — user's call, arc beat 4 stands without it.
- **A harvestable log from a felled tree** — user's call.
- **Jointed ragdolls** — M41's directed topple is the answer until bodies start falling off cliffs.
- **Co-op** — last, as decided (PeerJS host-authority, `net.ts` in minecraft-JS is the reference).

## 12. If you want an order

1. **Push.** Fifteen rounds of work are invisible.
2. **Fall damage**, then **a wind-up on dino attacks** — the two cheapest changes that make the world
   feel like it means it, both riding on machinery that already exists.
3. **A door and a ramp.** A hut you cannot walk into undermines the whole building tier.
4. **Weight and stacks**, which is what makes the chest, the base and a pack animal mean anything.
5. **Tame commands and a tame inventory** — the genre's core loop, and the cheapest large win.
6. **The Tarn fall** — the measurements are already taken; it may only need a re-check.
7. Then the decisions in §1, and weather.

---

# RESEARCH — what the field does, and which of it applies here (2026-09-12)

*Web research against the vision "a very good game, no matter what it takes, as long as it is free."
Everything below is CC0/MIT or a technique, so nothing here costs money. Sources at the end. Where
the answer is "this does not apply to us", that is said first and plainly, because a plan item that
cannot be built is worse than no plan item.*

## 0. What does NOT apply, stated first

- **Tessellation is not available to this game.** WebGL2 has no tessellation stage and no compute
  stage, and three.js does not emulate one. The only route to GPU tessellation or hydraulic-erosion-
  on-the-fly is **WebGPU**, which `PERFORMANCE.md` already calls "a port of every custom shader in
  the project… not this year". Any backlog line that says "tessellation" is a WebGPU line wearing a
  disguise. **The honest alternative on the current renderer is what is already built**: a baked
  heightmap with chunked LODs and a vertex-displaced grid. Note it and move on.
- **Texture-space tricks have a horizon problem.** The per-tile hash that makes stochastic texturing
  and cell bombing work aliases at high minification — i.e. precisely at the far edge of a big
  terrain. Anything adopted here needs a distance fade, which is the same lesson M26 already learned
  about the water ripple.

## 1. Assets — what is free, and what is actually usable

**The find that matters: [Gobkit Free Dinosaur Pack](https://gobkit.itch.io/gobkit-free-dinosaur-pack)**
— 10 rigged, animated low-poly dinosaurs, **GLB, CC0 1.0, commercial use, no attribution, 8.9 MB**,
on a **shared retarget-friendly skeleton**, four baked clips each (idle / attack / dead / walk, 24 fps).
Its species list includes **Spinosaurus, Carnotaurus, Ankylosaurus and Pachycephalosaurus** — which
is three of the four rigs this project has been apologising for (§5 of the audit: the one-clip rigs
and the four that name every bone `Bone.001`).

**The catch, and it is a real one: the pack is UNLIT baked-colour on a single atlas.** This island is
PBR-lit with a day-night grade, a shadow box and a post chain; an unlit model ignores every one of
them and will read flat and wrong at dusk, which is exactly the mismatch M2's art-direction test was
run to avoid. Three honest options, in ascending order of work:

1. **Re-material on import** — bind the atlas as `map` on a `MeshStandardMaterial` and let the world
   light it. Cheap, and the baked shading will fight the real shading a little.
2. **Use it only for the broken four**, re-lit as above, and accept a slight style seam against the
   PBR rigs already in the world.
3. **Mine it for the SKELETON.** A shared retarget-friendly rig is the thing this project actually
   lacks — it would give `carno`, `spino`, `sauropelta` and `trike` named bones, which is what
   unlocks head-tracking and the facing probe for them (§5), *without* replacing the meshes anyone
   has already looked at.

**Materials and textures**: [ambientCG](https://ambientcg.com) (2,000+ CC0 PBR materials with albedo/
normal/roughness/metallic/height/AO, up to 8K) and [Poly Haven](https://polyhaven.com) (CC0 HDRIs and
materials). Both are drop-in for the terrain tiles and prop materials, with no licence question.

**Music: the game has none at all** (74 CC0 samples plus a procedural ambience bed, M35). Free and
CC0: Kenney's music packs, OpenGameArt's CC0 music collections, and CC0 ambient/drone sample packs.
A single 90-second exploration loop that ducks under combat would be the largest perceived-quality
change per byte in the whole backlog.

## 2. Optimisation — one library worth an evaluation, and the reason

**[InstancedMesh2](https://github.com/agargaro/instanced-mesh) (`@three.ez/instanced-mesh`, MIT,
actively maintained)** adds to `THREE.InstancedMesh`: **per-instance frustum culling backed by a
dynamic BVH**, LOD *and shadow LOD*, sorting, per-instance uniforms/opacity/visibility, dynamic
capacity — and **instanced skinning** (their examples run 1M static trees and 3,000 skinned
instances). Three things it would change here:

1. **Scatter culls whole 256 m cells today.** Per-instance culling is strictly finer, and it would
   have made M81's under-bounding bug — `computeBoundingSphere()` discarding each instance sphere's
   radius, 58 of 85 meshes short, the worst by 41 m — structurally impossible.
2. **The hand-rolled LOD bands and impostor cards have a library equivalent**, including for shadows,
   which this project pays for separately.
3. **The big one: 1,515 animals are dormant-until-near precisely because skinned meshes are
   expensive.** Instanced skinning changes that arithmetic, and with it how alive the island can be
   at distance.

Also worth knowing: three.js core's **`BatchedMesh`** does per-object frustum culling and sorting for
*non-identical* geometry, and works on both the WebGL and WebGPU backends.

**Adopt nothing on faith.** The frame already meets its 12 ms contract at 3–5 ms, so the case for any
of this is **the animals**, not the trees — and it is an A/B measurement, the way every lever in
`PERFORMANCE.md` was decided.

## 3. Graphics — what would actually move the look

- **Texture repetition**: the splat shader already does triplanar + texture bombing, which is most of
  the win. Beyond it is Heitz–Neyret stochastic texturing (sample the texture several times from
  different regions, blend with a luminance-preserving operator) — with the horizon-aliasing caveat
  in §0.
- **Rim light is the cheapest "it looks better" change available.** The stylised-low-poly literature
  is unanimous that a tasteful rim/fresnel term is what gives low-poly silhouettes their readability,
  and it is one term in a material keyed to the sun direction. This island is already vertex-coloured
  and flat-lit; it has the exact look rim lighting is for.
- **Vertex colours for gradients** rather than textures — already the project's idiom, worth
  extending to props that still ship flat albedo.
- **Toon/outline passes**: available, but they would overturn M2's art direction rather than serve
  it. A decision, not an improvement.

## 4. Map design — one rule worth turning into a gate

The most concrete, testable thing the open-world level-design literature offers:

> **From any hub or intersection you should be able to see at least two other landmarks**, and a
> major landmark should be identifiable from anywhere on the map.

This island has 24 ruins, a volcano, two ranges, a beacon and a waterfall, and **no measurement
anywhere of whether any of them can be seen from any other.** A `gate-landmarks.mjs` that raycasts
between every landmark pair against the baked heightmap and reports the visibility graph — plus the
count of landmarks visible from each ruin — is a day's work, needs no new art, and is precisely this
codebase's idiom: turn a design principle into a number a gate can hold. The same tool answers "is
the volcano visible from the spawn beach", which PLAN beat 1 has asserted since the beginning and
nothing has ever checked.

Second, softer: **cluster points of interest into "mini-trips"** rather than spreading them evenly.
The island's 24 ruins are currently distributed along a spawn→summit gradient, which is a line, not
clusters.

## 5. Boss fights — what the one boss is missing

The literature agrees on three things, and the Gatekeeper (M20) has none of them:

- **Telegraph.** Attacks must be readable and fair even when fast: a large gesture, a sound cue, a
  colour, *before* the damage. `attackCooldown` currently fires the clip and the damage **on the same
  frame** — there is nothing to react to, for the Gatekeeper or for any animal (§2 of the audit).
- **Phases, each distinct.** One boss, one behaviour, one health bar. Phases are what let a fight
  tell a story and test adaptation — and this rig has `roar`, `bite` and `attack_tail` bound, which
  is already the raw material for two.
- **Teach through the fight, not before it.** A boss whose pattern takes three attempts to learn is
  memorable; one that kills you with an unreadable move is cheap.

And the genre structure worth stealing wholesale: **Valheim's biome-boss loop** — beat the boss,
unlock the material, the next biome opens. This island already *has* biomes with distinct dangers and
a keystone-gated finale; it has one boss at the very end. A boss per major biome, each dropping the
thing that makes the next biome survivable, is the same arc with a pulse.

## 6. Balance — the method this project does not have

The professional loop is **theory → internal playtest → live data**, and the first stage happens in a
**spreadsheet**, because *time-to-kill and time-to-die are far easier to evaluate there than in a
running game.*

This project has **no balance model at all.** Species hp, damage, torpor, torporMax, harvest yield,
food values, drain rates and recipe costs are hand-typed numbers in `species.ts` and `items.ts` with
no cross-check — and hand-typed numbers that drift is exactly the failure M84 found in the fifteen
saddle seats, and fixed by *measuring* them.

**The proposal, and it is the same shape as every good tool in `tools/`:** a `tools/balance.mjs` that
reads `species.ts` and `items.ts` and prints, for every species:

- **time-to-kill** with fists / hatchet / spear, and **time-to-die** for the player against it;
- **swings-to-KO** (torpor per hit against `torporMax`) — the taming cost, which is the real gate;
- **food economy**: how many of each food a kill yields against the drain rate, i.e. how long one
  animal feeds you;
- **the progression curve**: those numbers sorted along the intended spawn→summit gradient, with a
  gate that asserts it is **monotonic** — no animal in the second biome easier than one in the first.

That turns "is this balanced?" from an opinion into a table, and a regression in it into a red gate.
It is free, it needs no assets, and nothing in this project is better suited to it.

## Sources

- Gobkit Free Dinosaur Pack (CC0): https://gobkit.itch.io/gobkit-free-dinosaur-pack
- InstancedMesh2 (MIT): https://github.com/agargaro/instanced-mesh
- three.js performance practice: https://www.utsubo.com/blog/threejs-best-practices-100-tips
- WebGPU/compute vs WebGL2 in three.js: https://threejsroadmap.com/blog/introduction-to-webgpu-compute-shaders
- Texture repetition (Inigo Quilez): https://iquilezles.org/articles/texturerepetition/
- Stochastic texturing: https://medium.com/@jasonbooth_86226/stochastic-texturing-3c2e58d76a14
- Open-world orientation and landmarks: https://iuliu-cosmin-oniscu.medium.com/guidance-and-orientation-in-open-world-maps-c7ff78a12a05
- Open-world level design (POI clustering): https://www.gamedeveloper.com/design/open-world-level-design-the-full-vision-part-2-5-
- Boss design: https://gamedesignskills.com/game-design/game-boss-design/
- Boss readability/telegraphing: https://www.gamedeveloper.com/game-platforms/designing-for-difficulty-readability-in-arpgs
- Valheim's biome-boss progression: https://valheim.fandom.com/wiki/Progression_guide
- Game economy balancing framework: https://gamedevessentials.com/a-7-step-framework-for-game-economy-design/
- Balancing methodology and telemetry: https://videogamedevelopmentauthority.com/game-balancing-and-tuning
- CC0 asset sources: https://ambientcg.com · https://polyhaven.com · https://kenney.nl · https://quaternius.com · https://opengameart.org
- Low-poly art direction: https://rocketbrush.com/blog/low-poly-art-in-games

## The order this research changes

Inserted into §12's list, the research-backed items rank like this:

1. **`tools/balance.mjs` + a monotonic-progression gate.** Free, no assets, turns the game's oldest
   unexamined numbers into a measurement. Should come before any new content, because every new
   animal or recipe makes the un-modelled economy worse.
2. **A wind-up on every attack** — already §12's item 2, and the research says it is the single
   highest-value change in combat, for the boss as much as for a raptor.
3. **`gate-landmarks.mjs`** — one day, turns a design principle into a number, and finally checks the
   claim PLAN beat 1 has made since the first line: that the volcano is visible from the beach.
4. **A rim-light term**, the cheapest visual change in the list.
5. **One CC0 music loop.** Largest perceived-quality change per byte in the backlog.
6. **Evaluate InstancedMesh2 for the ANIMALS** (not the trees) with an A/B, because instanced
   skinning is the only thing on this list that could change how alive the island is at distance.
7. **The Gobkit skeleton for the four unnamed rigs** — option 3 in §1, which fixes head-tracking and
   the facing probe without replacing any mesh.

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

# Checklist — the task ledger

One milestone chunk per session. A box is ticked only when it's **proven** (build passes + screenshot
or scripted check) and committed. Gates are the definition of done for each milestone.
Plan of record: `PLAN.md`.

## M0 — Bootstrap
- [x] Repo + git init, Vite/TS/vercel config matching minecraft-JS pattern
- [x] Boot scene renders (three r185, ACES, flat-shaded placeholder)
- [x] PLAN.md + CHECKLIST.md + CLAUDE.md committed
- [x] Origin added + first push (github.com/Keshav-Madhav/jurassic-stack)
- [x] Vercel project linked, first deploy renders the boot scene (https://jurrasic.keshav-madhav.com — verified via `tools/deploy-check.mjs` screenshot)

**Gate:** `npm run build` clean; deployed URL shows the boot scene. ✅ M0 complete.

## M1 — Asset intake gate
- [x] `tools/gate.mjs`: GLB → tris, bones, clips (+durations), textures, thresholds (meshopt-aware)
- [x] `tools/turntable.mjs`: localhost server + headless Chrome, 4 angles + mid-clip pose, real GLTFLoader+MeshoptDecoder path
- [x] Quaternius fallback six downloaded (poly.pizza CDN) + archived in `public/models/_raw/quaternius/`
- [x] Tier-A Sketchfab roster downloaded by user (16 zips) + unzipped, converted, archived (gitignored, ~400 MB)
- [x] Spec-gloss → metalrough conversion (Sketchfab GLBs rendered untextured clay in three.js otherwise — gotcha recorded in ASSETS.md)
- [x] All models gated + turntabled + recorded in `ASSETS.md`: **14 primary PASS** (37 MB webp+meshopt), 6 Quaternius fallbacks, 1 REJECTED (Brachiosaurus = museum diorama), 1 HOLD (Therizinosaurus = broken rig)
- [x] gltf-transform pass: metalrough → resize 2048 → webp → meshopt; clips + textures verified surviving via re-gate + compressed turntable renders. KTX2 deferred to M6 (no toktx; WebP covers download size)

**Gate:** every model in `ASSETS.md` has clips verified and a turntable shot; broken imports flagged with substitute noted. ✅ **M1 complete — 16 species game-ready.**

## M2 — Art-direction test scene
- [x] Scene: tier-A raptor idle-animating in a Quaternius forest patch (`tools/artdir.mjs`, 10 CC0 nature props in `_raw/nature/`)
- [x] Screenshot batch (3 grades × 2 times of day) published for review
- [x] **Decision recorded in PLAN.md: filmic-vivid hybrid keyed to time of day** (ACES base at noon → vivid warm grade at low sun). Mixed fidelity holds. Re-review when Sky/CSM/post land (M5/M6).

**Gate:** the user has picked a direction from the batch; PLAN.md updated. ✅ M2 complete.

## M3 — Graybox island + mover
- [x] Heightmap chunk renderer: 16×16 grid of 128 m chunks, 4 index-buffer LODs (64/32/16/8 quads), skirts; single height function (`heightmap.ts`) shared by render/physics/AI
- [x] Terrain collision: per-chunk Rapier **trimeshes from the LOD0 grid** (chose trimesh over heightfield — collision is literally the render geometry, no orientation footguns), streamed 3×3 around the player
- [x] Shared "mover" class (Rapier KCC): walk/sprint/jump, autostep, snap-to-ground, slope limits; player interpolated between fixed steps; third-person camera (immediate look, smoothed follow, terrain-aware boom)
- [x] One raptor wandering on steering (idle⇄wander FSM, turn-rate-limited seek, water/slope avoidance, idle⇄walk crossfade with speed-matched stride)
- [x] Day-night cycle: Sky addon + sun animation + PMREM rebake, **with the M2 grade curve implemented** (filmic noon ↔ vivid golden ↔ night as a function of sun elevation)
- [x] `tools/shots.mjs` (6 authored vantages incl. the spawn→volcano arc sightline) + `tools/gate-m3.mjs` (automated FPS + 4 collision walks)

**Gate:** 60 fps headless; 4 cross-island walks never below ground (worst 0.97 m = exact feet offset); raptor wanders/animates on camera. ✅ M3 complete.
Notable bugs caught by the screenshot loop: spawn beach below sea level; PMREM environment washing all materials to pastel (fixed with `environmentIntensity 0.35`); gaussian volcano reading as a mound (rebuilt as concave-flank cone, 184 m); camera yaw convention inverted in every vantage (yaw 0 = north).

## M4 — Core loop (THE DEMO MILESTONE)
- [x] Species table v1 (`species.ts`: stats/speeds/torpor/tame-food/clip-regexes/seat) + one generic brain (`dinos.ts`: idle⇄wander⇄aggro⇄flee⇄ko⇄tamed)
- [x] World scatter (`scatter.ts`): ~8.6K instanced trees/pines/rocks/bushes as harvestable nodes with hp/yields/respawn, deterministic seeded placement, streamed trunk colliders — **the island is no longer bare** (user feedback folded into this milestone; heightmap relief also doubled)
- [x] Gathering: crosshair raycast vs instanced nodes, reach measured from the player (not the 5 m camera boom — first gate run caught that), hatchet 2× on wood
- [x] Crafting: 7 recipes, hotbar with auto-slotting, TAB inventory/craft panel (DOM)
- [x] Building snap: foundation (terrain-flatness or edge-chain) → wall (cell edges) → ceiling (wall/adjacent support) + campfire w/ light; ghost preview green/red; static colliders; deterministic player-forward aim fallback
- [x] Taming: fists build torpor → KO (pose held) → feed berries → tame bar → wakes-if-torpor-empties; tamed follow w/ walk/run by distance
- [x] Riding: saddle craft+equip, mount parks the player body, intent redirects to the dino's own KCC mover (the shared-mover payoff), longer camera boom, dismount re-places player
- [x] Save/load: versioned IndexedDB blob — player/inventory/structures/dead-nodes/dinos/time; 30 s autosave + pagehide; full restore on boot
- [x] E2E gate (`tools/gate-m4.mjs`): 29 checks driving the real verbs headless — all green

**Gate:** gather → craft → build a hut → tame → ride → save → reload, headless, no console errors. ✅ **M4 complete — it's a game.**
Bugs the gate caught: reach measured from camera (all swings whiffed); camera-drift aim landing walls in the wrong cell; ceiling/campfire building-key collision (both hashed to 'c'); meshopt quantization corrupting prop geometry when baking transforms (fix: raw props + float-promotion guard in the instancer).

## M5 — Real island, bake v1
- [ ] Composition file format + island v1 (spawn coast, volcano sightline, danger gradient, ruin/keystone sites)
- [ ] Erosion bake script (droplet + thermal) → committed heightmap/splatmaps
- [ ] Rivers (spline meshes + Water2 flow maps + current volumes), lakes, ocean (Water + Gerstner)
- [ ] Navmesh baked in Node (recast-navigation-js), loaded at runtime; DetourCrowd for chase/follow
- [ ] Placement validators (floating props, underwater trees, slope-invalid ruins, uphill rivers) run in the bake
- [ ] Swap graybox → island v1

**Gate:** validators pass; screenshot batch approved; swim + current forces work.

## M6 — Foliage & optimization
- [ ] InstancedMesh2 per archetype: BVH culling, LOD, shadow LOD; billboard-cross far LOD
- [ ] Grass: per-chunk instanced + wind vertex shader
- [ ] Splat terrain shader (height-blend, slope triplanar, texture bombing)
- [ ] CSM shadows; postprocessing + N8AO; height-fog patch
- [ ] gltf-transform pipeline in build; chunked GLB streaming by distance
- [ ] Graphics settings menu (render distance, foliage density, shadows, post toggles) + stats-gl overlay

**Gate:** 60 fps at default settings on the dense island; settings measurably change frame time.

## M7 — Species & depth
- [ ] Roster to 15+ through the species table (intake-gated models only)
- [ ] Combat: hitboxes, damage, dino aggro/pack behavior
- [ ] Ragdoll rig-builder (Rapier joints): death, knockout, high-speed dismount
- [ ] Survival stats: hunger/thirst/stamina/torpor tuning
- [ ] Per-biome spawn tables
- [ ] First flyer (Pteranodon) — new movement mode + camera
- [ ] First aquatic — swim volumes + underwater camera

**Gate:** each species drives from its table row; ragdolls are funny and never break tame timers.

## M8 — The arc pass
- [ ] Keystones + caldera door; recipe tablets in ruins (engrams-as-archaeology)
- [ ] The Wayfinder item (carry = guided, stow = sandbox)
- [ ] Three fear-themed caves (portal-loaded interiors)
- [ ] Alpha apex fight + beacon/stay ending
- [ ] Waterfalls; ruins overgrowth pass; save/load final

**Gate:** a full guided playthrough start → summit works; a pure-sandbox session never sees arc UI.

## M9 — Co-op (stretch)
- [ ] PeerJS host-authority (reference: minecraft-JS `src/scripts/net.ts`)
- [ ] Remote players + dino state sync; host save = world persistence
- [ ] 4-player playtest with the actual three friends

**Gate:** two browsers on the deployed URL, host + guest, tame and ride together.

### M4.1 — playtest feedback round (user's first live-site review)
- [x] Dinos floated above ground: bind-pose bbox lied about foot level — now calibrated from the true skinned vertices after an idle frame (`getVertexPosition`), plus slope-aware front/back-paw clamping and body pitch
- [x] Foliage variety: all 10 intaken nature props in play (3 tree + 2 rock variants, grass kind added — ~13.6K instances), per-instance tint jitter; save v2 (RNG stream changed)

### M5 progress notes
- [x] **M5a** — bake pipeline (compose → erode → validate → commit), baked-data heightmap swap. Gates green.
- [x] **M5b** — water: ocean (Gerstner swell) + 2 lakes + 2 river ribbons on one refraction-only animated material; `waterLevelAt`/`riverFlowAt` queries and the river ribbon share ONE sample array (v1 derived them separately and disagreed); swim mode (buoyancy, surface float, space-paddle) + river currents carry the swimmer downstream. Gate `tools/gate-m5.mjs` 12/12; m3/m4 regression green.
  Known issue for M6: lake surface seen edge-on from below reads as a floating band — fix by enforcing a shore ring (terrain ≥ level+0.6 around each lake) in the bake. Debug saga: ribbon wound face-down → invisible with FrontSide (now DoubleSide, which underwater views need anyway).
- [ ] **M5c** — navmesh bake (recast) + DetourCrowd; ruin-site prefabs; graybox→island polish pass

### M6a — foliage & terrain beauty pass (user feedback: "more foliage, tree types, scales, darker, grass, ground variation")
- [x] Prop library 8→16 (dead trees ×3, palms, willow, ferns, flowers ×3, mushrooms, mossy logs, berry bush — several extracted as named sub-nodes from Quaternius variant packs)
- [x] Habitat-driven scatter v2: forest-mask noise clusters woods with real clearings; palms on the beach band, willows on riverbanks, dead trees on dry fringes, ferns/mushrooms on forest floor, flowers in clearings; ~30K grass tufts; ~55K instances total at 58-60 fps
- [x] Terrain vertex colors (sand/grass lush-dry mottling/rock-by-slope/basalt-by-altitude) + flat shading; darker richer grade (noon + golden)
- [x] Gates green after 3 real bugs: grass soaking swings aimed at trunks (solid-over-groundcover raycast priority); bbox-center prop pivot shifting trunks off node origins (base-band pivot); gate aim-pitch computed in the wrong frame (head-pivot, not camera)

### M6b — shadows, ruins, lake shores ("improvements and betterments" round)
- [x] Real-time shadows: one 2048px directional map following the player (±85 m, texel-snapped) — terrain receives; props/dinos/ruins/buildings/player cast. Two classic bugs fixed: shadow camera bounds set without `updateProjectionMatrix` (stayed ±5 m), and `normalBias: 1.6` — world METERS — erasing every caster thinner than 1.6 m (now 0.18 ≈ 2× texel). CSM upgrade remains for M6 proper.
- [x] First ruins: prefab layouts at all six baked sites (columns/arches/toppled pieces + the stag statue on the beach facing the volcano — the arc's tutorial beacon; the caldera-gate arch is the future keystone door). Colliders on standing pieces. The pristine castle-barracks model was cut (read as a fort, not ruins).
- [x] Lake shore rings enforced in the bake (with river inlet/outlet gaps) + shore validator — the edge-on floating-rim artifact is gone at the source.

### M6c — the player character
- [x] KayKit Barbarian (CC0, GitHub) replaces the capsule: 76 embedded clips — idle/walk/run blends with speed-matched strides, Jump_Idle airborne + swim treadwater, one-shot swings flavored by tool (punch / 1H chop / throw), Sit_Chair_Idle as the riding pose (player parents to the dino's seat bone offset)
- [x] Contextual attachment: the 1H axe shows only while the hatchet is held; mug/shield/offhand axe hidden
- [x] All gates green (9/9, 29/29, 12/12); intake pipeline used (meshopt 3.4→2.3 MB, clips verified)

### M6d — castaway + the dark pass (user: "skinny natural human, bare; everything too bright, want real-leaf greens")
- [x] Player is now a Quaternius "Casual2" slim natural-proportioned human (CC0, 24 clips), recolored at load into a bare castaway: shirt+shoes→skin (shirtless, barefoot), jeans→ragged brown shorts. Clip remap (Idle_Neutral/Walk/Run/Punch_R/Sword_Slash/Punch_L); no sit clip → idle astride. Barbarian retired.
- [x] Global dark pass: foliage materials pulled toward deep leaf green at load (green-dominant detection), terrain palette darkened again (lush 0x1f3d18), noon exposure 0.52 + hemi 0.5 + env 0.22 with sun 2.4 — ambient down, sun up ⇒ shadows carry the frame
- [x] Gates 9/9, 29/29, 12/12; golden-hour vista now frames the sun setting behind the volcano

### M6e — the ARK pass (user: match real ARK screenshots — intense shadows, darker everything, gray rocks, treelike trees, ground foliage)
- [x] Pulled actual ARK Survival Evolved screenshots from Steam as reference; extracted the look: brown dirt/leaf-litter forest floors, trunk-dominant tall forests, low-bush understory carpet, very low ambient with sunlit breaks, gray weathered stone
- [x] Forest floors now turn to dirt/leaf-litter under the (now shared) forest mask; rocks recolor to weathered gray by luminance; trees 7-16 m and pines 8-19 m (trunk-dominant); ferns 10K/bushes 3.6K bigger + denser; noon ambient down again (hemi 0.34, env 0.13) with sun up (2.7) — shadow pools with bright breaks
- [x] Gates 9/9, 29/29, 12/12

### M5c — terrain sculpting + navmesh (the "M5 — Real island" closer)
- [x] Sculpt pass in the bake: terraced escarpments on the northern highlands, three flat-topped mesas with ragged rims, the east river's mid-course deepened into a canyon (tight channel, raised rims); lake banks noise-wobbled (crop-circle artifact fixed)
- [x] recast/detour navmesh baked in Node from the same heightmap (741 KB committed) with **reachability validation: a walkable path must exist spawn → every ruin site** — and the volcano summit is verified UNREACHABLE on foot, geometric enforcement of the arc's sealed finale (enter via the caldera door at M8)
- [x] Runtime navmesh (`navmesh.ts`): aggro-chase and tamed-follow now path-follow waypoints (repath ~1 s, steering between waypoints, direct-seek fallback); ambient wander stays on cheap steering. Full DetourCrowd deferred to M7 herds.
- [x] Water ribbons auto-fit their channel (edges probe the banks) — canyon walls no longer poke through / no hovering water
- [x] Gates 9/9, 29/29, 12/12. **M5 complete.**

### M5d — "proper everything" consolidation (user: better AI, better terrain, real textures, collisions)
- [x] Real ground textures: 4 CC0 albedos (ambientCG grass/dirt/rock/sand, 512px, ~380KB) splat-blended in-shader by a per-vertex weight attribute matching the palette zones; world-space UVs at two scales (anti-tiling); vertex color = palette tint, texture = detail. Caught: terrain mesh vanished entirely on a vColor vec4/vec3 shader compile error — visible as "ocean everywhere" (physics kept working, player stood on invisible ground)
- [x] Terrain micro-detail inside the shared heightAt (0.35m two-octave ripple, faded on beaches, below navmesh walkableClimb) — render/physics/AI stay exactly consistent
- [x] AI: territorial aggro (raptors charge within 11m unprovoked), pack aggro (same-species within 28m join the fight), flavor idle one-shots (sniff/call/roar), obstacle-avoid steering vs a spatial hash of all trunks+rocks (colliders only exist near the player; AI everywhere needed geometry knowledge)
- [x] Collisions: rocks get streamed squat-cylinder colliders; dino-dino separation push; player-dino body push (soft, gameplay-level)
- [x] Gates 9/9, 29/29, 12/12

### M5e — floating/lag/balance round (user: collisions off, assets floating, laggy, better lighting, raptor too big/slow/weak)
- [x] Floating fixed at the ROOT: runtime micro-detail desynced props from LOD-rendered terrain — detail now baked into the grid (heightAt = pure bilinear again); plus per-kind embed offsets (rocks 5%+4cm, trunks 14cm, cover 6cm) and dino clamp -6cm
- [x] Perf: supercell instancing (256m groups, per-cell frustum culling via computeBoundingSphere), ground cover casts no shadows + hidden beyond 420m, pixelRatio 2→1.5 — dense-forest view 49→60fps
- [x] Raptor rebalance: 1.4m tall (was 1.8 vs 1.75m human), runs 12m/s (player sprints 8 — you cannot outrun it), hp 60→140, torpor 50→160 (~20 punches to KO), drain 2.2/s, damage 14, aggro 14m, 9 feeds to tame — hard mode as requested
- [x] Collisions: trunk collider radius scales with tree size, rock colliders sized to mesh, player-dino push scales with species height, ride capsule fits the smaller raptor
- [x] Lighting: shadow radius 2 (softer edges), hemi 0.42 + sun 2.9 warmer at noon
- [x] Explicit save hook for the gate (pagehide save raced reload — the longer hard-mode tame exposed it). Gates 9/9, 29/29, 12/12; navmesh + island rebaked and revalidated

### M7a — species opener + river fix + discoverability (user: what are berries / river floating / keep going)
- [x] River floating fixed for real: 4-column cross-section — flat surface between inner columns, outer edges tucked 0.9m DOWN under the banks (bank micro-bumps between samples made any flat ribbon read as hovering)
- [x] 3 new species from the intaken roster, all data-table rows: Triceratops (2.6m skittish tank, 420hp, rideable), Stegosaurus (3m, 520hp, TailWhip), and the highlands T-Rex (4.4m apex, 1400hp/1200 torpor — effectively untameable until weapons exist, 55dmg, 26m aggro: the danger gradient made flesh)
- [x] Two load-order bugs caught by screenshots: animation root-scale tracks made bind-pose normalization spawn kaiju-scale trikes/rex (fix: normalize from ANIMATED skinned bounds); the T-Rex GLB ships a giant static ground plane (fix: hide non-skinned meshes in skinned rigs)
- [x] HUD help now teaches gathering: trees→wood, rocks→stone, bushes→berries (tame food)
- [x] Dino separation scales with species size. Gates 9/9, 29/29, 12/12

### M7b — creative mode + QoL (user request: creative for now — max resources, flight with landing, and more)
- [x] Creative mode (C toggles, persisted in save): 999 of every resource + 99 placeables + tools/saddles granted; god mode; no swing cooldown; one-hit harvest; punch = instant KO; feed = instant tame
- [x] Flight: double-tap SPACE in creative — WASD at 20 m/s, space up / shift down, auto-lands on ground contact while descending; CREATIVE badge in HUD
- [x] QoL: F eats a berry (+15♥), compass heading in HUD (N/NE/…°), nearby-wild-dino readout in the prompt (name · ♥hp · 😴torpor/max — taming progress finally visible), help line teaches C/F
- [x] New gate `tools/gate-creative.mjs` (9 checks) — caught 3 real integration bugs: flight ignored the harness override; the creative kit auto-slotted foundations into slot 0 so every "swing" built a base instead of harvesting; and swing prioritizes dinos so a wandering raptor intercepted the tree test. All gates green: 9/9, 29/29, 12/12, creative 9/9

### M7c — riding fixed + the player's world-quality backlog
- [x] Riding pose: procedural straddle (thighs flexed/spread, knees bent) applied to ALL FOUR duplicate armatures the Casual2 rig ships (posing one did nothing — classic multi-armature trap); seat dropped to 0.48 on the raptor; mount embeds -0.12 (KCC hover)
- [x] Collision investigation with penetration-math probes: trunk colliders exist (261 near player) and the KCC never penetrates on foot OR mounted — the "no collisions" feel was (a) the ridden mount being excluded from dino-dino separation (now included; others get double-pushed since the mount is kinematic) and (b) a slim capsule sliding around trunks (mount capsule widened to height*0.42)
- [x] m4 tame check was marginal by math (28 punches × 8 torpor vs 160 max + 2.2/s drain) — attempts raised to 45. All gates green: 9/9, 29/29, 12/12, creative 9/9

### THE WORLD-QUALITY BACKLOG (player review, 2026-09-02 — fix through upcoming rounds)
User's 10 + mandate, to be burned down across M7d+ and the MAP OVERHAUL milestone:
1. Ground color too uniformly green — needs grays (rocky), sand near rivers/lakes, dry patches, mud
2. River clips through ground / floats in places; too plain (needs foam edges, depth tint)
3. Lake reads as floating
4. "Canyon" doesn't read as a canyon at all
5. Terrain variation too low overall
6. Rocks too sparse — needs real rocky structures: cliffs, outcrops, mountains
7. Too few dinos visible
8. Terrain mesh shows LOD holes/cracks
9. Bushes weirdly bright green; need more bush variety + density; denser grass/foliage overall
10. Trees and props spawning inside lakes
**MAP OVERHAUL milestone (commitment):** the island gets genuinely hand-sculpted — composition authored feature-by-feature (every lake, mountain, cliff, the volcano silhouette, forest placement), iterated through the screenshot loop with per-vantage visual verification until each landmark is *approved-looking*, not just validator-passing. The volcano specifically called out as looking bad.

### M7c.1 — the pose that actually poses (user: "its just lower down")
- [x] Root cause found: GLTFLoader strips '.' from node names (reserved PropertyBinding char) — "UpperLeg.L" loads as "UpperLegL", so the pose matched ZERO bones and failed silently. Matcher normalizes both forms; load warns if no bones match; `poseInfo()` debug proves flex live (−0.04 rad standing → −1.29 riding)
- [x] Process note: previous "verified" screenshot was dark-on-dark ambiguity — pose verification now shoots against bright sky. Gates 29/29, creative 9/9

### HOTFIX — save-while-riding stranded reloads underground (user-hit: "everything gone, falling forever")
- [x] Root cause: mounting parks the player body at y=-520; any autosave/pagehide save while mounted recorded the PARKED position → reload spawned under the world, falling forever with nothing visible
- [x] Fix 1: collectSave saves the actual play position (mount feet) while riding
- [x] Fix 2: load-time sanitizer heals ANY bad saved position (non-finite, out of bounds, below ground, >250m up) — existing corrupted saves self-repair on next load, no wipe needed
- [x] Gate hardened: creative gate now saves while MOUNTED, reloads, asserts on-ground spawn + not falling (12 checks); healer verified against a byte-exact replica of the corrupted save (y=-519.6 → spawns at ground)
- [x] Process: this escaped because no gate covered save-state × riding interactions — mounted-save-reload is now permanent coverage

### M7d — backlog burn-down round 1 (items 1, 3, 7, 8, 9, 10)
- [x] #10 props in lakes: placement now rejects anything under a lake's fill level
- [x] #3 floating lake: basins baked uniformly DEEP inside the waterline (the soft blend left a walkable 1-3m shelf — you could stand on the bed with the water sheet overhead); lakebeds color as dark underwater, never lawn
- [x] #8 LOD holes: skirt depth scales with LOD coarseness (8m at LOD0 → 29m at LOD3; fixed 4m couldn't cover mesa walls)
- [x] #9 bright bushes: foliage darkening widened to catch yellow-greens (the willow slipped the strict green test); ground-cover tint band lowered to 0.55-0.85; bushes denser (cap 5600, tighter cells)
- [x] #1 ground variation: mud→sand wet banks along rivers/lake rings, gray rocky patches where low-freq noise bottoms out (color + splat)
- [x] #7 dino density: 18 spawns — raptor packs across the interior, trike/stego herds, a second highlands rex
- Known remainders for next rounds: willow still brighter than ideal; a floating log/mushroom artifact near the mesa (asset-floater hunt continues); canyon readability + the full MAP OVERHAUL
- Gates 9/9, 29/29, 12/12, creative 12/12; island + navmesh rebaked, validators pass

### M7e — floaters killed structurally + MAP OVERHAUL phase 1
- [x] Distance floaters (user: "a lot of floating trees and assets still"): ROOT CAUSE — coarse terrain LODs undersample the baked ground detail, rendering distant terrain BELOW the exact surface props sit on. Fix: LOD1-3 vertices sample the MAX height over the cells they span (conservative upward bias) — props embed into the exact surface, so worst case is slightly buried, never floating. Verified: distant treelines sit solid.
- [x] MAP OVERHAUL phase 1 — the volcano (user: "looks weirdly bad"): angular radius modulation breaks the perfect-cone silhouette, radial flank ridges cut gullies, raised crater rim lip + deeper caldera; in-game it now reads as a craggy shield volcano with jagged ridgelines
- [x] Canyon (backlog #4): terraced east-gorge walls (stratified-rock look), rim lift doubled to 6.5m
- [x] Base relief +20% with an extra mid-frequency band (backlog #5)
- Gate note: one bush-harvest flake (positional); passes on rerun and in isolation. Gates 9/9, 29/29, 12/12, creative 12/12; island + navmesh rebaked, validators pass

### M8a — rivers get character + THE ARC BEGINS (keystones + Wayfinder)
- [x] Rivers meander (backlog #2): control polylines densified with dual-sine perpendicular offsets over arc length (amp grows downstream, pinned ends; first bake's 30m amp carved a bay through the SW coast — capped at 14m, west mouth now reads as a sandy estuary); carve/canyon/shores/validators/meta all follow the dense path
- [x] River bed re-asserted post-erosion (droplets silted channels to wading depth — swim gate caught it after the meander moved its probe onto a silt bar)
- [x] River visuals: churning foam bands along both banks (uv-driven, animated), per-vertex depth tint (deep = darker), faster flow perturbation
- [x] **M8 OPENS — the arc's thread:** 5 glowing keystones at the pre-caldera ruin sites (bobbing, spinning, point-lit), E to collect, count toasts, save-persisted; **N = the Wayfinder** — points to the nearest missing keystone (or the caldera gate once all 5 are held) with direction + distance. New gate-m8 (6 checks) green first run.
- Gates: 9/9, 29/29, 12/12, m8 6/6, creative 12/12; island + navmesh rebaked

### M8b — the sky-trunk mystery solved (floating trees, root-caused via raycast forensics)
- [x] Diagnosis chain: floaters() probe proved no instance base renders above ground → raycast identified the giant floating trunk as pine#0 instance 3.9m from camera → footprint analysis revealed Pine1 was a MERGED GROVE (aspect 1.03 — as wide as tall): on slopes, far grove members hung in the air
- [x] Fix 1: Pine1 replaced with a true single pine (Pine_4, aspect 0.57 — same variant count, saves survive; prettier tree too)
- [x] Fix 2: footprint-flatness guard — any prop with aspect > 0.8 only places where ground varies < 2.2m across its footprint (auto-guards future cluster imports)
- [x] Also this round: reverted the max-bias LOD sampling (it cracked the volcano silhouette — white gashes); props instead embed by their exact per-spot LOD error (lodFloorAt); discovered the M5e sink offsets had been silently LOST in the M6a scatter rewrite (props had zero embed since — the real reason floaters persisted)
- [x] QA probes now permanent: floaters(threshold), whatIsThere(screenXY) raycast identify
- Gates: 9/9, 29/29, 12/12, 6/6, 12/12

### M8c — the freeze, the lag, the dark woods, the door
- [x] 5-10s keystone-pickup freeze (user-hit): hiding the keystone's PointLight changed the scene light count → EVERY material recompiled its shader. Halos now dim to intensity 0 (stable program signature). Campfires got a pre-allocated 8-light pool for the same reason (adding a light mid-game = same freeze)
- [x] General lag: root-caused via renderer.info — 9.5M tris/frame, mostly the new single pine (3,370 tris × 6,800 instances); decimated to 616 tris + 256px webp textures → 5.7M tris, 60fps × 3 stable samples. Plus: shadow map at 1/3 frame rate (autoUpdate off), 1536px map, PCF instead of PCFSoft, dinos cast shadows only within 110m, distance-throttled dino mixers (every 3rd frame >120m, every 8th >260m), cover draw 340m
- [x] ARK-dark woods: hemi 0.3 + denser canopy (trees 7800, pines 6800) — forest floors go properly dark under trees
- [x] "Still no dinos" root cause: SAVES preserved their old dino list — wild roster now spawns FRESH every load (25 wild: raptor packs, trike/stego herds, 2 rexes) while tamed dinos persist from the save
- [x] **THE CALDERA DOOR**: stone slab seals the gate arch (collider included); E with all 5 keystones → the slab grinds down over 4s and the crater opens; state persists. gate-m8 grew to 11 checks (sealed initially, refuses when missing, opens with 5, survives reload)
- Gates: 9/9, 29/29, 12/12, 11/11, 12/12 (73 total)

### BACKLOG v2 (player review 2026-09-02, second pass) — priority order agreed: backlog before new phases
1. Render-order bug: "stuff behind renders over stuff in front" (transparency/depth suspect — water depthWrite:false, ghost, halos; needs repro hunt or player screenshot)
2. Wildlife mass: small critters + passive herbivores in numbers — dodo-likes (TerrorBird scaled small), compys (raptor model scaled tiny), grazing herds; world should feel inhabited
3. Sky: real sun disc (visible, glare), drifting clouds; night sky stars(?)
4. Map refinements (continue MAP OVERHAUL): per-landmark screenshot approval, cliffs/outcrops (backlog v1 #6 still open), forest composition
5. Shadows: quality pass (current: 1536px PCF at 1/3 rate — revisit cascade/softness balance)
6. Terrain: more variation continues; rock formations
7. Foliage/rocks: more varieties, densities
8. River/water: further improvements (visual depth, rapids, waterfall at canyon?)

### THE DEPTH MANDATE (player, 2026-09-02) — multi-round program
- Fidelity: reduce low-polyness perception (bigger/better models, detail layers); small resolution cut for FPS headroom
- TERRAIN, MASSIVELY (multiple iterations, hand-made): swamp biome, better lakes/rivers, cliffs + mountain ranges (traversable, realistic), caverns (own round — needs interiors), huge trees, bush-filled plains, desert-ish flats
- Weather system + moonlight; sun disc + clouds (from backlog v2)
- Systems: better inventory UI, survival stats (hunger/thirst/stamina), more craftables, real icons (not emoji)
- Order: terrain first (this round = biome system + 4 new biomes + ridges), then sky/weather, then UI/systems

### M9a — BIOME FOUNDATIONS (terrain mandate, iteration 1+2)
- [x] Biome system: bake writes biomes.bin (1 byte/cell: default/swamp/desert/plains/alpine); runtime biomeAt() drives ground colors, splat weights, vegetation rules, water
- [x] SWAMP (east coast, 170m): flattened marsh with noise-carved pools below a 4.2m water table, murky sheet water (swimmable), willow/deadtree/fern/mushroom flora, peaty ground — the canyon river deltas through it. Screenshot: genuinely ARK-marsh
- [x] DESERT (west, 220m): dune flats, sand splat, near-barren (rocks/deadwood/sparse grass); west river floods its center into an oasis lake (accepted as composition for now — noted)
- [x] PLAINS (southwest of spawn, 200m): open rolling bushland, lighter grass, mega-bushes (1.3x), lone trees only
- [x] MOUNTAIN RANGES: two coastal ridges (NE/NW) — continuous terraced rock walls, 64m, two pass dips each (traversable); iteration 1 beaded into bumps, fixed in iteration 2; mesas relocated inland out of their way
- [x] Deep-forest GIANTS: trees/pines 1.45x (up to ~23/27m) where forest mask > 0.42
- [x] Perf: pixelRatio 1.3 (user-approved resolution trade)
- Gates: 9/9, 29/29, 12/12, 11/11, 12/12 (73). Caverns deferred to a dedicated round (needs interiors). Weather/moon/inventory/icons/stats: next rounds.
- **WORKING AGREEMENT (user): small focused picks per round, deeper work per pick**

### M9b — de-circling the island (one-by-one todo, aerial self-check loop each)
Process change (user): free-camera aerial QA tool (`tools/aerial.mjs` + `setFreeCam` debug, LODs follow the free cam) — screenshot → improve → screenshot per item.
- [x] ① LAKES: noise-warped basin fields — the terrain-vs-level intersection IS the shoreline, so warping the basin grows bays/headlands; oversized water discs hide under raised shores; warp-aware ring + validator (3 iterations: frames mixed → blocky transitions → soft organic pools)
- [x] ② SWAMP: warped marsh boundary; water sheet rebuilt from BIOME CELLS (8m quads where swamp+submerged+above-sea) after the oversized disc floated over the ocean
- [x] ③ DESERT: warped boundary — natural sand fields around the oasis river (the flood now reads as intentional)
- [x] ④ MOUNTAINS: 6-point wobbled spines, 78m massif base + 42m jagged crest line (~150m peaks with terrain) with pass dips — ranges, not mounds
- [x] ⑤ RIVER BANKS: outside the canyon, banks cap ~5m over the bed (softened 65%) — no more random levee walls where meanders cut hills
- All 73 gate checks green; navmesh revalidated

### M9c — mountains v3 (single pick, ARK reference, aerial-iterated)
- [x] The two "circles pulled up" identified as the relocated MESAS — deleted outright (rock formations return later as placed meshes, not terrain stamps)
- [x] Mountains rebuilt: exponential-ridge crest (sharp spine, not gaussian mound), 88m warped massif + 74m crest, multi-frequency peak line (7π + 17π), lateral domain warp on flank contours, altitude-gated jagged fbm (scree/spurs), ~190-215m peaks
- [x] Snow caps above ~112m with noise-dithered snowline (ranges only — the volcano stays hot dark rock)
- [x] Aerial + ground verification: serrated multi-peak skyline, river valley threading volcano↔range; 60fps
- [x] Fixed a real flake the reruns exposed: takeoff raced auto-land (flight cancelled if a fixed step ran between setFlying and the first Space) — auto-land now requires actual descent. Creative 12/12 twice consecutively
- Gates: 9/9, 29/29, 12/12, 11/11, 12/12

### M9d — the render-order bug (single pick, repro → fix → verify)
- [x] Reproduced at the swamp coast: ocean swell striping OVER the nearer swamp sheet, river band drawn over occluding water — transparent sheets with depthWrite:false sort by mesh center, arbitrary for island-sized overlapping sheets
- [x] Fix: deterministic renderOrder by surface elevation (ocean 1 → swamp 2 → lakes 3+level → rivers 4); far-over-near is now impossible among water sheets
- [x] Two follow-on iterations at the same vantage: swamp sea-clip loosened to ground > -0.5 (the 0.6m clip left checkerboard holes over the flooded strip); marsh roughness 0.65 + slower drift (grazing-angle sun glint striped the sheet white — stagnant water shouldn't mirror)
- [x] Ground-level swamp verification: calm matte marsh, dead trees, river threading past — approved. Gates 73/73

### M9e — HAND-MADE LAKES (user: "why formulas? hand-make it" — the process correction)
- [x] The donut root cause was the formula itself: center+radius+noise forced arbitrary water levels onto lower terrain, requiring raised containment rings. All lake formulas DELETED.
- [x] Lakes are now hand-traced shoreline POLYGONS — every vertex a deliberate decision: the west lake (20 vertices) is an elongated highland waterbody with a river inlet neck, an east peninsula pinch, a west bay, and a hand-picked deep point; the east lake (12 vertices) is a small lowland pool with a marshy south end and an SE bay notch
- [x] Depth = distance-from-drawn-shore toward the deep point; banks ease down over a 14m band; carve-only (ground never raised); levels chosen against surrounding terrain and validator-asserted at every shore vertex
- [x] Runtime rebuilt on polygons: lake sheet = fan over the traced shore (+6m tuck), waterLevelAt/scatter/terrain colors all use shared shoreDist point-in-polygon
- [x] Aerial + ground verification: both lakes sit IN the land, river flows through the west lake, oasis shoreline at ground level. Gates 73/73

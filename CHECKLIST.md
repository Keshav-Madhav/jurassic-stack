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

### THE HAND-MADE MANDATE (user, 2026-09-04 — "do everything manually, no shortcuts; I wanted this from the start")
Standing rule: world geometry is hand-traced control geometry (polygons/paths, every vertex deliberate). Formula shortcuts (center+radius+noise, sine meanders) get replaced on touch.
TODO (one pick per round):
1. **RIVERS (this round)**: hand-traced paths; natural sources (spring tarns — no abrupt mid-slope starts); ribbon must not cut through lakes (screenshots 11-12)
2. Swamp boundary + desert edge → hand-traced polygons
3. ~~Forest placement → hand-drawn forest regions; MUCH denser; rich wide-canopy tree models (crowns dominate, fewer visible trunks; ref screenshot 13) + giant trees mixed in~~ DONE M9g
4. Swamp flora: mangrove-type trees, dried bushes — swamp is empty; desert flora: dried bushes, cacti-like — desert is empty
5. Ground clutter everywhere: sticks, pebbles, small rocks, scattered stones, ground foliage — world too clean/empty
6. Volcano gate not visible — caldera-gate ruin/door placement needs relocation/visibility pass (arc must read on approach)
7. Rocks: boulders/outcrops as placed meshes (still missing after mesa deletion)

### M9f — HAND-MADE RIVERS (mandate item 1)
- [x] Sine-meander formula DELETED; both rivers are hand-traced paths (24/22 waypoints, every bend placed), RIVERS_DENSE = the hand path
- [x] Natural sources: two spring TARNS (hand-traced 8-vertex pools) on the volcano's SE/highland shoulders — rivers visibly flow OUT of standing water instead of starting abruptly mid-slope (screenshots 11-12)
- [x] River ribbon CUT where it crosses a lake (shoreDist < -4) — no more river band slicing through the lake's sheet; the current still flows across via riverFlowAt, only the mesh yields; west river now runs the length of the west lake (inlet neck → south bay) as intended
- [x] Tarn levels iterated against a pre-carve shore-terrain probe (east 24.5, west 14 — under their shore minima); canyon frac range retuned for the new waypoint count
- [x] Aerial verification: east river flows from its tarn down through forest; west river enters/crosses/exits the lake cleanly. Gates 73/73, navmesh revalidated

### M9g — HAND-MADE FORESTS (mandate item 3)
- [x] `tools/hand-geometry.mjs` — ONE file for every traced shape (rivers, lakes, forests, glades); bake and map both read it. Forest-mask noise DELETED.
- [x] `tools/map.mjs` — the planning map: gridded (100 m, labelled), hillshade + hypsometric tint, biomes, water, every polygon with its vertices; `--region`/`--ppm` zooms. This is the sheet the rest of the mandate gets traced on.
- [x] Seven woods traced vertex by vertex: Southwood (first forest, ragged wood line a meadow north of the beach, wraps the east lake, fills the SE lowland) · Elderwood (old-growth heart, densest, holds the temple, wraps the east lake's north shore) · Eastbank (mixed, river↔range) · North Pines (between the tarns) · Westwood (NW range flank, the west river runs through it) · Lakeshore (light wood east of the west lake) · Range Pines. Six glades: one per ruin (validator: a ruin standing in forest fails the bake) + the Hollow + the South Meadow.
- [x] `forest.bin` baked (density<<2 | kind, feathered `edge` m inside each wood line, glades punched) — runtime `forestMaskAt`/`forestKindAt` read it; terrain floor turns to dirt from the wood line inward
- [x] Built trees (`src/scripts/trees.ts`): wide-canopy broadleaf (short trunk, limbs, 9-11 lumpy leaf masses a tree-height across, dark leaf greens, sunlit top) ×4 seeds; ELDER giants (36-52 m, buttressed trunk, three tiers) ×2 seeds in the old-growth cores. Quaternius lollipops out of the woods (neon against the canopy).
- [x] Density: trees 1,221 → 3,725 (9 m cells, thinning to the wood line) · pines 1,301 → 1,949 · elders 111 · ferns/bushes thicker under canopy. Aerials read as continuous canopy with glades; eye level is a canopy roof over trunks.
- [x] Perf so it stays 60: three LOD bands per supercell (full <300 m · coarse masses <900 m · ~40-tri trunk-and-blob beyond; pines get a 3-cone twin painted to match) — island judge view 6.9M → 1.5M tris; DeadTree 15.5K → 4.3K and Palm 3.1K → 0.9K tris decimated; berry bush pulled off neon.
- [x] `tools/qa-forest.mjs` — wood vantages with per-kind triangle accounting (`--tris`). Gates 73/73 (m4 once flaked on a raptor in the gather line; 3 clean reruns), live-verified.

### M10 — THE ISLAND v2: THE LASSO (user, 2026-09-04 — "the map is too small for its water; grow it 2×, one river, two lakes, a reservoir")
Story in PLAN.md → "The island v2 — the Lasso". One round each, gates + screenshots + live check before the next. Culling, LODs and budgets are part of every round ("shit tons of culling and lods and optimizations").
- [x] **M10a — the 4 km canvas + the Lasso.** DONE (below)
- [x] **M10b — two lakes + the terrain body.** DONE (below)
- [x] **M10c — biome edges by hand.** DONE (below)
- [x] **M10d — forests retraced + the Holm redwoods.** DONE (forests in M10b; redwoods below)
- [x] **M10e — ruins hand-placed; caldera gate visible.** DONE (below)
- [x] **M10f — swamp flora + desert flora.** DONE (below)
- [x] **M10g — ground clutter.** DONE (below)
- [x] **M10h — boulders / outcrops.** DONE (below)

### M10a — THE 4 KM CANVAS + THE LASSO (the island v2's spine)
- [x] Canvas: HALF 2048, 2049² @ 2 m (int16 scale 0.02 for 400 m peaks), 32×32 chunks + 8×8 untextured far super-chunks (1024 far draw calls → 64); camera far 6000 / near 0.6 (the 0.1 near z-fought the sea through far beaches); fog scaled to 4 km; row-delta heightmap encoding (brotli 3.2 → 2.3 MB); navmesh 4 MB at cs 1.2 (1.6 broke reachability)
- [x] `tools/hand-geometry.mjs` now holds the WHOLE island: COAST (100 vertices: spawn bay between two headlands, Estuary Bay + the Spit, East Cape, the Wellspring cove, NW Bight, a west fjord, Dune Bay), RANGES (crest paths with a height per vertex — each vertex a peak, saddles between), HOLM plateau, RIVER (legs + ring + ford), LAKES (reservoir, wellspring), FORESTS, CLEARINGS, RUINS
- [x] `tools/map.mjs --sketch`: the geometry alone on a gridded sheet before any bake — the coast was traced and retraced there (the first pass was a compass circle)
- [x] Bake rewritten around the drawn lines: coast SDF → beach band dipping to the waterline AT the line, sea profile capped after erosion (880K droplets built beaches 100 m out), ranges = massif + exponential ridge on the crest with saddle dips and slow lateral warp (spurs, not slabs), volcano scaled (rim 290 m), the Holm held at 20 m so the ring is a carve
- [x] THE LASSO: inflow (Wellspring pool 38 m → slot canyon → the Knot), ring (dead water at 14 m, closed Catmull-Rom, no foam/current, `riverFlowAt` null inside), outflow (Knot → swamp at the marsh's water table → Estuary Bay), the Reservoir (11 m deep basin where four arms meet), the Ford (knee-deep bar on the ring's west side). Bed profiles per part (legs monotonic, inflow bent onto the ring's bed, ring level); validators for each
- [x] Ruins hand-placed and asserted (flat/dry/open/off-river) + navmesh reachability 6/6 — the seeded search was retired after it perched the vault on a shoulder no path climbed
- [x] Culling/LOD for the 4× world: caps ×4 (the north→south scan starved the beach of grass), island-wide dot meshes per tree kind (per-cell dots were hundreds of draw calls; island view 659 → 213 calls, JS render 14.7 → 3.6 ms), far twins for willows, dots for palms/dead trees, rocks hidden past 600 m, palms only on the beach band, Grass1 155 → 62 tris, the 6K-tri Quaternius "Mushroom" (a mushroom CREATURE with eyes, 670 of them in the woods) replaced by a built 60-tri cluster, ocean ripple fades with distance (killed the moiré), `__g.perf()` splits JS update/render ms
- [x] Gates re-pointed at the world (spawn(), gateSite(), meta) — 73/73; aerials + qa-forest re-authored for v2

### M10b — TWO LAKES, THE TERRAIN BODY, AND 200 DINOS (user: "too empty, too flat, WAY more forest, the ring too round, rivers too straight, more mounds and foothills, at least 200 dinos")
- [x] **Lake Aster** against the West Range's foot (level 34.5, a peninsula from the south shore, a bay to the north-east) and **the Alpine Tarn** (231 m) on a hand-cut cirque bench — `SHELVES` in hand-geometry: a traced polygon held flat, the only flat ground a range ever offers. Levels chosen by probing shore terrain with `bake-island.mjs --no-lakes aster,tarn`
- [x] **The ring** retraced as a bumpy, wavy oval ~900 × 850 m (was a compass circle); the Knot and Reservoir moved with it; **both legs** retraced with real turns (25 and 19 waypoints of S-bends)
- [x] **Terrain body**: tableland 26 → 32 m with base relief 9 → 12 m, positive-only MOUNDS (200–500 m billows up to 18 m), six hand-traced FOOTHILL chains (`soft: true` ranges: rolling massif, no crest, no rock bands) and a third range, THE NORTHERN HORNS (230 m) on the NW shoulder; biome flats no longer cut into ranges (the desert had sliced the West Range into an orange wall)
- [x] **Forests WAY more**: 15 traced woods, 5.39 km² wooded (was 1.2) — the Ringwood over the whole ring country, the Westwood wrapping Lake Aster, pines over both ranges' flanks and the Horns, mixed woods on the foothills and the volcano's skirts, the south-east and east-coast woods; altitude caps (broadleaf < 130 m, pines < 210 m) keep the peaks bare. Trees 4K → 43K broadleaf + 52K pines + 1.6K elders; 7 glades incl. one per ruin (validated)
- [x] **200 dinos** (`population.ts`): habitat-placed packs/herds/apexes by forest mask + biome, deterministic per seed; **dormancy** in `Dino` — wild idle/wander dinos beyond 680 m freeze and hide (no AI, no mixer, no draw), wake inside 600 m; n² pack/separation loops skip dormant ones. Spawn-beach raptors spread out (a tight pack of three killed the new player)
- [x] Bank cap FEATHERED at its edge (a hard stop left a 10 m step around every channel — reachability caught it); navmesh validator given a 65K-node A* pool (the default pool ran out mid-island on 4 km paths and reported reachable ruins as "stops short"); ruins re-sited by probing for flat, open ground
- [x] Perf: full-LOD tree band 300 → 180 m; spawn 5.4M tris / 56–60 fps headless, gates 73/73

### M10c — BIOME EDGES BY HAND (mandate item 2 — the last formula regions are gone)
- [x] `BIOMES` in hand-geometry: the Writhing Flats (swamp, wraps the outflow's upper course in the Reservoir's lee, lobes to the east foothills; floor 4.8 with pools under a 4.2 water table), the Dune Country (desert in the West Range's rain shadow down to Dune Bay, floor 9 with dunes), the South Plain (floor 14, a grassy shelf on the way down to the beach). Each a traced polygon with a floor the ground eases to over `edge` metres; `warpedDist` and the three discs deleted; `biomes.bin` and the swamp sheet read the polygons
- [x] Biome floors never cut into a range (h > 45 m untouched) and the swamp never climbs the Holm
- [x] Spawn meadow widened (wood line 1480 → 1430) and the canopy tree trimmed to 8 leaf masses (~720 tris); dot LOD from 600 m; the m3 fps gate now samples steady state (12 s after ready, best of 3) — the first ten seconds are 200 rigs cloning and 100K instance buffers uploading. 73/73

### M10d — THE HOLM REDWOODS
- [x] `buildRedwood` (trees.ts): 55–80 m fluted, buttressed red columns carrying more than half their height bare, then a narrow tiered crown; far twin + a tall dot LOD readable from kilometres off. Forest kind `redwood` (3) — the Holm wood polygon is the only one that carries it, so they grow nowhere else; ~2,300 of them
- [x] Eye level in the Holm reads as ARK's Redwood Forest: red columns under a high canopy, the temple arch between them
- [x] Perf: Bush1 360 → 190 and Fern 288 → 142 tris (cover was the biggest eye-level cost — 27K bushes), cover draw distance 340 → 290 m; spawn steady-state 60 fps again, gates 73/73

### M10e — THE CALDERA GATE READS FROM THE APPROACH (mandate item 6)
- [x] Ruins are hand-placed coordinates in hand-geometry (since M10a) — the gate stands at the volcano's south foot on the open approach corridor the pines leave clear
- [x] The gate made monumental: a 15 m arch with its 12 × 15.5 m slab (door + collider resized, drop animation deeper/faster), two 7 m guardian statues facing the approach, a 70 m causeway of columns — visible as a monument from 270 m down the corridor with the volcano behind it (screenshot-verified), 73/73

### M10f — SWAMP AND DESERT FLORA (mandate item 4 — the empty biomes)
- [x] Built in `trees.ts`: MANGROVES (stilt roots to the water, low broad olive crowns, far twin), REEDS (tall blade clumps), DRIED BUSHES (fans of bare twigs), CACTI (ribbed saguaro columns with arms)
- [x] Where they grow: mangroves on the swamp's wet floor within 2.2 m of the water table, reeds right at the table (and along every lake shore), dried bushes on the drier hummocks and across the desert with the cacti; swamp/desert flora never leaves its biome. ~870 mangroves, ~3,000 dried bushes, ~500 cacti, ~500 reed clumps
- [x] Eye level: the Writhing Flats read as a mangrove swamp, the Dune Country as a saguaro desert (screenshot-verified), 73/73

### M10g + M10h — GROUND CLUTTER AND ROCK (mandate items 5 and 7)
- [x] Built clutter (`trees.ts`): PEBBLES (spills of small stones, ~51K), STICKS (fallen branches under the trees, ~18K), STONES (knee-high pairs, ~9K) — all ground cover with short draw distances (110/120/200 m; mushrooms and flowers pulled in too)
- [x] Rock: BOULDERS (the Quaternius rocks at 3–8 m on slopes and high ground, ~1,800, hidden past 1 km) and built OUTCROPS (four to six leaning stones + a crown stone, 5–14 m, where the ground rises hard, ~350, far twin). Stone is gray now: Rock2's clay-orange texture dropped, Rock1's chalk-white lightness capped. Rock sits on any slope (exempt from the merged-grove flatness guard that had left 600 boulders and ONE outcrop)
- [x] 73/73

**The hand-made mandate list (M9) is complete: 1 rivers · 2 biome edges · 3 forests · 4 swamp/desert flora · 5 ground clutter · 6 the gate · 7 rock.**

### M11 — THE FEEL ROUND (user: "very jittery when moving — the faster the more; performance")
Findings and fixes, each measured with the new jitter meter (`__g.frameStats()`, `tools/qa-jitter.mjs`: stand / walk / sprint / fly, p95·p99·max·hitches>25 ms):
- [x] **The jitter itself**: the camera followed the RAW physics position while the player model was interpolated — with a fixed 1/60 step the mover advanced 0, 1 or 2 steps a frame as the accumulator drifted, and that quantised motion scales with speed (walk shimmer → ride stutter → flight shake). Camera target and the ridden dino now sample prev→current by alpha like the model always did
- [x] **The hitches** (a 33/66 ms frame every chunk border at speed): chunk geometry moved to a Web Worker (`terrain-worker.ts` loads the same world, runs the same `terrain-paint.ts`, transfers arrays back; first-frame LOD3 fill stays synchronous); water-edge distance from an 8 m field instead of every river segment per vertex; terrain colliders are Rapier heightfields (O(n) to create — the trimesh BVH build was the border hitch); scatter colliders indexed per chunk (was a walk over 300K nodes); respawns walk a dead set; instance uploads are partial (`addUpdateRange`) and one contiguous range per cell flip
- [x] **Impostors** (the user's billboard idea): every tree kind beyond 180 m is three textured cards — two crossed uprights + a crown card — carrying the real model's side and top views captured at load (`impostor.ts`); one island-wide instanced mesh per kind+variant (two draw calls), slots by cell. Far twins and dots deleted. Spawn 5.0M → 2.75M tris, island view 1.0M; shadows now every frame (the every-third-frame update strobed 16/16/33)
- [x] Jitter meter after: standing 0 hitches (max 16.8 ms); walk/sprint/fly 2–4 hitches per 12 s (was 9–89). 73/73

### M12 — COLLISIONS, THE PORTAL, THE LOST CITY (user: "collisions; the gate isn't dug into the volcano; 2–4× the ruins")
- [x] **Rock collides as it looks**: boulders, outcrops and rocks get convex-hull colliders from their own vertices (scaled and turned per instance); the cylinder stood you in mid-air beside a boulder and on a flat invisible lid on top (screenshot 15)
- [x] **The gate is cut INTO the volcano**: two hand shelves — a flat apron at the cone's south foot and a 33 m rock face right behind it — with the 15 m arch set against the face, the slab in it, statues and the causeway down the apron. From the corridor the mountain has a door in it
- [x] **Navmesh**: the volcano's cone (inside 330 m) and the sea floor are left out of the input — the rippled flanks fragmented into so many polygons that the volcano TILE failed and vanished, taking the apron with it; tiles 256, climb 1 m. `tools/site-finder.mjs` finds flat, dry, open ground near a wished-for spot
- [x] **Ruins 6 → 23**: seventeen minor sites hand-placed across the island (a ring on the plain, a watch over the estuary, columns on the Spit, an obelisk and a shrine in the dunes, a shrine on Lake Aster's bay, a watch west of the ring, a shrine in the redwoods, columns in the swamp, a circle on the east foothills, arches in both pine woods, a watch under the Horns, columns above the Wellspring gorge) with seven layout kinds and a glade for each one in a wood; only the five arc sites carry keystones. All validated flat/dry/open/off-river and reachable. 73/73

### M13 — SWEEPING RIVERS, BLENDED TREELINES, A LITTERED FLOOR (user: rivers zigzag round a straight axis; forest zones have hard edges; the floor needs to be absolutely littered with grass)
- [x] **Rivers**: both legs retraced as long arcs whose average line is itself an S — the inflow leaves the pool south-west, swings back south-east under the east foothills, bends west across the flats and comes round south to the Knot; the outflow runs east, bends south through the marsh, then east and south-east to the estuary
- [x] **Treelines**: feathers widened to 90–120 m and the drawn wood line wobbles ±40% of the feather in the bake (tongues and bays, not a band); COPSES grow in the open where a slow noise peaks (0.18 km² of thickets); 4% of open cells carry a lone tree — no wood ends at a line any more
- [x] **The grass field** (`grass.ts`): a streamed carpet of painted grass cards (three crossed quads, six tris, a canvas-painted blade sprite) generated per 48 m tile from a hash around the viewer — 7×7 tiles, ~25K tufts in view, one tile built per frame; thinner under a closed canopy, a few dry tufts in the dunes, none in water. The scatter keeps a modest harvestable sprinkle
- [x] Jitter meter: 0 hitches standing / walking / sprinting / flying, max 16.8 ms. 73/73

### M14 — 500 DINOS, ELEVEN SPECIES (user: "more dinos, maybe 500, and variety")
- [x] Seven species wired from the intaken roster, clip maps read off each GLB: **Carnotaurus** (the sprinter), **Allosaurus** (the north's second apex), **Terror Bird** (flocks on the plain and dune edges), **Pachycephalosaurus** (skittish headbutter), **Parasaurolophus** (herds on the plain, the first easy ride), **Apatosaurus** (8.5 m sauropod), **Mammoth** (highlands, pairs and threes). Dilophosaurus/Sauropelta/Spinosaurus wait on rigs with real clips
- [x] Population 200 → 500 by habitat (carnivores by wood and latitude, herbivores by open ground, mammoths above 60 m or north of the pines); a parasaur herd grazes the south plain by spawn. Dormancy keeps it at 60 fps; jitter meter clean at every speed
- [x] `__g.game.gotoSpecies(id)` for portraits; stone recolour darkened again (boulders read as chalk in the sun). 73/73

### M15 — FOG, LOD BANDS, THE WATER-THROUGH-LEAVES BUG (user list, 2026-09-05)
- [x] **Fog with a subtle onset** (140 → 1500 m by day, tighter at dusk/night); the camera's far plane follows the fog so nothing beyond it is drawn — a fresh spawn sees meadow, wood line and haze, not the volcano (PLAN.md revised: the volcano is found, not shown). QA tools stretch the fog for aerials (`__g.setFog(6)`)
- [x] **Water through leaves and bushes** (screenshot 19): the Quaternius pine needles, palm fronds and berry bush ship alphaMode BLEND — no depth write, sorted behind the water's renderOrder — so the sea drew straight over them. Every foliage material is CUTOUT now (alphaTest, depth write)
- [x] **Three LOD bands** ("trees become billboards too soon"): full model to 240 m, the built kinds' coarse twin (20-tri masses; pines as three cones) to 480 m, impostor cards beyond. The mid band is per-cell instanced (an island-wide slot set submitted 11M zero-scaled triangles a frame — measured, reverted)
- [x] **Tessellation**: recorded in PLAN.md as a later item (user correction: it would be good, not yet)

### M16 — DENSER GRASS, 1500 DINOS, MOON AND CLOUDS AND SOUND
- [x] **Grass by ring**: 1.0 m spacing underfoot → 1.7 → 2.6 m out to ~290 m (9×9 64 m tiles), built in the terrain worker (`grass-gen.ts`, matrices transferred back; the main thread only uploads); tiles rebuild when their ring changes; none on the sand
- [x] **1500 dinos**: population tripled by habitat. Found and fixed the real costs: dormant rigs are DETACHED from the scene (three.js updates world matrices for every Object3D, visible or not — 1500 rigs × ~100 bones was 30 ms a frame); dormant dinos poll for waking every 8th frame; the pair loops (pack aggro, separation) run over the awake set only; scatter LOD/cover re-evaluates when the viewer has moved 3 m
- [x] **Night**: a real moonlit night (blue key 1.35, lifted fill, exposure 0.78, fog 0x22304c to 1250 m), a **moon disc** riding the night light, a **starry dome** fading in over the black Sky shader
- [x] **Clouds**: 70 soft cumulus cards at 420–760 m, drifting, wrapping around the viewer, lit by the key light (fog-free so they stay white), moon-blue at night
- [x] **Ambience** (`ambience.ts`, Web Audio, no files): wind that breathes, birdsong by day, insects at night; starts on the first click/key
- [x] Jitter meter: 0/0/3/1 hitches; spawn 60 fps with 1500 dinos and the dense carpet. 73/73

### M17 — THE RAVINE AND THE CRATER (the M8 finale, behind the door)
- [x] **The crater is a bowl**: a hand `crater` shelf (175 m, ten-vertex shore ~90 m across, 34 m feather) sinks the summit 100 m under the rim — the old cone had a centre as high as its rim. Validators: rim probed at 140 m (outside the bench), the bench must sit ≥60 m under it
- [x] **The Ravine** (`RAVINE` in hand-geometry): a nine-point switchback path from the door's rock face up the south flank to the bench, a 16 m slot floor climbing 71 → 175 m, walls at 2.4:1 to wherever the cone already is. Cut before erosion; **re-laid after it** — 880K droplets and three talus passes had shed the 100 m walls into the slot and stepped the floor (the navmesh stopped 274 m short). The crater bench is shaved back to its height the same way
- [x] **Navmesh**: inside the cone only the slot floor (±11 m of the path) and the bench are input; spawn → crater-beacon now paths in 30 waypoints. `NAV_PROBE="x,z;…"` adds throwaway targets to the reachability run, and the mesh is written even when reachability fails (a stale navmesh.bin sent the first probe down the wrong hole)
- [x] **The Beacon** (`beacon.ts`): three-tier basalt plinth, stem, open bowl; lit → three billboarded flame cards (a squeezed radial gradient — the first cut painted an orange rectangle), 160 rising embers, a 260 cd point light, the bowl going emissive, a chord swell in the ambience. `crater-beacon` site with a `beacon` court layout (8 columns r16, two guardians facing the mouth, an 11 m arch). No grass or flora inside 340 m of the vent (`grass-gen`); scatter already kept the cone to rock
- [x] **The finale**: E at the brazier with all five keystones lights it (refuses cold otherwise); 2.8 s later the credits card fades in over the world — title, "The beacon is lit.", the tally (keystones · tames · pieces built · island days lived, `DayNight.elapsedDays` now saved) — any key or click dismisses. The Wayfinder points to the beacon once the door is open. `beaconLit` saved and restored (the fire comes back at full heat)
- [x] **Gates**: M8 gate +7 checks (ravine ground climbs 71→175 with no drop >1.5 m / no step >6 m per 5 m; beacon cold after the door; refuses without keystones; lights; credits show; dismiss; survives reload) — **80/80**. The M4 taming gate was flaky since 1500 dinos (the nearest idle dino on the beach was as often a trike; the ride heading sometimes met a tree) — `gotoDino(state, species)` and four ride headings; 3/3 clean
- [x] Screenshots `tools/qa-crater.mjs`: cone aerial with the slot and the sunk bowl, ravine mouth and switchback, the court framed by its arch from the top of the climb, crater aerial, the beacon lit at dusk and at night, the credits card. Jitter meter 0/1/2/6 hitches (fly 6, one 66 ms frame — within the headless range seen before)

### M18 — THE BIG-ISSUE ROUND (user screenshot 20: island-sized mammoths; bad clouds; a constant piercing ring; sharp frame drops on moving/turning; "fix terrain and stuff, no plan progress")
- [x] **Island-sized dinos**: since M16 a dormant rig is detached from the scene — and `load()` calibrated it detached, so `updateMatrixWorld` never reached the bones, `skinnedBounds` read stale bind matrices and the height scale came out ×50–100 for whichever species happened to spawn far off. Rigs are attached for calibration and detached after; `measuredHeight()` + `__g.game.sizeAudit(tol)` audit every loaded rig against its species height, and the M4 gate fails if any is off by more than the pose swing
- [x] **The ringing**: the insects' tremolo LFO was wired straight into the level gain — summed ±0.5 onto it — so a 3.2 kHz sawtooth played at half volume day and night. Rebuilt as osc → bandpass → tremolo stage (0.5 bias + 0.5 LFO) → level (0 by day, smoothed); the wind buffer normalised (it clipped at the output: a sandy edge); birdsong lower and softer
- [x] **Frame drops on turning** (measured: two spins at the wood line → 115 of 367 frames over 25 ms; 30 fps facing the forest). Three causes, each found with the new `__g.drawAudit()` / `tools/qa-draw.mjs`: (1) **draw calls** — 580 at the wood line, 124 of them rocks and boulders drawn to 600/1000 m, ~90 mid-band leaf twins per kind+variant, impostor-less kinds (cacti, dead trees, palms, willows) drawn island-wide, the mossy log's five materials 25 calls for 49 logs, 170 for awake rigs drawn out to the 600 m dormancy ring. Now: rock 220 m / boulder 420 / outcrop 480, ONE mid twin per kind per cell, impostor-less kinds end at the mid band, untextured submeshes fold into one vertex-coloured geometry, rigs attach only inside 380 m (and don't pose their bones beyond it). 580 → 405 calls, render 17.7 → 9 ms; (2) **first-sight shader compiles and texture uploads** — 100–230 ms stalls whenever a species or a hidden cell first entered view: a warm-up at load (every hidden cell visible, one rig per species attached, `compile` + one shadow-mapped frame + `initTexture` on every texture), plus a per-species hook as the 1500 rigs finish loading; (3) **fill on Retina** — adaptive pixel ratio (1.3 → 0.7) driven by the measured frame time, rare steps with hysteresis. Jitter meter now: 0 hitches standing / walking / sprinting / flying / spinning at spawn / spinning at the wood line (was 115); the meter gained the spin tests and a worst-frame section breakdown (`frameStats().worst`, incl. new programs + textures that frame)
- [x] **Clouds**: two cards a cloud — a flat top-down card and an upright billboard carrying a shaded heap (white tops, blue-grey flat base) — every puff inside the canvas under an elliptical mask (they were hard white lozenges: puffs ran off the edge), sizes 110–570 m; the flat card thins when you're under the deck. The noon sky itself went deep blue (turbidity 2.6 / rayleigh 1.1 — it was washed near-white, which is why the clouds read grey)
- [x] **Terrain**: the ranges were coal heaps — an old v1 rule faded everything above 55 m to basalt and above 130 m to near-black cinder, and its snow check measured distance to the *v1* volcano. Now: alpine scree above 110 m, basalt/cinder only on the cone (by distance to the real vent), **snow above ~185 m** with a dithered line that holds on any slope a snowfield holds (and a shader flatten so the snow isn't beige sand texture); rock greys lifted; golden-hour key less magenta (grey rock went pink at 17:00); chunk skirts deepened 8+4·step (white sky slivers through LOD seams on 60° flanks)
- [x] M4 gate +1 (rig sizes), all five gates **81/81**; `tools/qa-draw.mjs` added

### M19 — IN-WORLD FIX ROUND (user screenshots 21–23 + list: water over things and floating; resolution drop; dino behaviour; night ringing; flashing; the gate walked round + a world border; dino animations + blood)
- [x] **The floating water** (21, 22): the ring is dead water at 14 m and its south end leaves the Holm for plains that sit 1–3 m under that — the carve never raised a bank, so the sheet hung over low ground and dinos grazed a dry trench beside a wall of water (what looked like "water rendering over" them was the far bank being below the surface). `containRing()` in the bake: a wading shore (level −1.5 at 0.7 hw) rising to a crest (level +0.7 at 1.2 hw) feathering into the land, re-laid after erosion; a validator probes both banks at 1.4 hw all the way round. Water roughness 0.18 → 0.34 and ripple 0.22 → 0.13 (the near sheet blew out to milk-white — the "bulging"). `tools/qa-water.mjs` shoots every water edge
- [x] **Resolution**: the adaptive pixel ratio's floor 0.7 → 1.0 CSS px, and it only steps down under a sustained >22 ms average (user: "resolution seems to have dropped a lot")
- [x] **The ecology** (dinos "need to think"): the generic brain gained `diet` and a third temperament. Every ~0.5 s an awake wild animal looks around: a hungry **carnivore** picks the nearest herbivore it can take (≤1.6× its height, ≤2.5× its hp, not tamed) inside its hunt range and runs it down — bites, the prey bleeds, a kill becomes a **carcass** (75 s) the hunter **feeds** on for ~18 s and is sated for 2–4 minutes; **skittish herbivores** (pachy, parasaur) bolt from any carnivore inside their fear range; **defensive ones** (trike, stego, mammoth, apato) ignore anything smaller than them until it comes within 16 m, then charge it — and everyone flees an attacker 1.25× their height. Prey fighting back doesn't break the hunt; a struck herbivore attacks its attacker (or flees, by temper); packs join on the leader's foe; herbivores' wander targets drift toward their herd's centre. Predators rebalanced to win the hunts they pick (carno 26 → 42, allo 34 → 48, trex 55 → 90, raptor 14 → 16, terror bird 16 → 20; the M19 staging run had a trike out-tank a carno). `tools/qa-ecology.mjs` stages a plain and logs 50 s of who-did-what-to-whom; `tools/gate-ecology.mjs` (15 checks) demands hunts, flights and every clip slot resolved
- [x] **Animations** (`tools/qa-dinos.mjs`: the clip audit + side-on walking portraits with the ground-truth travel direction): the **Allosaurus and Apatosaurus walked backwards**, the **Terror Bird sideways** — `facingOffset` per species (π, π, −π/2); the **T-Rex has no walk clip** (its slot fell back to `run` at 1.3× — moonwalking) → a walk that IS the run clip plays at half tempo; the **T-Rex and Mammoth have no death clip** (KO played a roar / the idle) → a procedural topple onto the side. `Dino.headSide()` measures where the rig's high parts sit vs the heading as a second opinion
- [x] **Blood** (`hit-fx.ts`): every landed blow — the player's swing, a dino's bite on the player or on prey — sprays dark red drops (pooled Points, gravity, 0.7 s) and leaves a couple of ground decals for 40 s
- [x] **The ringing at night**: the insects were still one continuous oscillator (a tremolo'd tone is a ring after a minute). Now four "singers", each a short pulsed sine burst (6–9 pulses at 28 Hz) every 0.6–2.4 s, more of them the darker it is — crickets, with silence between
- [x] **Flashing**: the environment map re-baked every 3° of sun — every ~5 s of the 10-minute day — and each bake was a 20–40 ms stall AND a visible jump in every reflection (the water most). Baked once from a mid-morning sky; only `environmentIntensity` follows the day now
- [x] **The gate walked round** (23): the arch stood 14 m out on the apron and the slot ran on angled beside it. The Ravine's first leg now runs straight north so the slot is square to the door; the arch and the slab (18 × 17, plus two invisible jambs) sit IN the mouth at z −912 where the walls rise; the slot walls steepened 67° → 74° (the cap had cut the wall shelf into a 40° ramp beside the slab); and the whole volcano got a **52 m escarpment band** at ~280 m — the cone's own flank never passed 47°, so it could be walked up any side — with the gate-wall shelf's back rising 52 m into the cone so the shelf isn't a landing. The M8 gate pushes north beside the door from both sides and sprints at the mountain from four compass points (must stay under 200 m): **24 checks**. Scatter keeps the Ravine floor and ruin courts clear of solids (a boulder sat across the door)
- [x] **The world border** (`border.ts`): four invisible walls at 1.96 km, a hex-grid veil that fades in over the last 120 m, a clamp behind them for teleports and mounts
- [x] **Also**: the grass-card texture without mipmaps (an alpha-tested card whose minified mip averaged above the threshold drew as a solid green rectangle at 20–60 m — seen behind the dinos in the portraits); skinned meshes culled by a sphere computed once per species from the posed skin (M18b's culling-off drew every rig in 380 m whichever way you faced — 280 calls); the M4 taming gate follows ONE spawned raptor with the player invulnerable (the beach pack was off hunting and the raptor's bites killed the puncher mid-loop). Gates **6 files, 102/102**; jitter meter 0 hitches everywhere; wood line 411 calls

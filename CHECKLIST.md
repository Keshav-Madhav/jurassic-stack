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

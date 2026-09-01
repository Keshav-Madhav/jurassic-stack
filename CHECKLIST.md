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

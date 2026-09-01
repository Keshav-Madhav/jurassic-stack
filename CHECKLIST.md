# Checklist — the task ledger

One milestone chunk per session. A box is ticked only when it's **proven** (build passes + screenshot
or scripted check) and committed. Gates are the definition of done for each milestone.
Plan of record: `PLAN.md`.

## M0 — Bootstrap
- [x] Repo + git init, Vite/TS/vercel config matching minecraft-JS pattern
- [x] Boot scene renders (three r185, ACES, flat-shaded placeholder)
- [x] PLAN.md + CHECKLIST.md + CLAUDE.md committed
- [x] Origin added + first push (github.com/Keshav-Madhav/jurassic-stack)
- [ ] Vercel project linked, first deploy renders the boot scene

**Gate:** `npm run build` clean; deployed URL shows the boot scene.

## M1 — Asset intake gate
- [ ] `tools/gate.mjs`: given a GLB → report tris, bones, animation clips, texture sizes; fail thresholds
- [ ] `tools/turntable.mjs`: playwright-core turntable screenshots per model → `shots/`
- [ ] Download tier-A roster + Quaternius fallback six (PLAN.md links); archive originals in `public/models/_raw/` (gitignored if heavy)
- [ ] Run everything through the gate; record per-model results in `ASSETS.md` (species, source, license, clips, verdict)
- [ ] gltf-transform pass: meshopt + KTX2, spot-check clips survive conversion in gltf-viewer

**Gate:** every model in `ASSETS.md` has clips verified and a turntable shot; broken imports flagged with Quaternius substitute noted.

## M2 — Art-direction test scene
- [ ] Scene: one tier-A raptor idle-animating in a Quaternius forest patch, unified color grade
- [ ] Screenshot batch (3 grades × 2 times of day) for human review
- [ ] **Decision recorded in PLAN.md: realistic-leaning vs stylized-leaning**

**Gate:** the user has picked a direction from the batch; PLAN.md updated.

## M3 — Graybox island + mover
- [ ] Heightmap chunk renderer: fixed grid, 3–4 index-buffer LODs, skirts
- [ ] Rapier heightfield collider from the same heightmap fn
- [ ] Shared "mover" class (Rapier KCC): player on foot — walk/sprint/jump, third-person camera
- [ ] One dino wandering on steering (wander/idle FSM), ground-clamped
- [ ] Day-night cycle: Sky addon + sun animation + PMREM rebake
- [ ] Screenshot harness (`tools/shots.mjs`) with authored vantage points

**Gate:** 60 fps on the graybox; walk the whole island without falling through; dino wanders believably.

## M4 — Core loop (THE DEMO MILESTONE)
- [ ] Species table v1 (data-driven: stats, speeds, aggro, tame food, clip map) + generic dino brain
- [ ] Gathering: hit tree/rock → resources to inventory (DOM HUD)
- [ ] Crafting v1: ~10 recipes, hotbar
- [ ] Building snap v1: foundation → wall → ceiling sockets, placement raycasts
- [ ] Taming: torpor knockout → feed → tame bar → loyalty; tamed follow
- [ ] Riding: mount/dismount, input redirect, camera boom swap
- [ ] Save/load v1: idb-keyval world diff

**Gate:** a fresh session can gather → craft → build a hut → tame → ride, no console errors, saved and reloaded.

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

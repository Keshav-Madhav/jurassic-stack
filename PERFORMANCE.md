# Performance plan — 30+ fps on a Windows laptop, no resolution tricks

Written 2026-09-07 after M24–M26 (the CPU rounds) and the user's report that an M5 Pro dips to
30 fps at full window. `PLAN.md` says "profile-iterate"; this is the contract, the causes, the
levers in order, and how each one is proven. Ledger entries land in `CHECKLIST.md` as usual.

## The contract

| | Target | How it is measured |
|---|---|---|
| **Reference machine** | an integrated-GPU Windows laptop (Intel Iris Xe / AMD 780M class), Chrome, 1920×1080 fullscreen | the HUD's **F3 GPU-ms readout** — the friends screenshot it; it is the only instrument that runs on their hardware |
| **Proxy here** | Apple M5 Pro, headless Chrome/ANGLE Metal, **2560×1440** (≈ the user's full-window pixel count) | `tools/qa-gpu.mjs` at 2560×1440 (GPU timer queries, min-of-20); `tools/qa-jitter.mjs` at the same |
| **Budget on the proxy** | **≤ 12 ms GPU** at the wood line and the plain, ≤ 8 ms at spawn, 0 hitches | gate: `tools/gate-perf.mjs` (to write) fails above budget |
| **What that buys** | 60 fps on the M5 Pro at full window; an integrated GPU is 3–4× slower → 30+ at 1080p | verified by the friends' F3 numbers, not assumed |
| **Resolution** | native. A render-scale option exists as the player's LAST resort, never the default | the settings menu shows it as a slider, off by default |

**The mistake this corrects:** QA ran at 1280×720 — a quarter of the user's pixels. Every "60 fps"
in the ledger before M26 was at that size.

## What M31 actually measured (and how much of the theory below survived)

Everything under "Where the frame goes" was written from reading the code. Then it got measured
properly, and most of it was wrong. The measured truth, at 2560×1440 on the M5 Pro, warm:

| | GPU (p10) | wall p50 |
|---|---|---|
| spawn beach | **6.5 ms** | 7.4 ms (135 fps) |
| wood line | **5.4 ms** | 10.1 ms (99 fps) |
| plain | **4.2 ms** | 8.9 ms (112 fps) |

The frame is not 25 ms. It is 5–7 ms of GPU, and the budget in the contract above is met with room
to spare. The M26 "~25 ms" figure was measured with the game loop running against a profiler that
was also rendering — the two fought over the GPU, and the number was roughly double the truth.

**So why does an M5 Pro dip to 30?** Not the steady frame. It is FIRST-SIGHT WORK: walking into a
region that has not been drawn before cost up to **54 texture uploads and 21 shader compiles inside
a single render call** — 100–500 ms, and one 1.1 s freeze. A median frame time cannot see any of
this; `tools/qa-hitch.mjs` was written to. That is where M31's fixes went, and where the next round
should keep going.

### The four things that made the instruments honest

Three earlier attempts produced confident nonsense — negative layer costs, layers that summed to
twice the frame, a "sky" that cost 3 ms and 0.02 ms in consecutive runs. What fixed it:

1. **Additive, not subtractive attribution.** Hiding one layer of an overdrawn scene saves nothing —
   the pixels don't vanish, the layer behind shades them instead. Hide everything, then reveal one
   layer at a time and watch the frame grow.
2. **Vsync off** (`--disable-gpu-vsync --disable-frame-rate-limit`). With vsync the wall clock is
   pinned at 16.7 ms whatever the frame costs, and an idling GPU downclocks between frames and
   reports 2–3 ms of noise on an identical picture.
3. **Freeze the world** (`__g.setFrozen(true)`, dt = 0). A herd walking through the shot moved the
   reading by 3 ms.
4. **Warm for 30 seconds, and read the 10th percentile.** The frame at spawn reads 11 ms for the
   first half minute and 6.5 ms after. Medians wander; p10 is stable to a tenth.

## Where the frame goes (measured, M26, 2560×1440-equivalent)

Layer-alone GPU time, wood line, after M26's fixes: terrain ~4 ms · grass ~6 · scatter ~5 · water
~2 · sky+dinos ~4 · ≈ 22–25 ms total. The CPU side is 2.6 ms render submit + 1.4 ms update after
M24/M25 — the CPU is no longer the problem; **the GPU is fill-bound**. Six causes:

1. **Alpha-tested foliage defeats free occlusion.** Apple/mobile GPUs are tile-based deferred: opaque
   geometry gets hidden-surface removal for free (only the front fragment is shaded). Desktop GPUs get
   the same from early-Z. `discard` (alphaTest) turns both off — the shader must run to know if the
   pixel survives. The grass carpet is ~25K double-sided cutout cards many layers deep; the Quaternius
   pines, ferns, bushes and tree leaves are cutout too. Every hidden leaf pays full shading. This is
   the #1 cost and why Lambert grass (M26) barely moved the number.
2. **Every fragment evaluates every point light.** three.js has no light culling. 10 point lights in
   the scene (8 fire pool + keystone halo + beacon) → `NUM_POINT_LIGHTS 10` in every Standard shader →
   ten distance/decay/BRDF evaluations per fragment of terrain, grass, trees, including lights at
   intensity 0 two kilometres away. M20 already showed lights are fill-expensive (12 halos = 30 hitches).
3. **The sky is per-pixel Rayleigh/Mie scattering every frame**, for a sun that moves 1° a minute.
4. **Terrain**: up to 8 texture fetches near (partly fixed M26), and full PBR on far chunks that are
   most of a landscape frame.
5. **No occlusion culling**: three frustum-culls only. In a forest the cells behind the near trees are
   still submitted — vertices, draw calls and (because of 1) fill.
6. **The shadow map re-renders every frame** even when nothing that casts has moved.

## The levers, in order (with what they actually paid)

Order = expected gain ÷ effort, cheapest-to-prove first. Each is measured at 2560×1440 before and
after, committed only if it wins, reverted if not. Layer-alone attribution, not subtractive (noise).

| # | Lever | Mechanism | Expect (2×) | Risk / note |
|---|---|---|---|---|
| **A** | ~~Light culling~~ **DONE M31 — worth ~0 ms** | 10 → 3 point lights, following the nearest emitters | predicted "large, scene-wide" | **measured 0.0 ms**: the same binary at 3 and at 10 lights (`gate-perf --lights=7`) is the same frame. Point-light maths is ALU, and ALU is free on this class of GPU. Kept anyway: fires are no longer capped at 8, and the light count can never change mid-game (the recompile freeze, M20) |
| **B** | **Opaque-geometry grass**: blades as 3–5 real triangles per tuft, no alphaTest, vertex-coloured | the #1 fill cost becomes opaque geometry the GPU hidden-surface-culls for free; vertex cost trivial under instancing | grass ~6 → ~2 ms | more vertices per tuft (fine); the look changes from painted cards to low-poly blades — matches the trees |
| **C** | **Depth pre-pass for the remaining cutout foliage** (pine needles, ferns, bushes, GLB leaves): depth-only pass with the alpha test, main pass at `depthFunc = EQUAL` | only surviving fragments are shaded; overdraw shading → 1× | scatter ~5 → ~3 ms | two draws per cutout mesh (the pre-pass is cheap); needs `renderer.render` split or `onBeforeRender` |
| **D** | ~~Sky to a cubemap~~ **DONE M31 — 1.14 → 0.22 ms** | 512² cube re-baked every half degree of sun; `scene.background` reads it | predicted 3 → 0.5 ms | landed as predicted in shape, smaller in size. No visual change at dawn/noon/dusk/night |
| **E** | **Far terrain material**: beyond 200 m one pre-blended fetch, Lambert; near keeps the splat | most landscape pixels are far terrain | terrain ~4 → ~2 ms | two materials on one mesh set by LOD; the M22 far-material seam happened before — the far albedo must be the SAME texture blend, just one fetch |
| **F** | **Occlusion culling for scatter cells**: WebGL2 `ANY_SAMPLES_PASSED_CONSERVATIVE` queries on cell AABBs, results one frame late, hidden cells detached (the M24 mechanism) | skips whole hidden forest cells: calls, vertices, and after C their fill | forest views: calls −30–50%, vertices −50% | query latency → a cell pops in one frame late when you turn fast; mitigate with the frustum-margin cells always drawn |
| **G** | **Shadow map caching**: re-render only when the focus moved > 2 m or the sun > 0.5° or a caster changed | standing/looking around costs no shadow pass | 1–2 ms when static | animated dinos in the box: refresh when any awake dino inside 85 m moved |
| **H** | **KTX2/Basis** for the dino albedos + terrain tiles | bandwidth — the first constraint an integrated GPU hits | medium on Windows, small here | needs `toktx` at intake; loader is one line |
| **I** | **Pixel budget + presets** (Low/Medium/High: render scale, shadows, grass density, dino count 1500 → 800, draw distances) | the floor for weak machines, chosen by the player | whatever is left | LAST; the settings menu is also where mouse sensitivity, FOV, key rebinding live |

**Where the remaining fill actually is** (additive profile, wood line, 2560×1440, warm, frozen):
empty 0.27 · sky +0.22 · terrain +1.31 · water +0.04 · **scatter +2.87** · **grass +2.91** ·
everything else inside the noise. So B (opaque grass) and C (depth pre-pass for cutout foliage) are
still the two real fill levers — together they own 5.8 of the 6 ms — but they are now worth ~3 ms of
a 5.5 ms frame that already meets its budget. **Hitches outrank them.** E, F, G, H, I are unproven
against measurement and should each be A/B'd before any of them is built.

## The hitch levers (M31's real find — this is the list that matters now)

| | What | Measured | Status |
|---|---|---|---|
| **H1** | **The upload warden**: sweep the scene AND every registered source root every 45 frames, `initTexture` two a frame — long before anything draws them | the plain's 54-texture, 475 ms freeze → 30 textures, ~110 ms | done M31 |
| **H2** | **`compileAsync` for the species warm path**: two blocking `renderer.compile()` calls became one parallel-compile promise | a species arriving cost 200–900 ms of frozen frame | done M31 |
| **H3** | **One island-wide shadow frame at load**: a material compiles its DEPTH variant when it first enters the 85 m shadow box, so every new region paid 3–5 depth compiles | new-region compiles at load instead of at sight | done M31 |
| **H4** | **The environment map was set AFTER the warm-up compiled everything.** `scene.environment` is part of every material's program cache key, so the whole scene silently recompiled material by material as you first saw each one. Plus: every species is now warmed at load (bounded by a 4 s race), so no rig compiles on first sight | 130–180 ms per region → **0 programs on a full lap** | done M33 |
| **H5** | **The scatter visibility pass**: re-parsed group keys into strings and did three Map lookups per cell, over thousands of cells, every 3 m walked. Flattened to resolved references and plain numbers | 12–58 ms → **5–13 ms** | done M33 |
| **H6** | **A teleport rebuilds terrain synchronously (~770 ms)** — QA-only today, but the same code path runs at load | once per teleport | OPEN |
| **H7** | **~30-50 textures still upload on first sight of the plain** — reachable from neither the scene nor the registered roots, and no longer costing a visible hitch (the warden drains them) | ~16 ms | OPEN |
| **H8** | **CLOSED (M54), and it was two bugs, neither of them where I looked.** The old note is kept below because the reason it stayed open for six rounds is the lesson. Found by building the instrument the note asked for — `tools/qa-compile.mjs` patches `WebGL2RenderingContext.prototype.shaderSource`/`linkProgram` before the page loads and records every real link with its `#define SHADER_NAME`, its `SHADER_TYPE` and its defines, so "something compiled around here" becomes "THIS material, with THESE flags, in THIS frame". **(a)** A material's program cache key carries the **bound render target's colour space and tone mapping**, so every material is TWO programs — one for the canvas (sRGB + ACES) and one for the composer's linear HDR target. The warm-up drew to the canvas; the game draws through the composer. Exactly the shape of H4's environment-map bug. The warm-up compiles against both surfaces now. **(b)** `Scatter.addDistanceFade` appended the fade distance to `customProgramCacheKey` — but the distance goes in as a **uniform**, so it was compiling a separate, byte-identical program for each of the six cover distances, and three more every time the draw-distance setting moved | a lap of the island: **16 links → 3** (M54), then **→ 1** (M55). Costs **+100 ms** of warm-up at load (325 → 427 ms; time-to-`ready` unchanged at 6.2-6.4 s) | done M54/M55 |
| ~~H8 (the old note)~~ | Two depth-variant compiles at the wood line, one at the plain — owner unidentified, PARKED at ~30 ms once per region. Ruled out, each with a measurement: warming every species' rig at boot (144 → 30 ms, M36) · attaching every prop and ruin for the boot shadow frame (no change, M36) · rendering the boot shadow frame from six focus points across the island (no change, M40). A bisect reported 29 new programs for objects that had demonstrably already been drawn, which says **`renderer.info.programs.length` is not a sound proxy for "a compile happened"** — the next attempt needs a better instrument rather than another guess | — | superseded |
| **H8b** | **The last two skinned depth compiles: the rig was not in the scene when the warm-up drew the shadow frame.** `Dino.onFirstRig` attached the animal with `const obj = model.parent; if (obj.parent === null) scene.add(obj)` — but that runs inside a `compileAsync().then()`, and by the time the promise resolves `setRig` has already **detached the model from a dormant dino**, so `model.parent` is null, `obj` is null, and nothing is attached. The shadow frame drew no rig, and the depth program was left in play at ~150 ms of render in the frame an animal's shadow first appears. `attachForWarmup()` has handled exactly this case since M34; it is used here now. Named by `tools/qa-compile.mjs`'s `Object3D.onBeforeShadow` hook, which reports the object that was being drawn when the link happened | lap links **3 → 1** | done M55 |
| **H8c** | **One first-sight compile left**, and it is fully identified: a `MeshDepthMaterial` for `shadow: Mesh · Bark_NormalTree under Group` — an **instanced tree trunk** (`USE_INSTANCING USE_INSTANCING_COLOR USE_MAP`, no `USE_ALPHATEST`), first seen at the foothills. Ruled out with measurements, not guesses: the boot shadow passes DO draw 199 `Bark_NormalTree +map +instanced +icolor` casters, so it is not coverage, not the map, and not the instance colour. It differs from the boot program in at least two cache-key tokens that are not defines. **Worth ~165 ms once** when it was found, and it is the worst single frame the trek sees. **Re-measured 2026-09-12 (M91): 25 ms** — still the only hitch over 25 ms in a full lap (worst frame 28.8 ms, p50 3–5 ms), so it has shrunk by a factor of six without anyone aiming at it | 165 ms when found → **25 ms (2026-09-12)** | OPEN, much smaller |
| **H9** | **Colliders a few a frame** — crossing a chunk boundary built the whole 3×3 neighbourhood's trunks and rock hulls in one frame | 11–24 ms → gone | done M34 |
| **H10** | **The boot card**: `ready` means warm. Every species' shaders, textures, impostor card and shadow-depth variant are paid behind a title card instead of in the player's first minute | 40–150 ms × 11 → load | done M34 |

**The lap after M33** (`tools/qa-hitch.mjs`, worst frame per region, 2560×1440): spawn 12 ms · wood line 23 ·
plain 25 · river 26 · pines 23 · ravine 15 · foothills 31 · dunes 16. Zero shader compiles anywhere.
The worst frame on the island is 31 ms of scatter CPU — the next thing to budget, if anything.

## Instruments

- `tools/qa-gpu.mjs` — additive per-layer attribution at **2560×1440**, vsync off, world frozen,
  30 s warm, p10. `--720`, `--spot=`, `--lights=N` (the light-count A/B).
- `tools/gate-perf.mjs` — the budget as a gate, measured in the LIVE loop at 2560×1440 against
  `tools/perf-budget.json` (ceilings = regression guard, aspiration = the contract). `--write`
  re-baselines the ceilings after a win.
- `tools/qa-hitch.mjs` — a lap of the island reporting each region's worst frame, its section
  breakdown, and how many programs and textures it created. **The hitch instrument.**
- `tools/qa-compile.mjs` — the same lap, but it asks the DRIVER what compiled: patched
  `shaderSource`/`linkProgram`/`deleteProgram` on the WebGL prototype before the page loads, so
  every link is reported with its material name, its material type, its defines, and a diff of its
  program cache key against the nearest key already compiled. **Use this, not
  `renderer.info.programs.length`, which counts entries and not compiles (H8).**
- `tools/qa-jitter.mjs` — the same, for standing/walking/sprinting/flying/spinning.
- `tools/qa-trek.mjs` — **one continuous run across the island, no teleports.** Its walker takes a
  75° detour when progress stalls (M71): steering dead at the target and nothing else reported two
  "navigation walls" that turned out to be a pine thicket and a boulder the capsule slides off
  perfectly well. A bot that cannot walk round a tree produces map bugs that are not there. Every other instrument
  here teleports, which is right for isolating a region's first-sight cost and wrong for the only
  question a player asks: does it stutter while I am running? Reports per leg: mean and worst frame,
  frames over 25 ms, new programs and textures, what the path queries cost, and **which single
  animal's update was the most expensive** — plus where the walk got stuck, which is a map note as
  much as a perf one.
- `tools/qa-mem.mjs` — `__g.mem()`'s breakdown of the JS heap (scene geometry, the detached source
  roots, instance buffers, the baked grids) plus a reload loop, because a heap that CLIMBS across
  reloads is a different problem from one that is merely big. For the other 90% of the heap, use
  Chrome's sampling heap profiler over CDP **against `npm run dev`** — the production bundle's frame
  names are minified and the profile is unreadable.
- `tools/gates.mjs` — every gate, one verdict, `gate-perf` last. Counts checks and treats a gate that
  produced none as a failure (a crashed gate used to read exactly like a passing one).
- **F3 in the HUD** — GPU ms (p10 of ~240 frames), CPU update/draw, calls, tris, pixel count, light
  slots, dinos awake, and the GPU's own name. This is how a player on another machine reports.
- Debug hooks: `__g.setGpuProbe(on)`, `__g.gpuMs()`, `__g.setFrozen(on)`, `__g.setPaused(on)`,
  `__g.setExtraLights(n)`, `__g.uploads()`, `__g.game.lights()`.
- `CHECKLIST.md` per lever: the before/after numbers at 2×, or "reverted: no win".

## Rules that already hold (from CLAUDE.md, restated)

- Object count is the frame budget: detach, don't hide (M24).
- Point lights are a fill-rate budget; never `visible = false` a light (M20). Lever A makes this a
  hard cap of 3 + the sun.
- Anything new with a material must exist before the load-time warm-up or hook the per-species path
  (M18/M30); a first-sight compile is a 50–200 ms hitch.
- **The program cache key is bigger than the shader source.** It carries the bound render target's
  colour space and tone mapping, the light counts, the morph-target count, and whatever
  `customProgramCacheKey()` returns — so a warm-up that draws to a different surface than the game,
  or a cache-key suffix built from a value that is really a uniform, silently doubles the
  compile bill (H8, M54). Put a value in the key only if it is a literal IN the source.
- Measure GPU with timer queries at the user's pixel count; the JS render timer measures submit.

## Post-processing (M42) — the headroom, spent

The budget was met, so the rule that said "not until it is" was satisfied and the look got its pass:
a **grade** (split-tone warm shadows / cool highlights, saturation, vignette, all riding the day's
curve), **FXAA**, **atmosphere** (height fog reconstructed from the depth the scene already wrote —
thick in the hollows, thinning with altitude, brightening toward the sun) and **bloom** on a
threshold of 2.4 in LINEAR HDR so only fire, the beacon and the sun's disc bleed. Price list at 2560×1440 (`tools/qa-post.mjs`):

| | wood line | spawn |
|---|---|---|
| no post | 5.83 ms | 3.39 ms |
| basic (grade + FXAA) | **5.83** | **3.39** |
| full (+ bloom) | **6.95** | **4.41** |

Basic is free because the composer's target drops the renderer's 4× MSAA and FXAA costs less than
the resolve did. Full costs 1.1 ms. Both are in `settings.ts` (Effects: Off / Basic / Full).

**Ambient occlusion is opt-in (M44), and here is why it is not the default.** GTAO looked right — real contact under rocks and
canopy, 40% of pixels moved — and cost **5 ms at half resolution and still 7-10 at quarter**, because
its price is not the AO maths but the SECOND SCENE RENDER it does for normals: 350 draw calls and
3 Mtri again, which no resolution change touches. Against a 12 ms contract that is the whole budget
for an effect you have to look for — so it lives in the settings, off by default, with the cost on
the label (measured again at half res / 10 samples: **+2.3 ms** at the wood line). The cheap version,
if anyone builds it, reads the depth buffer the main pass already wrote (a custom 8-tap pass) and
never renders geometry twice — which is exactly what the M43 atmosphere pass does.

## Precompute, don't recompute (the pattern, M45/M47)

Two things this project used to do per frame are now baked and read:

- **The environment map**: eight PMREM skies baked at load, the two either side of now blended as a
  plain 2D mix (a PMREM is a packed 2D texture — nothing needs re-filtering). Was 20-40 ms a re-bake
  and a visible jump; is one quad.
- **Sky view (ambient occlusion of the LANDSCAPE)**: sixteen horizon rays per cell of a 1024² grid,
  in the bake tool, written to `world/skyview.bin` and folded into vertex colours and instance tints
  as the world is built. Zero runtime cost. Its reach is honest: 74.5% of the island sees full sky,
  4% is below 0.8 — the caldera, the ravine and cliff feet, which are exactly the places that should
  feel enclosed.

The test for anything else: does it change slowly, and does it cost a lot to compute? Then compute a
few states offline or at load and interpolate — never per frame.

## Memory (M57) — the budget nothing was counting

`renderer.info` covers the GPU. The JS side had one number, `performance.memory`, and no breakdown.
`__g.mem()` and `tools/qa-mem.mjs` give one now, and **F3 shows used / limit** so a player reporting a
stuttery machine can say whether the tab is near its ceiling.

**The island costs ~880 MB of JS heap after load** (Chrome's 4.4 GB tab limit), and only **80 MB** of
that is anything the scene graph can see: scene geometry 20 · instance buffers 28 · the detached
source GLBs the upload warden keeps 14.5 · the baked grids 17.8 (height 8.4, biomes 4.2, forest 4.2,
sky view 1.0). Reloading settles at ~1.8 GB and stays there — big, not leaking.

Chrome's **sampling heap profiler** against the dev build (unminified, so the frames have names)
found the other 800 MB, and it is almost all the animals:

| | Live at sample | What |
|---|---|---|
| `Object3D.copy` → `Bone` | **~180 MB** | `SkeletonUtils.clone` — one skeleton per animal, and the island holds **1515** of them |
| `dinos.ts load` → `clipAction` → `_bindAction` / `AnimationAction` / interpolants / `parseTrackName` | **~156 MB** | one `AnimationMixer`, up to five bound actions and their interpolants, per animal — **taken in M60** |
| `cloneUniforms` in `getProgram` | ~40 MB | a uniform set per material instance |
| `scatter.place` | ~32 MB | the node table |

**M58 took 180 MB of it back, from the props rather than the animals.** There is one `InstancedProp`
per `kind#variant#cell` and there are hundreds of cells — and each one rebuilt the prop's geometry
from its source root (normalise to 1 m, re-pivot onto the base, drop to ground, recolour, cutout,
merge the untextured submeshes) and CLONED ITS MATERIALS. None of that depends on the cell. Built
once per prototype and shared now, because an InstancedMesh never writes to its geometry or its
material, only to its instance buffers:

| | before | after |
|---|---|---|
| GPU geometries | 3749 | **333** |
| JS heap after load | 882 MB | **~700 MB** |
| time to `ready` | 6.2-6.4 s | **4.8-5.0 s** (with M57's calibration cache) |
| **CPU frame, wood line** | 7.9 ms p50 | **4.7 ms p50** (213 fps) |
| CPU frame, plain | 7.9 ms p50 | **4.9 ms p50** |
| a 5 km walk (`qa-trek`) | 33 frames over 25 ms, mean 6.0-11.7 ms | **27 over 25 ms, mean 5.3-8.8 ms** |

The GPU is unchanged either side of it (4.88 ms at the plain, 7.31 at the wood line) — this was
always CPU: three sorts and switches state per material and binds vertex attributes per geometry,
and there were 3749 of the latter for twenty distinct shapes. **`gate-perf` now has a `wallP50`
ceiling** for exactly this reason: nothing in the gate would have noticed the CPU frame being given
back, because it only ever measured the GPU.

**M60 took the mixers (−178 MB).** A mixer with its bound actions is built shortly BEFORE an animal
wakes now — from a two-a-frame budget in the ring outside the wake radius, the same shape as the
upload warden and the collider builder — instead of when its rig is cloned. Measured: **333 of 1515
animals ever build one**, and `gate-ecology` asserts the invariant that makes it safe (nothing
drawable may be without a mixer, or it stands in its bind pose). Heap after load **704 → 526 MB**.

**M61 took the skeletons too (−200 MB), and it did not need a pool.** The note here said a rig pool
was the answer and that it was a real refactor. It was the wrong shape: nothing has to be RECYCLED,
because a clone that is never made costs nothing. A rig is only ever drawn inside 135 m (a cross-card
to 260 m, nothing past that), so an animal asks for its clone when it comes within **380 m** — 120 m
outside the draw distance, which at a sprint is fifteen seconds of warning for a queue that drains
four a frame. **One eager clone per species** still happens at load, because the warm-up needs a rig
of each to compile its shaders, calibrate its scale and capture its impostor card.

| | before M57 | now |
|---|---|---|
| JS heap, standing at spawn | 882 MB | **324 MB** |
| after visiting four regions | 882 MB | 459 MB |
| skeletons built | 1515 | **40 at spawn, 167 after a lap** |
| time to `ready` | 6.2-6.4 s | 5.0 s |
| a 5 km walk | 33 frames over 25 ms | **14** |

`gate-ecology` holds the two invariants that make it safe: **nothing inside the draw distance may be
without a rig** (a hole in the world) and **nothing drawable may be without a mixer** (a bind pose).
Both are asserted at the beach, the wood line and the plain.

**Done in M57, because it was free:** the rig's scale and foot-lift are properties of the GLB, not of
the individual, so they are measured once per species instead of once per animal — two
`skinnedBounds` walks of up to 2500 vertices each, times ~200 clones, removed. Time to `ready`
**6.2-6.4 s → 5.9 s**. (The cull spheres had been cached this way since M18; this is the other half.)

### Where the memory line ended (re-profiled after M58–M63)

The same sampling profile, run again on the finished work. Every one of the original top rows has
collapsed, and the ranking is now something else entirely:

| | M57 | now |
|---|---|---|
| `Bone` (skeleton clones) | ~180 MB | **3.8 MB** |
| `AnimationMixer` bindings | ~156 MB | **1.2 MB** |
| `cloneUniforms` | ~40 MB | **2.1 MB** |
| **`scatter.place` — the node table** | ~32 MB | **32 MB** (untouched, now the largest) |
| JS heap after load | 882 MB | **~325-350 MB** |

**The node table is the next lever and it is deliberately not taken.** Tens of thousands of scatter
nodes as JS objects (`{x, y, z, scale, rotY, tint, …}`); parallel typed arrays would take most of
the 32 MB and speed the visibility pass. But every consumer — raycast, harvest, damage, colliders,
save/restore — indexes `this.nodes[…]`, so it is a broad refactor for 30 MB against a heap that is
already down 60%. Bad trade today; written down for when it is not.

## The terrain LOD cache (M62) — and two wrong answers before the right one

Every `(chunk, LOD)` geometry was cached for the life of the session. A LOD0 chunk is 4225 vertices
of position, normal, colour and splat — about a quarter of a megabyte — and the island is **1024
chunks**, so touring all of it accumulated a quarter of a gigabyte of terrain nobody can see any
more. Measured: one lap took the geometry count **332 → 1059** and the heap **322 → 579 MB**.

Fine LODs (0 and 1 only — LOD2 and LOD3 together are under 400 vertices and are what the far half of
the island is drawn from) are freed after **120 s unused**.

**The two failures are the useful part of this entry.**

1. **Evicting by DISTANCE was a disaster.** Chunks cross a radius constantly as you walk, so the
   builder spent the whole trek rebuilding and re-uploading geometry it had just thrown away: a 5 km
   walk went from 14 frames over 25 ms to **468**. Distance is the wrong axis; **time** is the right
   one, because "I have not drawn this for two minutes" means you have genuinely left.
2. **A 60 s TTL over all four levels still thrashed** — 614 of 1524 evictions were **rebuilt**, 40%.
   The frame-time evidence for this was useless (the machine was running a Next build and two other
   things; load average 15–23, and the trek swung 8× between identical runs). So the metric to tune
   against became a **counter, not a clock**: `terrainEvicted().rebuilt` — a build of a (chunk, LOD)
   that had been evicted before is the *only* way this scheme can cost anything, and it does not
   care what else the machine is doing. At 120 s and levels 0–1 it is **9 rebuilds against 333
   evictions on a 5 km walk**, and **5 against 295** in the gate.

Result: **56.5 MB handed back on a walk, 62-90 MB on a full tour**, geometry count plateaus instead
of climbing. `gate-m8` asserts the cache frees a real share of the live count, is not still growing
while you stand still, and is not thrashing the builder.

## Waterfalls (M72)

A fall is two meshes and six sprites, and it is **detached from the scene beyond 620 m** (M24's
rule) — so from spawn, 3.5 km away, it costs nothing at all. What that would have cost instead is
a compile: a detached material compiles the first frame it is drawn, so walking up to the cliff
would have hitched at exactly the place the feature is about. `Waterfalls.attachForWarmup()` puts
every fall in the scene for the boot compile pass, the same way one rig of each dino species is
attached for it, and `for (const undo of detach) undo()` takes them back out.

The sheet's fragment shader adds a self-lit term. That is not laziness about lighting: the
Wellspring bluff faces north-east and is in shadow at noon, and a `MeshStandardMaterial` sheet on
it rendered charcoal grey on charcoal grey. Broken water is a cloud of scattering droplets and
stays bright in shade — which is why you can see a waterfall from a mile away — so the term is the
physically honest one, not a fudge.

## The interiors (M73)

Two changes that cost nothing and one that pays. The pine floor is a second colour pair in
`terrain-paint.ts` chosen by `forestKindAt` — one byte-grid tap per vertex, on a path that already
does four of them, and `terrain-worker.ts` calls `loadHeightmap` so it has `forest.bin` too: no
seam between main-thread and worker-built chunks. The marsh's `humid` blend is one `biomeAt` tap
per frame, on the line that already does the water query.

The one that pays: grass under pines drops from 45% of candidates to 14%, and the swamp's fog far
goes 1500 m → 300 m, which is a real cut in what the camera's far plane admits there (the far
plane tracks fog far × 1.08).

## The map (M76)

The island raster is 2048x2048 = 16 MB of canvas, built ONCE and then only blitted. Building it
costs ~17 M `heightAt` calls (four per pixel for the hillshade), so it is painted **96 rows a
frame** — about twenty frames — rather than in one pass that would hitch at exactly the moment the
player is looking at the HUD. After that the minimap is one `drawImage` of a sub-rect plus a
handful of dots, and the full sheet is one `drawImage` plus the pins.

The creative overlay walks `scatter.nodes` (tens of thousands) once a frame while the minimap is
up, filtered by a bounding-box test before anything else. It draws only rock/boulder/outcrop/bush:
pebbles and sticks carpet the island and cost the most to draw for the least meaning.

## Not doing

- N8AO / anything that renders the scene a second time — see the GTAO measurement above.
- Tessellation/displacement: user said not yet.
- WebGPU: three's WebGPU renderer would give real compute-driven culling and light clustering, but
  it's a port of every custom shader in the project. Note it as the long-term path; not this year.

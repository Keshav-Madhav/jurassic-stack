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
| **H4** | **~36 textures still upload on first sight of a region** — they are reachable from neither the scene nor the registered roots. Find their owner (suspicion: per-species impostor render targets and the rigs' `MeshPhysicalMaterial` 2048² map/normal/ao/metalness/specularColor sets) | plain still spends ~90 ms once | OPEN |
| **H5** | **Scatter cell attach costs 12–58 ms** in the frame you walk into a new area — the largest remaining CPU hitch | every region, repeatedly | OPEN |
| **H6** | **A teleport rebuilds terrain synchronously (~770 ms)** — QA-only today, but the same code path runs at load | once per teleport | OPEN |

## Instruments

- `tools/qa-gpu.mjs` — additive per-layer attribution at **2560×1440**, vsync off, world frozen,
  30 s warm, p10. `--720`, `--spot=`, `--lights=N` (the light-count A/B).
- `tools/gate-perf.mjs` — the budget as a gate, measured in the LIVE loop at 2560×1440 against
  `tools/perf-budget.json` (ceilings = regression guard, aspiration = the contract). `--write`
  re-baselines the ceilings after a win.
- `tools/qa-hitch.mjs` — a lap of the island reporting each region's worst frame, its section
  breakdown, and how many programs and textures it created. **The hitch instrument.**
- `tools/qa-jitter.mjs` — the same, for standing/walking/sprinting/flying/spinning.
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
- Measure GPU with timer queries at the user's pixel count; the JS render timer measures submit.

## Not doing

- Post-processing / N8AO: full-screen passes on a fill-bound frame. Revisit only after the budget is
  met with headroom.
- Tessellation/displacement: user said not yet.
- WebGPU: three's WebGPU renderer would give real compute-driven culling and light clustering, but
  it's a port of every custom shader in the project. Note it as the long-term path; not this year.

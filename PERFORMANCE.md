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
in the ledger before M26 was at that size. The 2× GPU profile in M26 (~25 ms) was the first honest
number, and it IS the user's 30–40 fps.

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

## The levers, in order

Order = expected gain ÷ effort, cheapest-to-prove first. Each is measured at 2560×1440 before and
after, committed only if it wins, reverted if not. Layer-alone attribution, not subtractive (noise).

| # | Lever | Mechanism | Expect (2×) | Risk / note |
|---|---|---|---|---|
| **A** | **Light culling: 3 point lights, repositioned every frame to the 3 nearest lit fires/halo** | constant light count (no shader recompiles); 10 → 3 evaluations per fragment scene-wide | large, scene-wide; 15 min to test | fires beyond the 3 nearest go unlit while far — invisible past ~40 m anyway |
| **B** | **Opaque-geometry grass**: blades as 3–5 real triangles per tuft, no alphaTest, vertex-coloured | the #1 fill cost becomes opaque geometry the GPU hidden-surface-culls for free; vertex cost trivial under instancing | grass ~6 → ~2 ms | more vertices per tuft (fine); the look changes from painted cards to low-poly blades — matches the trees |
| **C** | **Depth pre-pass for the remaining cutout foliage** (pine needles, ferns, bushes, GLB leaves): depth-only pass with the alpha test, main pass at `depthFunc = EQUAL` | only surviving fragments are shaded; overdraw shading → 1× | scatter ~5 → ~3 ms | two draws per cutout mesh (the pre-pass is cheap); needs `renderer.render` split or `onBeforeRender` |
| **D** | **Sky to a cubemap**: render the Sky shader into a 256² cube every ~2° of sun, set as `scene.background` | per-pixel scattering → one cubemap lookup | sky ~3 → ~0.5 ms | the env map (M19) already works this way; same code path |
| **E** | **Far terrain material**: beyond 200 m one pre-blended fetch, Lambert; near keeps the splat | most landscape pixels are far terrain | terrain ~4 → ~2 ms | two materials on one mesh set by LOD; the M22 far-material seam happened before — the far albedo must be the SAME texture blend, just one fetch |
| **F** | **Occlusion culling for scatter cells**: WebGL2 `ANY_SAMPLES_PASSED_CONSERVATIVE` queries on cell AABBs, results one frame late, hidden cells detached (the M24 mechanism) | skips whole hidden forest cells: calls, vertices, and after C their fill | forest views: calls −30–50%, vertices −50% | query latency → a cell pops in one frame late when you turn fast; mitigate with the frustum-margin cells always drawn |
| **G** | **Shadow map caching**: re-render only when the focus moved > 2 m or the sun > 0.5° or a caster changed | standing/looking around costs no shadow pass | 1–2 ms when static | animated dinos in the box: refresh when any awake dino inside 85 m moved |
| **H** | **KTX2/Basis** for the dino albedos + terrain tiles | bandwidth — the first constraint an integrated GPU hits | medium on Windows, small here | needs `toktx` at intake; loader is one line |
| **I** | **Pixel budget + presets** (Low/Medium/High: render scale, shadows, grass density, dino count 1500 → 800, draw distances) | the floor for weak machines, chosen by the player | whatever is left | LAST; the settings menu is also where mouse sensitivity, FOV, key rebinding live |

Expected after A + B + D + E: 2× GPU frame ~25 → ~10–12 ms — 60 fps on the M5 Pro at full window,
30+ on the reference laptop at 1080p, at native resolution. C, F, G are the second tranche; H, I the
tail.

## Instruments (build these first)

- `tools/qa-gpu.mjs` runs at **2560×1440 by default** (flag for 1280×720); prints layer-alone ms.
- **F3 in the HUD**: GPU ms (timer query, 1 s median), CPU render/update ms, calls, tris, pixel
  ratio, the three biggest layers. Screenshot-able. This is how the friends' machines report.
- `tools/gate-perf.mjs`: the budget as a gate (≤ 12 / ≤ 8 ms at the proxy). Runs in the standard
  round with the other seven.
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

// THE ISLAND DOES NOT MOVE (M66, user-reported: "lack of animations in
// places"). Water has had swell, flow and foam since M12; everything else —
// every blade of the grass carpet, every fern, bush, reed and canopy — was
// nailed rigid. A frozen forest is the single loudest "this is a render, not a
// place" signal a game can give, and it costs almost nothing to fix.
//
// One vertex-shader patch, shared by the grass field and the scatter's cover
// kinds. The bend is driven by WORLD position, not instance index, so
// neighbours move together in gusts rather than each blade doing its own
// thing — that coherence is what reads as wind instead of jitter. Strength
// scales with height up the blade (`vBendUp`), so the base stays planted.
import * as THREE from 'three'

/** the one clock every wind-bent material shares (main.ts advances it) */
export const windTime = { value: 0 }
/** a shared multiplier on every material's sway — 0 switches the wind off with
 *  no recompile, which is how it gets A/B'd against itself (QA) */
export const windScale = { value: 1 }

export function advanceWind(dt: number): void {
  windTime.value += dt
}

/**
 * Patch `mat` to bend with the wind. Chained after any existing
 * onBeforeCompile, exactly as Scatter.addDistanceFade is.
 *
 * `amount` is metres of sway at the tip. NB it must NOT go in the cache key —
 * it is a uniform, and putting a uniform's value in the key is what compiled
 * one byte-identical program per cover distance until M54 caught it.
 */
export function addWind(mat: THREE.Material, amount: number, instanced: boolean): void {
  const m = mat as THREE.MeshStandardMaterial
  const prev = m.onBeforeCompile
  m.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer)
    shader.uniforms.uWindTime = windTime
    shader.uniforms.uWindAmt = { value: amount }
    shader.uniforms.uWindScale = windScale
    // the instance's own world origin: without it every blade in a tile bends
    // by the same phase and the field pulses like a heartbeat
    const origin = instanced
      ? 'vec3 wOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;'
      : 'vec3 wOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;'
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;\nuniform float uWindAmt;\nuniform float uWindScale;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          ${origin}
          // two travelling waves at an angle to each other: one long gust
          // rolling across the island, one short flutter on top
          float gust = sin(wOrigin.x * 0.035 + wOrigin.z * 0.021 + uWindTime * 0.9);
          float flutter = sin(wOrigin.x * 0.31 - wOrigin.z * 0.24 + uWindTime * 2.7);
          float bend = (gust * 0.7 + flutter * 0.3) * uWindAmt * uWindScale;
          // only the top of the thing moves — the root is in the ground
          float up = max(transformed.y, 0.0);
          transformed.x += bend * up;
          transformed.z += bend * up * 0.45;
        }`)
  }
  const prevKey = m.customProgramCacheKey.bind(m)
  m.customProgramCacheKey = () => prevKey() + '|wind'
  m.needsUpdate = true
}

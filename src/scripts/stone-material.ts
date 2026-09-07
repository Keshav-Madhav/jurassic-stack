// World-space triplanar stone: a texture on a flat-shaded grey under the
// island's 2.9 sun goes to white with ACES — every untextured rock, column
// and plinth read as plaster (M22 rocks, M27 ruins). This patches any
// MeshStandardMaterial to sample the terrain's rock albedo by world position
// and normal, so form survives the light. Instanced meshes need the
// instanceMatrix in the world transform; pass `instanced`.
import * as THREE from 'three'

let rockTex: THREE.Texture | null = null
const pending: (() => void)[] = []

/** load the shared rock albedo once (awaits are cheap; materials patched before it lands get it via the uniform) */
export async function loadStoneTexture(): Promise<THREE.Texture> {
  if (rockTex) return rockTex
  const t = await new THREE.TextureLoader().loadAsync('textures/rock.jpg')
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  rockTex = t
  for (const f of pending) f()
  pending.length = 0
  return t
}

export function stoneTexture(): THREE.Texture | null {
  return rockTex
}

/**
 * Patch `mat` to triplanar-sample the rock albedo. `metresPerTile` sets the
 * texture scale; `gain` recentres the albedo (the rock.jpg averages ~0.45).
 */
export function makeStone(mat: THREE.MeshStandardMaterial, opts: { instanced?: boolean; metresPerTile?: number; gain?: number } = {}): void {
  const scale = 1 / (opts.metresPerTile ?? 1.8)
  const gain = opts.gain ?? 2.1
  const inst = opts.instanced ? ' * instanceMatrix' : ''
  mat.map = null
  const uniforms: { uRock: { value: THREE.Texture | null } } = { uRock: { value: rockTex } }
  if (!rockTex) pending.push(() => { uniforms.uRock.value = rockTex })
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer)
    shader.uniforms.uRock = uniforms.uRock
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStonePos; varying vec3 vStoneNor;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvStonePos = (modelMatrix${inst} * vec4(transformed, 1.0)).xyz; vStoneNor = normalize(mat3(modelMatrix${inst}) * objectNormal);`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uRock; varying vec3 vStonePos; varying vec3 vStoneNor;')
      .replace('#include <map_fragment>', `{
        vec3 w = abs(vStoneNor); w = w / (w.x + w.y + w.z + 1e-4);
        float s = ${scale.toFixed(4)};
        vec3 t = texture2D(uRock, vStonePos.yz * s).rgb * w.x + texture2D(uRock, vStonePos.xz * s).rgb * w.y + texture2D(uRock, vStonePos.xy * s).rgb * w.z;
        diffuseColor.rgb *= t * ${gain.toFixed(2)};
      }`)
  }
  const prevKey = mat.customProgramCacheKey.bind(mat)
  mat.customProgramCacheKey = () => prevKey() + `|stone${opts.instanced ? 'I' : ''}${scale.toFixed(3)}${gain}`
  mat.needsUpdate = true
}

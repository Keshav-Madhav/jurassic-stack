// Chunked terrain renderer: fixed 16×16 grid of 128 m chunks, four LOD levels
// (64/32/16/8 quads per side) picked by camera distance, with skirts on every
// chunk edge so neighboring chunks at different LODs never show cracks.
//
// Geometries are built lazily per (chunk, LOD) and cached. All sampling goes
// through heightmap.ts. LOD0 vertex data doubles as the physics collider mesh
// (physics.ts asks for it via chunkGridData).
import * as THREE from 'three'
import { heightAt, normalAt, forestMaskAt, biomeAt, BIOME, worldMeta, HALF_SIZE, SEA_LEVEL } from './heightmap'

export const CHUNK_SIZE = 128
export const CHUNKS_PER_SIDE = (HALF_SIZE * 2) / CHUNK_SIZE // 16
const LOD_QUADS = [64, 32, 16, 8]
/** Camera distance (m) beyond which each LOD level kicks in. */
const LOD_DISTANCE = [0, 260, 520, 1000]
/** Skirt depth grows with LOD coarseness — 4m skirts couldn't cover mesa
 *  walls where a coarse chunk borders a fine one (backlog #8: LOD holes). */
const skirtDepthFor = (quads: number) => 5 + (64 / quads) * 3 // LOD0 8m … LOD3 29m

interface Chunk {
  cx: number
  cz: number
  originX: number
  originZ: number
  centerX: number
  centerZ: number
  mesh: THREE.Mesh
  lod: number
  cache: (THREE.BufferGeometry | null)[]
}

export class Terrain {
  readonly group = new THREE.Group()
  private chunks: Chunk[] = []
  private material: THREE.MeshStandardMaterial

  constructor() {
    // Splat-textured ground: four CC0 tiling albedos (grass/dirt/rock/sand)
    // blended by a per-vertex weight attribute, tinted by the vertex color
    // (which carries the biome/variation palette). World-space UVs, two
    // scales per sample to break tiling.
    const texLoader = new THREE.TextureLoader()
    const tile = (url: string): THREE.Texture => {
      const t = texLoader.load(url)
      t.wrapS = THREE.RepeatWrapping
      t.wrapT = THREE.RepeatWrapping
      t.colorSpace = THREE.SRGBColorSpace
      return t
    }
    const texGrass = tile('textures/grass.jpg')
    const texDirt = tile('textures/dirt.jpg')
    const texRock = tile('textures/rock.jpg')
    const texSand = tile('textures/sand.jpg')

    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    })
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uGrass = { value: texGrass }
      shader.uniforms.uDirt = { value: texDirt }
      shader.uniforms.uRock = { value: texRock }
      shader.uniforms.uSand = { value: texSand }
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWorldPos;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvSplat = splat;\nvWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;',
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uGrass; uniform sampler2D uDirt; uniform sampler2D uRock; uniform sampler2D uSand;
          varying vec4 vSplat; varying vec3 vWorldPos;
          vec3 tiled(sampler2D t, vec2 uv) {
            // two scales, hash-blended: breaks visible tiling at distance
            vec3 a = texture2D(t, uv * 0.14).rgb;
            vec3 b = texture2D(t, uv * 0.031).rgb;
            return mix(a, b, 0.42);
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `{
            vec2 uv = vWorldPos.xz;
            vec4 w = vSplat;
            float sum = max(w.r + w.g + w.b + w.a, 1e-4);
            w /= sum;
            vec3 tex = tiled(uGrass, uv) * w.r + tiled(uDirt, uv) * w.g + tiled(uRock, uv) * w.b + tiled(uSand, uv) * w.a;
            // vertex color carries the palette; texture supplies detail.
            // 2.2 ≈ recenter the albedo around 1 so the palette's value holds.
            diffuseColor.rgb = vec3(vColor) * tex * 2.2;
          }`,
        )
    }
    for (let cz = 0; cz < CHUNKS_PER_SIDE; cz++) {
      for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
        const originX = -HALF_SIZE + cx * CHUNK_SIZE
        const originZ = -HALF_SIZE + cz * CHUNK_SIZE
        const mesh = new THREE.Mesh(undefined, this.material)
        mesh.frustumCulled = true
        mesh.receiveShadow = true
        const chunk: Chunk = {
          cx, cz, originX, originZ,
          centerX: originX + CHUNK_SIZE / 2,
          centerZ: originZ + CHUNK_SIZE / 2,
          mesh, lod: -1,
          cache: [null, null, null, null],
        }
        this.chunks.push(chunk)
        this.group.add(mesh)
      }
    }
  }

  /** Re-pick LODs around a focus point; swaps geometry only when a level changes. */
  update(focusX: number, focusZ: number): void {
    for (const c of this.chunks) {
      const dx = c.centerX - focusX
      const dz = c.centerZ - focusZ
      const d = Math.sqrt(dx * dx + dz * dz)
      let lod = LOD_DISTANCE.length - 1
      for (let i = 0; i < LOD_DISTANCE.length; i++) {
        if (d >= LOD_DISTANCE[i]) lod = i
      }
      if (lod !== c.lod) {
        c.lod = lod
        const geo = (c.cache[lod] ??= buildChunkGeometry(c.originX, c.originZ, LOD_QUADS[lod]))
        c.mesh.geometry = geo
      }
    }
  }
}

/**
 * LOD0-resolution position/index data for one chunk, for the physics trimesh.
 * Plain arrays (no skirt — colliders don't need it, and the skirt's vertical
 * walls would snag the character controller).
 */
export function chunkGridData(cx: number, cz: number): { vertices: Float32Array; indices: Uint32Array } {
  const quads = LOD_QUADS[0]
  const originX = -HALF_SIZE + cx * CHUNK_SIZE
  const originZ = -HALF_SIZE + cz * CHUNK_SIZE
  const step = CHUNK_SIZE / quads
  const side = quads + 1
  const vertices = new Float32Array(side * side * 3)
  for (let iz = 0; iz < side; iz++) {
    for (let ix = 0; ix < side; ix++) {
      const x = originX + ix * step
      const z = originZ + iz * step
      const o = (iz * side + ix) * 3
      vertices[o] = x
      vertices[o + 1] = heightAt(x, z)
      vertices[o + 2] = z
    }
  }
  const indices = new Uint32Array(quads * quads * 6)
  let w = 0
  for (let iz = 0; iz < quads; iz++) {
    for (let ix = 0; ix < quads; ix++) {
      const a = iz * side + ix
      const b = a + 1
      const c = a + side
      const d = c + 1
      indices[w++] = a; indices[w++] = c; indices[w++] = b
      indices[w++] = b; indices[w++] = c; indices[w++] = d
    }
  }
  return { vertices, indices }
}

// ---------- ground palette (the "splat map" until M6's real shader) ----------
const C_DEEP = new THREE.Color(0x24312a) // underwater
const C_SAND = new THREE.Color(0xa08753)
const C_GRASS_LUSH = new THREE.Color(0x1f3d18) // dark rich green
const C_GRASS_LIGHT = new THREE.Color(0x35571f)
const C_GRASS_DRY = new THREE.Color(0x555a28) // olive dry patches
const C_ROCK = new THREE.Color(0x5e5c58) // weathered gray
const C_ROCK_STEEP = new THREE.Color(0x44423f)
const C_FLOOR = new THREE.Color(0x3a2e1f) // forest floor: dirt + leaf litter
const C_FLOOR_LIT = new THREE.Color(0x51402a)
const C_MUD = new THREE.Color(0x453827) // wet banks
const C_SHORE_SAND = new THREE.Color(0x8f7a52)
const C_SWAMP = new THREE.Color(0x2e3320) // murky marsh ground
const C_SWAMP_WET = new THREE.Color(0x252b1e)
const C_DESERT = new THREE.Color(0x9a8054) // dry flats
const C_DESERT_DARK = new THREE.Color(0x7a6543)
const C_PLAINS = new THREE.Color(0x4a6a28) // open grassland, lighter

/** Distance to the nearest river centerline or lake ring (for wet banks). */
function waterEdgeDist(x: number, z: number): number {
  const meta = worldMeta
  if (!meta) return Infinity
  let best = Infinity
  for (const path of meta.rivers) {
    for (let i = 0; i < path.length - 1; i++) {
      const ax = path[i].x
      const az = path[i].z
      const dx = path[i + 1].x - ax
      const dz = path[i + 1].z - az
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)) - 12)
    }
  }
  for (const lake of meta.lakes) {
    best = Math.min(best, Math.abs(Math.hypot(x - lake.x, z - lake.z) - lake.r * 0.95))
  }
  return best
}
const C_BASALT = new THREE.Color(0x453d36) // volcano flanks
const C_CINDER = new THREE.Color(0x332c27) // summit

const _c = new THREE.Color()
const _c2 = new THREE.Color()

/** Splat weights (grass, dirt, rock, sand) matching groundColorAt's zones. */
function splatAt(x: number, z: number, h: number, ny: number, out: THREE.Vector4): THREE.Vector4 {
  let grass = 0
  let dirt = 0
  let rock = 0
  let sand = 0
  const biome = biomeAt(x, z)
  if (biome === BIOME.SWAMP) return out.set(0.15, 0.85, 0, 0)
  if (biome === BIOME.DESERT) {
    const rocky = ny < 0.82 ? Math.min(1, (0.82 - ny) / 0.2) : 0
    return out.set(0, 0.1, rocky, 0.9 - rocky)
  }
  if (h < 2.4) {
    sand = 1
  } else {
    grass = 1
    if (h < 3.6) {
      sand = ((3.6 - h) / 1.2) * 0.6
      grass = 1 - sand
    }
    const forest = forestMaskAt(x, z)
    if (forest > 0.05) {
      dirt = Math.min(1, ((forest - 0.05) / 0.25)) * 0.85
      grass *= 1 - dirt
    }
    const wd = waterEdgeDist(x, z)
    if (wd < 14) {
      const t = Math.min(1, Math.max(0, 1 - wd / 14)) * 0.8
      const sandy = Math.min(1, Math.max(0, 1 - wd / 5)) * 0.6
      dirt = dirt * (1 - t) + t * (1 - sandy)
      sand = sand * (1 - t) + t * sandy
      grass *= 1 - t
    }
    if (h > 55) {
      const t = Math.min(1, (h - 55) / 55)
      rock += t
      grass *= 1 - t
      dirt *= 1 - t
    }
  }
  if (ny < 0.82) {
    const t = Math.min(1, (0.82 - ny) / 0.2)
    rock = rock * (1 - t) + t
    grass *= 1 - t
    dirt *= 1 - t
    sand *= 1 - t
  }
  return out.set(grass, dirt, rock, sand)
}

function varTFor(x: number, z: number): number {
  const n1 = Math.sin(x * 0.021 + Math.sin(z * 0.017) * 2.1) * Math.cos(z * 0.019 - Math.sin(x * 0.023))
  const n2 = Math.sin(x * 0.11 + z * 0.09) * Math.cos(x * 0.07 - z * 0.13)
  return n1 * 0.5 + n2 * 0.28
}

/** Ground color by height/slope + two-frequency variation noise. */
function groundColorAt(x: number, z: number, h: number, ny: number, out: THREE.Color): THREE.Color {
  // cheap deterministic variation (hash-free trig noise is fine for color)
  const n1 = Math.sin(x * 0.021 + Math.sin(z * 0.017) * 2.1) * Math.cos(z * 0.019 - Math.sin(x * 0.023))
  const n2 = Math.sin(x * 0.11 + z * 0.09) * Math.cos(x * 0.07 - z * 0.13)
  const varT = n1 * 0.5 + n2 * 0.28 // ~[-0.78, 0.78]

  // biome overrides first
  const biome = biomeAt(x, z)
  if (biome === BIOME.SWAMP) {
    const wet = worldMeta?.swamp && h < worldMeta.swamp.level + 0.4
    out.copy(wet ? C_SWAMP_WET : C_SWAMP).offsetHSL(0, 0, varTFor(x, z) * 0.03)
    return out
  }
  if (biome === BIOME.DESERT) {
    out.copy(C_DESERT).lerp(C_DESERT_DARK, THREE.MathUtils.clamp(0.5 + varTFor(x, z) * 0.9, 0, 1))
    if (ny < 0.82) out.lerp(C_ROCK, THREE.MathUtils.clamp((0.82 - ny) / 0.2, 0, 1))
    return out
  }
  // under a lake's fill level → bed color, never lawn
  for (const lake of worldMeta?.lakes ?? []) {
    if (Math.hypot(x - lake.x, z - lake.z) < lake.r * 1.05 && h < lake.level - 0.2) {
      return out.copy(C_DEEP).lerp(C_MUD, THREE.MathUtils.clamp((h - (lake.level - 5)) / 5, 0, 1) * 0.6)
    }
  }
  if (h < SEA_LEVEL - 0.4) {
    out.copy(C_DEEP).lerp(C_SAND, THREE.MathUtils.clamp((h + 8) / 8, 0, 1) * 0.5)
  } else if (h < 2.4) {
    out.copy(C_SAND).offsetHSL(0, 0, varT * 0.03)
  } else {
    // grass field: lush ↔ light by variation, dry olive patches where n1 peaks
    out.copy(C_GRASS_LUSH).lerp(C_GRASS_LIGHT, THREE.MathUtils.clamp(0.5 + varT * 0.9, 0, 1))
    if (biome === BIOME.PLAINS) out.lerp(C_PLAINS, 0.55)
    if (n1 > 0.22) out.lerp(C_GRASS_DRY, THREE.MathUtils.clamp((n1 - 0.22) * 2.0, 0, 0.9))
    // under the woods the ground is dirt and leaf litter, not lawn (the ARK
    // reference: forest floors are brown, greens live in the understory)
    const forest = forestMaskAt(x, z)
    if (forest > 0.05) {
      const t = THREE.MathUtils.clamp((forest - 0.05) / 0.25, 0, 1) * 0.85
      out.lerp(_c.copy(C_FLOOR).lerp(C_FLOOR_LIT, 0.5 + varT * 0.5), t)
    }
    // wet banks: mud then a sand lip against rivers and lakes (backlog #1)
    const wd = waterEdgeDist(x, z)
    if (wd < 14) {
      const t = THREE.MathUtils.clamp(1 - wd / 14, 0, 1)
      out.lerp(_c.copy(C_MUD).lerp(C_SHORE_SAND, THREE.MathUtils.clamp(1 - wd / 5, 0, 1) * 0.6), t * 0.8)
    }
    // gray rocky patches where the low-frequency noise bottoms out
    if (n1 < -0.45) {
      out.lerp(C_ROCK, THREE.MathUtils.clamp((-0.45 - n1) * 2.2, 0, 0.7))
    }
    // beach→grass blend band
    if (h < 3.6) out.lerp(_c2.copy(C_SAND), (3.6 - h) / 1.2 * 0.6)
    // altitude: fade toward volcanic rock
    if (h > 55) out.lerp(C_BASALT, THREE.MathUtils.clamp((h - 55) / 55, 0, 1))
    if (h > 130) out.lerp(C_CINDER, THREE.MathUtils.clamp((h - 130) / 60, 0, 1))
  }
  // slope: rock faces override
  if (ny < 0.82) {
    const t = THREE.MathUtils.clamp((0.82 - ny) / 0.2, 0, 1)
    out.lerp(_c.copy(ny < 0.62 ? C_ROCK_STEEP : C_ROCK).offsetHSL(0, 0, varT * 0.025), t)
  }
  return out
}

function buildChunkGeometry(originX: number, originZ: number, quads: number): THREE.BufferGeometry {
  const step = CHUNK_SIZE / quads
  const side = quads + 1
  const gridCount = side * side
  const skirtCount = side * 4
  const total = gridCount + skirtCount

  const pos = new Float32Array(total * 3)
  const nor = new Float32Array(total * 3)
  const col = new Float32Array(total * 3)
  const spl = new Float32Array(total * 4)
  const n = new THREE.Vector3()
  const c = new THREE.Color()
  const s4 = new THREE.Vector4()

  for (let iz = 0; iz < side; iz++) {
    for (let ix = 0; ix < side; ix++) {
      const x = originX + ix * step
      const z = originZ + iz * step
      const o = (iz * side + ix) * 3
      // exact heights at every LOD — an upward max-bias variant raised coarse
      // chunks above their fine neighbors and cracked the volcano silhouette
      const h = heightAt(x, z)
      pos[o] = x
      pos[o + 1] = h
      pos[o + 2] = z
      normalAt(x, z, n)
      nor[o] = n.x; nor[o + 1] = n.y; nor[o + 2] = n.z
      groundColorAt(x, z, h, n.y, c)
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b
      splatAt(x, z, h, n.y, s4)
      const o4 = (iz * side + ix) * 4
      spl[o4] = s4.x; spl[o4 + 1] = s4.y; spl[o4 + 2] = s4.z; spl[o4 + 3] = s4.w
    }
  }

  // Skirts: one duplicated ring of edge vertices pushed straight down. The wall
  // they form hides the sliver gaps where a neighbor renders at a coarser LOD.
  // Normals copy the edge vertex's normal so the wall shades like the ground.
  const edgeIndex = (edge: number, i: number): number => {
    switch (edge) {
      case 0: return i                        // north row  (iz = 0)
      case 1: return (side - 1) * side + i    // south row  (iz = side-1)
      case 2: return i * side                 // west col   (ix = 0)
      default: return i * side + (side - 1)   // east col   (ix = side-1)
    }
  }
  for (let edge = 0; edge < 4; edge++) {
    for (let i = 0; i < side; i++) {
      const src = edgeIndex(edge, i) * 3
      const dst = (gridCount + edge * side + i) * 3
      pos[dst] = pos[src]
      pos[dst + 1] = pos[src + 1] - skirtDepthFor(quads)
      pos[dst + 2] = pos[src + 2]
      nor[dst] = nor[src]; nor[dst + 1] = nor[src + 1]; nor[dst + 2] = nor[src + 2]
      col[dst] = col[src]; col[dst + 1] = col[src + 1]; col[dst + 2] = col[src + 2]
      const s4src = edgeIndex(edge, i) * 4
      const s4dst = (gridCount + edge * side + i) * 4
      spl[s4dst] = spl[s4src]; spl[s4dst + 1] = spl[s4src + 1]; spl[s4dst + 2] = spl[s4src + 2]; spl[s4dst + 3] = spl[s4src + 3]
    }
  }

  const indices = new Uint32Array(quads * quads * 6 + quads * 4 * 6)
  let w = 0
  for (let iz = 0; iz < quads; iz++) {
    for (let ix = 0; ix < quads; ix++) {
      const a = iz * side + ix
      const b = a + 1
      const c = a + side
      const d = c + 1
      indices[w++] = a; indices[w++] = c; indices[w++] = b
      indices[w++] = b; indices[w++] = c; indices[w++] = d
    }
  }
  // skirt quads: edge vertex i, i+1 and their dropped copies. Winding flips per
  // edge so the wall always faces outward.
  for (let edge = 0; edge < 4; edge++) {
    const flip = edge === 0 || edge === 3
    for (let i = 0; i < quads; i++) {
      const top0 = edgeIndex(edge, i)
      const top1 = edgeIndex(edge, i + 1)
      const bot0 = gridCount + edge * side + i
      const bot1 = bot0 + 1
      if (flip) {
        indices[w++] = top0; indices[w++] = bot0; indices[w++] = top1
        indices[w++] = top1; indices[w++] = bot0; indices[w++] = bot1
      } else {
        indices[w++] = top0; indices[w++] = top1; indices[w++] = bot0
        indices[w++] = bot0; indices[w++] = top1; indices[w++] = bot1
      }
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.setAttribute('splat', new THREE.BufferAttribute(spl, 4))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeBoundingSphere()
  return geo
}

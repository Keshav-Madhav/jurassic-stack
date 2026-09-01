// Chunked terrain renderer: fixed 16×16 grid of 128 m chunks, four LOD levels
// (64/32/16/8 quads per side) picked by camera distance, with skirts on every
// chunk edge so neighboring chunks at different LODs never show cracks.
//
// Geometries are built lazily per (chunk, LOD) and cached. All sampling goes
// through heightmap.ts. LOD0 vertex data doubles as the physics collider mesh
// (physics.ts asks for it via chunkGridData).
import * as THREE from 'three'
import { heightAt, normalAt, HALF_SIZE, SEA_LEVEL } from './heightmap'

export const CHUNK_SIZE = 128
export const CHUNKS_PER_SIDE = (HALF_SIZE * 2) / CHUNK_SIZE // 16
const LOD_QUADS = [64, 32, 16, 8]
/** Camera distance (m) beyond which each LOD level kicks in. */
const LOD_DISTANCE = [0, 260, 520, 1000]
const SKIRT_DEPTH = 4

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
    // vertex-colored ground (see groundColorAt) — the material stays white
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    })
    for (let cz = 0; cz < CHUNKS_PER_SIDE; cz++) {
      for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
        const originX = -HALF_SIZE + cx * CHUNK_SIZE
        const originZ = -HALF_SIZE + cz * CHUNK_SIZE
        const mesh = new THREE.Mesh(undefined, this.material)
        mesh.frustumCulled = true
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
const C_DEEP = new THREE.Color(0x2e3d33) // underwater
const C_SAND = new THREE.Color(0xb9a06a)
const C_GRASS_LUSH = new THREE.Color(0x2f5426) // dark rich green
const C_GRASS_LIGHT = new THREE.Color(0x4a7336)
const C_GRASS_DRY = new THREE.Color(0x6e7038) // olive dry patches
const C_ROCK = new THREE.Color(0x6b6157)
const C_ROCK_STEEP = new THREE.Color(0x524a42)
const C_BASALT = new THREE.Color(0x453d36) // volcano flanks
const C_CINDER = new THREE.Color(0x332c27) // summit

const _c = new THREE.Color()
const _c2 = new THREE.Color()

/** Ground color by height/slope + two-frequency variation noise. */
function groundColorAt(x: number, z: number, h: number, ny: number, out: THREE.Color): THREE.Color {
  // cheap deterministic variation (hash-free trig noise is fine for color)
  const n1 = Math.sin(x * 0.021 + Math.sin(z * 0.017) * 2.1) * Math.cos(z * 0.019 - Math.sin(x * 0.023))
  const n2 = Math.sin(x * 0.11 + z * 0.09) * Math.cos(x * 0.07 - z * 0.13)
  const varT = n1 * 0.5 + n2 * 0.28 // ~[-0.78, 0.78]

  if (h < SEA_LEVEL - 0.4) {
    out.copy(C_DEEP).lerp(C_SAND, THREE.MathUtils.clamp((h + 8) / 8, 0, 1) * 0.5)
  } else if (h < 2.4) {
    out.copy(C_SAND).offsetHSL(0, 0, varT * 0.03)
  } else {
    // grass field: lush ↔ light by variation, dry olive patches where n1 peaks
    out.copy(C_GRASS_LUSH).lerp(C_GRASS_LIGHT, THREE.MathUtils.clamp(0.5 + varT * 0.9, 0, 1))
    if (n1 > 0.22) out.lerp(C_GRASS_DRY, THREE.MathUtils.clamp((n1 - 0.22) * 2.0, 0, 0.9))
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
  const n = new THREE.Vector3()
  const c = new THREE.Color()

  for (let iz = 0; iz < side; iz++) {
    for (let ix = 0; ix < side; ix++) {
      const x = originX + ix * step
      const z = originZ + iz * step
      const o = (iz * side + ix) * 3
      const h = heightAt(x, z)
      pos[o] = x
      pos[o + 1] = h
      pos[o + 2] = z
      normalAt(x, z, n)
      nor[o] = n.x; nor[o + 1] = n.y; nor[o + 2] = n.z
      groundColorAt(x, z, h, n.y, c)
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b
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
      pos[dst + 1] = pos[src + 1] - SKIRT_DEPTH
      pos[dst + 2] = pos[src + 2]
      nor[dst] = nor[src]; nor[dst + 1] = nor[src + 1]; nor[dst + 2] = nor[src + 2]
      col[dst] = col[src]; col[dst + 1] = col[src + 1]; col[dst + 2] = col[src + 2]
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
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeBoundingSphere()
  return geo
}

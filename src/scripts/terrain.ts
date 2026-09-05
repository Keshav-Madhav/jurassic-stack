// Chunked terrain renderer: fixed 16×16 grid of 128 m chunks, four LOD levels
// (64/32/16/8 quads per side) picked by camera distance, with skirts on every
// chunk edge so neighboring chunks at different LODs never show cracks.
//
// Geometries are built lazily per (chunk, LOD) and cached. All sampling goes
// through heightmap.ts. LOD0 vertex data doubles as the physics collider mesh
// (physics.ts asks for it via chunkGridData).
import * as THREE from 'three'
import { heightAt, HALF_SIZE } from './heightmap'
import { buildChunkArrays, CHUNK_SIZE, CHUNKS_PER_SIDE, LOD_QUADS, type ChunkArrays } from './terrain-paint'
export { CHUNK_SIZE, CHUNKS_PER_SIDE } from './terrain-paint'

/** Camera distance (m) beyond which each LOD level kicks in. */
const LOD_DISTANCE = [0, 260, 520, 1000]
/** Far terrain merges 4×4 chunks into one 512 m super-chunk at LOD3 resolution:
 *  the 4 km island is 1024 chunks, and a thousand 128-tri draw calls of the
 *  splat shader cost more than the triangles they carried. */
const SUPER = 4
const SUPER_SIZE = CHUNK_SIZE * SUPER

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
  /** LOD currently being built in the worker (-1 none) */
  pending: number
}

/** Off-thread chunk geometry: requests go to terrain-worker.ts, arrays come
 *  back transferred; the main thread only wraps them. Falls back to a
 *  synchronous build if workers are unavailable. */
class TerrainBuilder {
  private worker: Worker | null = null
  private ready = false
  private nextId = 1
  private waiting = new Map<number, (a: ChunkArrays) => void>()

  constructor() {
    try {
      this.worker = new Worker(new URL('./terrain-worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent) => {
        const m = e.data
        if (m.type === 'ready') { this.ready = true; return }
        if (m.type === 'built') {
          const cb = this.waiting.get(m.id)
          this.waiting.delete(m.id)
          cb?.({ pos: m.pos, nor: m.nor, col: m.col, spl: m.spl, indices: m.indices })
        }
      }
      this.worker.onerror = () => { this.worker = null; this.ready = false }
      // the worker loads the world itself — hand it an absolute base URL
      this.worker.postMessage({ type: 'init', base: new URL('.', document.baseURI).href })
    } catch {
      this.worker = null
    }
  }

  get available(): boolean { return !!this.worker && this.ready }
  get inFlight(): number { return this.waiting.size }

  request(originX: number, originZ: number, quads: number, size: number, cb: (a: ChunkArrays) => void): void {
    const id = this.nextId++
    this.waiting.set(id, cb)
    this.worker!.postMessage({ type: 'build', id, originX, originZ, quads, size })
  }
}

export class Terrain {
  readonly group = new THREE.Group()
  private chunks: Chunk[] = []
  private supers: { sx: number; sz: number; mesh: THREE.Mesh; geo: THREE.BufferGeometry | null; active: boolean }[] = []
  private builder = new TerrainBuilder()
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
          mesh, lod: -1, pending: -1,
          cache: [null, null, null, null],
        }
        this.chunks.push(chunk)
        this.group.add(mesh)
      }
    }
    for (let sz = 0; sz < CHUNKS_PER_SIDE / SUPER; sz++) {
      for (let sx = 0; sx < CHUNKS_PER_SIDE / SUPER; sx++) {
        // same splat material as the near chunks: a vertex-colour-only far
        // material read as a yellow-grey patchwork with a hard seam where the
        // near chunks began (live review) — the textures are what blend the
        // palette's low-frequency variation into ground
        const mesh = new THREE.Mesh(undefined, this.material)
        mesh.frustumCulled = true
        mesh.receiveShadow = false // beyond the shadow camera anyway
        mesh.visible = false
        this.supers.push({ sx, sz, mesh, geo: null, active: false })
        this.group.add(mesh)
      }
    }
  }

  /** Re-pick LODs around a focus point; swaps geometry only when a level
   *  changes — and BUILDS at most a few milliseconds of new geometry per
   *  frame, nearest first (a LOD0 chunk is 4K vertices of colour + splat
   *  work; crossing a border at a gallop used to build three at once and
   *  the frame hitched). A chunk waiting on its build keeps its old LOD. */
  update(focusX: number, focusZ: number): void {
    const wanted: { c: Chunk; lod: number; d: number }[] = []
    for (const c of this.chunks) {
      const dx = c.centerX - focusX
      const dz = c.centerZ - focusZ
      const d = Math.sqrt(dx * dx + dz * dz)
      let lod = LOD_DISTANCE.length - 1
      for (let i = 0; i < LOD_DISTANCE.length; i++) {
        if (d >= LOD_DISTANCE[i]) lod = i
      }
      if (lod === c.lod) continue
      if (c.cache[lod]) {
        c.lod = lod
        c.mesh.geometry = c.cache[lod]!
      } else {
        wanted.push({ c, lod, d })
      }
    }
    if (wanted.length) {
      wanted.sort((a, b) => a.d - b.d)
      const t0 = performance.now()
      for (const w of wanted) {
        const c = w.c
        if (c.lod === -1 || !this.builder.available) {
          // no geometry yet (first frames) or no worker: build here, budgeted
          if (performance.now() - t0 > 3 && c.lod !== -1) break
          c.cache[w.lod] = buildChunkGeometry(c.originX, c.originZ, LOD_QUADS[w.lod])
          c.lod = w.lod
          c.mesh.geometry = c.cache[w.lod]!
          continue
        }
        if (c.pending !== -1) continue // already building (maybe another LOD; it'll re-evaluate)
        if (this.builder.inFlight >= 6) break // keep the queue short so requests stay fresh
        c.pending = w.lod
        const lod = w.lod
        this.builder.request(c.originX, c.originZ, LOD_QUADS[lod], CHUNK_SIZE, (a) => {
          c.cache[lod] = geometryFrom(a)
          c.pending = -1
          // apply only if this LOD is still the one wanted (the next update
          // re-picks anyway; this just avoids a one-frame pop backwards)
          c.lod = lod
          c.mesh.geometry = c.cache[lod]!
        })
      }
    }
    // super-chunks take over wherever all 16 sub-chunks sit at the coarsest LOD
    const farLod = LOD_DISTANCE.length - 1
    for (const s of this.supers) {
      let allFar = true
      for (let dz = 0; dz < SUPER && allFar; dz++) {
        for (let dx = 0; dx < SUPER; dx++) {
          if (this.chunks[(s.sz * SUPER + dz) * CHUNKS_PER_SIDE + s.sx * SUPER + dx].lod !== farLod) { allFar = false; break }
        }
      }
      if (allFar !== s.active) {
        s.active = allFar
        if (allFar) {
          s.geo ??= buildChunkGeometry(-HALF_SIZE + s.sx * SUPER_SIZE, -HALF_SIZE + s.sz * SUPER_SIZE, LOD_QUADS[farLod] * SUPER, SUPER_SIZE)
          s.mesh.geometry = s.geo
        }
        s.mesh.visible = allFar
        for (let dz = 0; dz < SUPER; dz++) {
          for (let dx = 0; dx < SUPER; dx++) {
            this.chunks[(s.sz * SUPER + dz) * CHUNKS_PER_SIDE + s.sx * SUPER + dx].mesh.visible = !allFar
          }
        }
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
/** Wrap chunk arrays (built here or in the worker) as a BufferGeometry. */
function geometryFrom(a: ChunkArrays): THREE.BufferGeometry {
  const { pos, nor, col, spl, indices } = a
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.setAttribute('splat', new THREE.BufferAttribute(spl, 4))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeBoundingSphere()
  return geo
}

/** Build synchronously on the main thread (first-frame LOD3 fill only). */
function buildChunkGeometry(originX: number, originZ: number, quads: number, size = CHUNK_SIZE): THREE.BufferGeometry {
  return geometryFrom(buildChunkArrays(originX, originZ, quads, size))
}

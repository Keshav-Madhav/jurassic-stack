// The island's height function — single source of truth for terrain, shared
// by the renderer, physics, and AI so they can never disagree.
//
// As of M5 this samples BAKED data (tools/bake-island.mjs → public/world/):
// an int16 grid at 2 m resolution, bilinear-interpolated. The bake owns
// composition, erosion, and validation; this file just serves heights.
// loadHeightmap() must resolve before anything samples.
import * as THREE from 'three'

/** Island half-size in meters (world spans -SIZE..+SIZE on x and z). */
export const HALF_SIZE = 2048
/** Sea level (world y). */
export const SEA_LEVEL = 0
/** Volcano center — the arc's landmark. Filled from world-meta on load. */
export const VOLCANO = { x: 0, z: -620 }
/** Spawn point: south beach, volcano sightline ahead. Filled on load. */
export const SPAWN = { x: 0, z: 780 }

export interface RiverPoint { x: number; z: number }
export interface LakeDef {
  name: string
  level: number
  depth?: number
  deep: { x: number; z: number }
  /** hand-traced shoreline polygon, [x,z] pairs */
  shore: [number, number][]
}

/** Signed distance to a shoreline polygon: negative inside. */
export function shoreDist(px: number, pz: number, shore: [number, number][]): number {
  let inside = false
  let minD = Infinity
  for (let i = 0, j = shore.length - 1; i < shore.length; j = i++) {
    const [xi, zi] = shore[i]
    const [xj, zj] = shore[j]
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside
    const dx = xj - xi
    const dz = zj - zi
    const t = Math.max(0, Math.min(1, ((px - xi) * dx + (pz - zi) * dz) / (dx * dx + dz * dz)))
    minD = Math.min(minD, Math.hypot(px - (xi + dx * t), pz - (zi + dz * t)))
  }
  return inside ? -minD : minD
}
export interface RuinSite { tag: string; x: number; z: number; y: number; keystone?: boolean; layout?: string | null }
/** One part of the river: a flowing leg or the dead-water ring. */
export interface RiverPart {
  name: string
  /** 1 = current runs start→end along the path; 0 = still water at `river.level` */
  flow: number
  halfWidth: number
  closed: boolean
  ford: { x: number; z: number } | null
  path: RiverPoint[]
}
export interface RiverDef { knot: { x: number; z: number }; level: number; parts: RiverPart[] }
export interface SwampDef { level: number; shore: [number, number][] }
export interface WorldMeta {
  side: number
  res: number
  scale: number
  half: number
  sea: number
  encoding?: 'row-delta'
  spawn: { x: number; z: number }
  volcano: { x: number; z: number }
  /** the Ravine: the slot canyon from the caldera door up to the crater bench */
  ravine: { halfWidth: number; floorStart: number; floorEnd: number; path: { x: number; z: number }[] }
  /** every part as a plain polyline (closed ones wrapped), flowing legs first */
  rivers: RiverPoint[][]
  river?: RiverDef
  lakes: LakeDef[]
  ruinSites: RuinSite[]
  swamp?: SwampDef | null
  coast?: [number, number][]
  forests?: { name: string; kind: 'broadleaf' | 'pine' | 'mixed'; density: number; edge?: number; shore: [number, number][] }[]
  clearings?: [number, number][][]
}

let grid: Int16Array | null = null
let biomes: Uint8Array | null = null
let forest: Uint8Array | null = null
let side = 0
let res = 2
let scale = 0.01
export let worldMeta: WorldMeta | null = null

export async function loadHeightmap(base = ''): Promise<void> {
  const [metaRes, binRes, bioRes, forRes, svRes] = await Promise.all([
    fetch(`${base}world/world-meta.json`),
    fetch(`${base}world/heightmap.bin`),
    fetch(`${base}world/biomes.bin`),
    fetch(`${base}world/forest.bin`),
    fetch(`${base}world/skyview.bin`),
  ])
  if (!metaRes.ok || !binRes.ok) throw new Error('world data missing — run tools/bake-island.mjs')
  if (bioRes.ok) biomes = new Uint8Array(await bioRes.arrayBuffer())
  if (forRes.ok) forest = new Uint8Array(await forRes.arrayBuffer())
  if (svRes.ok) skyview = new Uint8Array(await svRes.arrayBuffer())
  worldMeta = (await metaRes.json()) as WorldMeta
  side = worldMeta.side
  res = worldMeta.res
  scale = worldMeta.scale
  grid = new Int16Array(await binRes.arrayBuffer())
  // row-delta int16 (tools/world-io.mjs): each cell stores its difference
  // from its western neighbour — ~30% smaller over the wire than raw heights
  if (worldMeta.encoding === 'row-delta') {
    for (let z = 0; z < side; z++) {
      const row = z * side
      for (let x = 1; x < side; x++) grid[row + x] = (grid[row + x] + grid[row + x - 1]) | 0
    }
  }
  SPAWN.x = worldMeta.spawn.x
  SPAWN.z = worldMeta.spawn.z
  VOLCANO.x = worldMeta.volcano.x
  VOLCANO.z = worldMeta.volcano.z
}

/** Inside one of the carved cave bowls or its throat? Nothing grows in a cave
 *  and nothing spawns in one (M51) — and the runtime asks the same question to
 *  know when to make it dark, so the answer lives here with the world data. */
export function caveAt(x: number, z: number, margin = 0): { name: string; keystone: boolean } | null {
  const caves = (worldMeta as unknown as { caves?: { name: string; keystone: boolean; mouth: { x: number; z: number }; into: { x: number; z: number }; reach: number; radius: number }[] } | null)?.caves
  if (!caves) return null
  for (const c of caves) {
    const cx = c.mouth.x + c.into.x * c.reach
    const cz = c.mouth.z + c.into.z * c.reach
    if (Math.hypot(x - cx, z - cz) < c.radius + margin) return c
    const ax = c.mouth.x - c.into.x * 8, az = c.mouth.z - c.into.z * 8
    const dx = cx - ax, dz = cz - az
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
    if (t > 0.02 && Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < 11 + margin) return c
  }
  return null
}

/** SKY VIEW: how much sky each patch of ground can see, baked by
 *  tools/bake-island.mjs (sixteen horizon rays out to 240 m, 1024² over the
 *  island). This is the landscape's share of ambient occlusion, and since a
 *  gorge is always a gorge it is computed ONCE rather than 60 times a second:
 *  the terrain's vertex colours and every prop and grass tint are multiplied
 *  by it as the world is built, so it costs nothing at all to draw (M47). */
let skyview: Uint8Array | null = null
const SV_SIDE = 1024

/** 0 (a slot at the bottom of a cliff) to 1 (open plain), bilinear. */
export function skyViewAt(x: number, z: number): number {
  if (!skyview) return 1
  const half = HALF_SIZE
  const fx = ((x + half) / (half * 2)) * SV_SIDE - 0.5
  const fz = ((z + half) / (half * 2)) * SV_SIDE - 0.5
  const x0 = Math.max(0, Math.min(SV_SIDE - 1, Math.floor(fx)))
  const z0 = Math.max(0, Math.min(SV_SIDE - 1, Math.floor(fz)))
  const x1 = Math.min(SV_SIDE - 1, x0 + 1)
  const z1 = Math.min(SV_SIDE - 1, z0 + 1)
  const tx = Math.max(0, Math.min(1, fx - x0))
  const tz = Math.max(0, Math.min(1, fz - z0))
  const a = skyview[z0 * SV_SIDE + x0], b = skyview[z0 * SV_SIDE + x1]
  const c = skyview[z1 * SV_SIDE + x0], d = skyview[z1 * SV_SIDE + x1]
  return ((a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz) / 255
}

/** How hard the baked occlusion bites (0 = off). It multiplies ALBEDO, not the
 *  ambient term alone — which is the honest compromise for something that has
 *  to be free — so it has to stay gentle: at 0.85 the caldera floor went black
 *  at noon, and a crater floor at noon is not black, the sun is overhead. 0.5
 *  darkens the deepest hollow by about a fifth and leaves the open ground
 *  untouched (M47). */
export const SKY_VIEW_STRENGTH = 0.5

/** the multiplier to fold into a vertex colour or an instance tint */
export function ambientAt(x: number, z: number): number {
  return 1 - (1 - skyViewAt(x, z)) * SKY_VIEW_STRENGTH
}

/** The heightmap as a GPU texture (R16F, 2048², linear-filtered), built once
 *  — the water shader reads the ground under each fragment for shore fades
 *  and foam. uv = ((x + HALF) / res + 0.5) / 2048. */
let heightTex: THREE.DataTexture | null = null
/** QA: what the baked grids cost in JS memory (tools/qa-mem.mjs). Memory is a
 *  budget like any other, and nothing was counting it (M57). */
export function gridBytes(): Record<string, number> {
  return {
    height: grid?.byteLength ?? 0,
    biomes: biomes?.byteLength ?? 0,
    forest: forest?.byteLength ?? 0,
    skyview: skyview?.byteLength ?? 0,
  }
}

export function heightTexture(): THREE.DataTexture {
  if (heightTex) return heightTex
  if (!grid) throw new Error('heightTexture before loadHeightmap()')
  const N = 2048
  const data = new Uint16Array(N * N)
  for (let z = 0; z < N; z++) {
    const row = z * side
    for (let x = 0; x < N; x++) data[z * N + x] = THREE.DataUtils.toHalfFloat(grid[row + x] * scale)
  }
  heightTex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.HalfFloatType)
  heightTex.minFilter = THREE.LinearFilter
  heightTex.magFilter = THREE.LinearFilter
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping
  heightTex.generateMipmaps = false
  heightTex.needsUpdate = true
  return heightTex
}

export function heightAt(x: number, z: number): number {
  if (!grid) throw new Error('heightAt before loadHeightmap()')
  const fx = (x + HALF_SIZE) / res
  const fz = (z + HALF_SIZE) / res
  if (fx < 0 || fz < 0 || fx >= side - 1 || fz >= side - 1) return -14
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  const u = fx - ix
  const v = fz - iz
  const i0 = iz * side + ix
  const h00 = grid[i0]
  const h10 = grid[i0 + 1]
  const h01 = grid[i0 + side]
  const h11 = grid[i0 + side + 1]
  // pure grid bilinear — micro-detail now lives IN the baked grid, so LOD0
  // rendering, physics, AI, and prop placement are byte-identical sources
  return (h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v) * scale
}

/** The height the COARSEST terrain LOD renders at (x,z): bilinear over the
 *  16m LOD3 vertex grid (chunk-aligned). Props embed by their positive error
 *  vs this floor, so even the farthest render can't leave them floating. */
export function lodFloorAt(x: number, z: number): number {
  const STEP = 16 // LOD3 vertex spacing (128m chunk / 8 quads)
  const gx = Math.floor((x + HALF_SIZE) / STEP) * STEP - HALF_SIZE
  const gz = Math.floor((z + HALF_SIZE) / STEP) * STEP - HALF_SIZE
  const u = (x - gx) / STEP
  const v = (z - gz) / STEP
  const h00 = heightAt(gx, gz)
  const h10 = heightAt(gx + STEP, gz)
  const h01 = heightAt(gx, gz + STEP)
  const h11 = heightAt(gx + STEP, gz + STEP)
  return h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v
}

/** Normal via central differences on the sampled grid. `out` avoids allocation. */
export function normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 1.0
  const hl = heightAt(x - e, z)
  const hr = heightAt(x + e, z)
  const hd = heightAt(x, z - e)
  const hu = heightAt(x, z + e)
  return out.set(hl - hr, 2 * e, hd - hu).normalize()
}

/** Biome id at (x,z): 0 default · 1 swamp · 2 desert · 3 plains · 4 alpine. */
export const BIOME = { DEFAULT: 0, SWAMP: 1, DESERT: 2, PLAINS: 3, ALPINE: 4 } as const
export function biomeAt(x: number, z: number): number {
  if (!biomes) return 0
  const ix = Math.round((x + HALF_SIZE) / res)
  const iz = Math.round((z + HALF_SIZE) / res)
  if (ix < 0 || iz < 0 || ix >= side || iz >= side) return 0
  return biomes[iz * side + ix]
}

/** Forest fullness in [-1, 1] from the baked hand-traced woods (forest.bin):
 *  -1 open country, 0 the feathered wood line, +1 deep forest. Bilinear. */
export function forestMaskAt(x: number, z: number): number {
  if (!forest) return -1
  const fx = (x + HALF_SIZE) / res
  const fz = (z + HALF_SIZE) / res
  if (fx < 0 || fz < 0 || fx >= side - 1 || fz >= side - 1) return -1
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  const u = fx - ix
  const v = fz - iz
  const i0 = iz * side + ix
  const d00 = forest[i0] >> 2
  const d10 = forest[i0 + 1] >> 2
  const d01 = forest[i0 + side] >> 2
  const d11 = forest[i0 + side + 1] >> 2
  const d = (d00 * (1 - u) * (1 - v) + d10 * u * (1 - v) + d01 * (1 - u) * v + d11 * u * v) / 63
  return d * 2 - 1
}

/** Which wood this is: 0 broadleaf · 1 pine · 2 mixed (nearest cell). */
export const FOREST_KIND = { BROADLEAF: 0, PINE: 1, MIXED: 2, REDWOOD: 3 } as const
export function forestKindAt(x: number, z: number): number {
  if (!forest) return 0
  const ix = Math.round((x + HALF_SIZE) / res)
  const iz = Math.round((z + HALF_SIZE) / res)
  if (ix < 0 || iz < 0 || ix >= side || iz >= side) return 0
  return forest[iz * side + ix] & 3
}

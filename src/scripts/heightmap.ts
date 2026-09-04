// The island's height function — single source of truth for terrain, shared
// by the renderer, physics, and AI so they can never disagree.
//
// As of M5 this samples BAKED data (tools/bake-island.mjs → public/world/):
// an int16 grid at 2 m resolution, bilinear-interpolated. The bake owns
// composition, erosion, and validation; this file just serves heights.
// loadHeightmap() must resolve before anything samples.
import * as THREE from 'three'

/** Island half-size in meters (world spans -SIZE..+SIZE on x and z). */
export const HALF_SIZE = 1024
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
export interface RuinSite { tag: string; x: number; z: number; y: number }
export interface SwampDef { x: number; z: number; r: number; level: number }
export interface WorldMeta {
  side: number
  res: number
  scale: number
  half: number
  sea: number
  spawn: { x: number; z: number }
  volcano: { x: number; z: number }
  rivers: RiverPoint[][]
  lakes: LakeDef[]
  ruinSites: RuinSite[]
  swamp?: SwampDef
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
  const [metaRes, binRes, bioRes, forRes] = await Promise.all([
    fetch(`${base}world/world-meta.json`),
    fetch(`${base}world/heightmap.bin`),
    fetch(`${base}world/biomes.bin`),
    fetch(`${base}world/forest.bin`),
  ])
  if (!metaRes.ok || !binRes.ok) throw new Error('world data missing — run tools/bake-island.mjs')
  if (bioRes.ok) biomes = new Uint8Array(await bioRes.arrayBuffer())
  if (forRes.ok) forest = new Uint8Array(await forRes.arrayBuffer())
  worldMeta = (await metaRes.json()) as WorldMeta
  side = worldMeta.side
  res = worldMeta.res
  scale = worldMeta.scale
  grid = new Int16Array(await binRes.arrayBuffer())
  SPAWN.x = worldMeta.spawn.x
  SPAWN.z = worldMeta.spawn.z
  VOLCANO.x = worldMeta.volcano.x
  VOLCANO.z = worldMeta.volcano.z
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
export const FOREST_KIND = { BROADLEAF: 0, PINE: 1, MIXED: 2 } as const
export function forestKindAt(x: number, z: number): number {
  if (!forest) return 0
  const ix = Math.round((x + HALF_SIZE) / res)
  const iz = Math.round((z + HALF_SIZE) / res)
  if (ix < 0 || iz < 0 || ix >= side || iz >= side) return 0
  return forest[iz * side + ix] & 3
}

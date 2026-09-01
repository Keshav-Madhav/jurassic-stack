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
export interface LakeDef { x: number; z: number; r: number; level: number }
export interface RuinSite { tag: string; x: number; z: number; y: number }
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
}

let grid: Int16Array | null = null
let side = 0
let res = 2
let scale = 0.01
export let worldMeta: WorldMeta | null = null

export async function loadHeightmap(base = ''): Promise<void> {
  const [metaRes, binRes] = await Promise.all([
    fetch(`${base}world/world-meta.json`),
    fetch(`${base}world/heightmap.bin`),
  ])
  if (!metaRes.ok || !binRes.ok) throw new Error('world data missing — run tools/bake-island.mjs')
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
  return (h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v) * scale
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

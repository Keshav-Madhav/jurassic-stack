// Grass tile generation — pure data (matrices + colours) from the baked
// grids, so it can run in the terrain worker. grass.ts owns the meshes.
import * as THREE from 'three'
import { heightAt, normalAt, biomeAt, forestMaskAt, BIOME, VOLCANO, worldMeta } from './heightmap'

export const GRASS_TILE = 64

function hash2(x: number, z: number): () => number {
  let a = (Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263)) >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const _n = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)

function underWater(x: number, z: number, h: number): boolean {
  const meta = worldMeta
  if (!meta) return false
  for (const lake of meta.lakes) if (h < lake.level + 0.3) {
    const xs = lake.shore.map((p) => p[0]), zs = lake.shore.map((p) => p[1])
    if (x > Math.min(...xs) - 6 && x < Math.max(...xs) + 6 && z > Math.min(...zs) - 6 && z < Math.max(...zs) + 6) return true
  }
  for (const path of meta.rivers) {
    for (let i = 0; i < path.length - 1; i++) {
      const ax = path[i].x, az = path[i].z, dx = path[i + 1].x - ax, dz = path[i + 1].z - az
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
      if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < 16) return true
    }
  }
  return false
}

/** Every tuft of one tile at `spacing`: instance matrices (16 floats each) + colours (3). */
export function buildGrassTile(tx: number, tz: number, spacing: number): { matrices: Float32Array; colors: Float32Array; count: number } {
  const rand = hash2(tx, tz)
  const meta = worldMeta
  const cx = tx * GRASS_TILE + GRASS_TILE / 2, cz = tz * GRASS_TILE + GRASS_TILE / 2
  // a tile near a river or lake checks each tuft against the water; others skip it
  let nearWater = false
  if (meta) {
    for (const lake of meta.lakes) {
      const xs = lake.shore.map((p) => p[0]), zs = lake.shore.map((p) => p[1])
      if (cx > Math.min(...xs) - 60 && cx < Math.max(...xs) + 60 && cz > Math.min(...zs) - 60 && cz < Math.max(...zs) + 60) nearWater = true
    }
    if (!nearWater) {
      for (const path of meta.rivers) {
        for (let i = 0; i < path.length - 1 && !nearWater; i++) {
          const ax = path[i].x, az = path[i].z, dx = path[i + 1].x - ax, dz = path[i + 1].z - az
          const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / (dx * dx + dz * dz)))
          if (Math.hypot(cx - (ax + dx * t), cz - (az + dz * t)) < GRASS_TILE) nearWater = true
        }
      }
    }
  }
  const side = Math.ceil(GRASS_TILE / spacing)
  const matrices = new Float32Array(side * side * 16)
  const colors = new Float32Array(side * side * 3)
  let count = 0
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const r0 = rand(), r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand()
      const x = tx * GRASS_TILE + (i + r0) * spacing
      const z = tz * GRASS_TILE + (j + r1) * spacing
      const h = heightAt(x, z)
      // the beach is sand: no grass under 2.5 m, dune tufts up to 3 (the spawn meadow sits at 3.0)
      if (h < 2.5 || h > 190) continue
      // the volcano's cone, the Ravine and the crater bench are bare ash and rock
      if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < 340) continue
      if (h < 3.0 && r3 > 0.4) continue
      const biome = biomeAt(x, z)
      if (biome === BIOME.DESERT && r2 > 0.12) continue // a few dry tufts in the dunes
      if (biome === BIOME.SWAMP && r2 > 0.55) continue
      if (biome === BIOME.ALPINE && r2 > 0.3) continue
      // thinner under a closed canopy (the floor is dirt and litter there)
      const f = forestMaskAt(x, z)
      if (f > 0.2 && r3 > 0.45) continue
      if (normalAt(x, z, _n).y < 0.7) continue
      if (nearWater && underWater(x, z, h)) continue
      const scale = 0.55 + r4 * 0.6
      _p.set(x, h - 0.04, z)
      _q.setFromAxisAngle(_up, r2 * Math.PI)
      _s.set(scale, scale * (0.8 + r1 * 0.5), scale)
      _m.compose(_p, _q, _s)
      _m.toArray(matrices, count * 16)
      // plains lighter and yellower, woods darker
      const k = biome === BIOME.PLAINS ? 0.85 + r4 * 0.25 : 0.55 + r4 * 0.35
      colors[count * 3] = k * (biome === BIOME.PLAINS ? 1.05 : 0.95)
      colors[count * 3 + 1] = k
      colors[count * 3 + 2] = k * 0.85
      count++
    }
  }
  return { matrices: matrices.subarray(0, count * 16), colors: colors.subarray(0, count * 3), count }
}

// The island's height function — the single source of truth for terrain.
// Renderer (terrain.ts), physics (physics.ts), and AI ground-clamping all
// sample THIS function, so they can never disagree. At M5 the analytic
// composition below is replaced by baked heightmap data behind the same
// two exports (heightAt / normalAt) and nothing downstream changes.
//
// Graybox composition (a crude sketch of the real island's arc):
//   - south coast (spawn): gentle beach, calm ground
//   - interior: rolling hills, rising toward the north
//   - north-center: the volcano cone — visible from the spawn beach
//   - beyond ~940m radius: falls below sea level (ocean floor)
import * as THREE from 'three'

/** Island half-size in meters (world spans -SIZE..+SIZE on x and z). */
export const HALF_SIZE = 1024
/** Sea level (world y). */
export const SEA_LEVEL = 0
/** Volcano center (world coords) — the arc's landmark, due north of spawn. */
export const VOLCANO = { x: 0, z: -620 }
/** Spawn point: south beach, volcano sightline straight ahead (-z). */
export const SPAWN = { x: 0, z: 780 }

export function heightAt(x: number, z: number): number {
  // base rolling hills, three octaves
  let h =
    7.0 * Math.sin(x * 0.0042 + 1.7) * Math.cos(z * 0.0037 - 0.4) +
    3.2 * Math.sin(x * 0.011 - 2.1) * Math.cos(z * 0.013 + 1.2) +
    1.1 * Math.sin(x * 0.031 + 0.6) * Math.cos(z * 0.027 + 2.8)

  // northward rise: the interior climbs toward the volcano's foothills
  h += Math.max(0, -z) * 0.012

  // the volcano: a proper cone (linear flanks read as "volcano" from afar in a
  // way gaussian mounds never do), gaussian-smoothed tip, crater dish sunk in
  const dvx = x - VOLCANO.x
  const dvz = z - VOLCANO.z
  const dv = Math.sqrt(dvx * dvx + dvz * dvz)
  const cone = Math.max(0, 1 - dv / 320) // linear flank, 320 m footprint radius
  h += 240 * cone * cone // squared → concave flanks, steepening to the top
  h += 40 * Math.exp(-(dv * dv) / (2 * 90 * 90)) // shoulder mass near the top
  h -= 95 * Math.exp(-(dv * dv) / (2 * 48 * 48)) // crater dish

  // island falloff: radial fade to ocean floor, slightly squashed on z so the
  // south beach is wide and shallow while the flanks drop faster
  const r = Math.sqrt(x * x * 1.15 + z * z * 0.95)
  const falloff = smoothstep(690, 960, r)
  h = h * (1 - falloff) + (-14) * falloff

  // the spawn beach: a firm apron around SPAWN held ABOVE sea level — it must
  // win against the island falloff, or spawn ends up on the sea floor
  const dsx = x - SPAWN.x
  const dsz = z - SPAWN.z
  const beach = Math.exp(-(dsx * dsx + dsz * dsz) / (2 * 210 * 210))
  const w = beach * 0.92
  h = h * (1 - w) + 3.0 * w

  return h
}

/** Analytic-ish normal via central differences. `out` avoids allocation. */
export function normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 0.75
  const hl = heightAt(x - e, z)
  const hr = heightAt(x + e, z)
  const hd = heightAt(x, z - e)
  const hu = heightAt(x, z + e)
  return out.set(hl - hr, 2 * e, hd - hu).normalize()
}

function smoothstep(a: number, b: number, t: number): number {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)))
  return u * u * (3 - 2 * u)
}

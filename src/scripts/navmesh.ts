// Runtime navmesh: loads the baked recast navmesh and answers path queries.
// Dinos path-follow for chase/follow (obstacle-aware); ambient wander stays on
// cheap steering. Full DetourCrowd arrives with M7's herds.
import { init as initRecast, importNavMesh, NavMeshQuery } from 'recast-navigation'

let query: NavMeshQuery | null = null
const HALF_EXT = { x: 6, y: 25, z: 6 }

export async function loadNavmesh(base = ''): Promise<void> {
  await initRecast()
  const res = await fetch(`${base}world/navmesh.bin`)
  if (!res.ok) throw new Error('navmesh missing — run tools/bake-navmesh.mjs')
  const { navMesh } = importNavMesh(new Uint8Array(await res.arrayBuffer()))
  query = new NavMeshQuery(navMesh)
}

export interface PathPoint {
  x: number
  y: number
  z: number
}

/** What the path queries cost. A recast `computePath` is milliseconds, not
 *  microseconds, and nothing was counting them — so when a herd all repathed
 *  in the same frame the cost landed in `dinos` with no way to see it (M55). */
export const navStats = { calls: 0, ms: 0, frameCalls: 0, frameMs: 0, peakFrameCalls: 0, denied: 0 }

/** how many path queries one frame may run before the rest wait their turn */
let perFrame = 4

/** main.ts, once a frame */
export function beginNavFrame(): void {
  navStats.frameCalls = 0
  navStats.frameMs = 0
}

/** QA / tuning */
export function setNavBudget(n: number): void {
  perFrame = Math.max(1, n)
}

/**
 * Claim a slot in this frame's path-query budget.
 *
 * A caller that is refused must keep the route it already has and try again
 * next frame — treating a refusal as "no route" would make an animal forget
 * where it was going, which is worse than an old path.
 */
export function takePathBudget(): boolean {
  if (navStats.frameCalls >= perFrame) { navStats.denied++; return false }
  return true
}

/** Waypoints from → to, or null when no route exists (or navmesh not ready). */
export function findPath(
  fx: number,
  fy: number,
  fz: number,
  tx: number,
  ty: number,
  tz: number,
): PathPoint[] | null {
  if (!query) return null
  const t0 = performance.now()
  navStats.calls++
  navStats.frameCalls++
  if (navStats.frameCalls > navStats.peakFrameCalls) navStats.peakFrameCalls = navStats.frameCalls
  try {
    return computeOne(fx, fy, fz, tx, ty, tz)
  } finally {
    const dt = performance.now() - t0
    navStats.ms += dt
    navStats.frameMs += dt
  }
}

function computeOne(
  fx: number,
  fy: number,
  fz: number,
  tx: number,
  ty: number,
  tz: number,
): PathPoint[] | null {
  const { success, path } = query!.computePath(
    { x: fx, y: fy, z: fz },
    { x: tx, y: ty, z: tz },
    { halfExtents: HALF_EXT },
  )
  if (!success || !path || path.length === 0) return null
  return path
}

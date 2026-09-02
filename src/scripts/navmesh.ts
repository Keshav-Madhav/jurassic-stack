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
  const { success, path } = query.computePath(
    { x: fx, y: fy, z: fz },
    { x: tx, y: ty, z: tz },
    { halfExtents: HALF_EXT },
  )
  if (!success || !path || path.length === 0) return null
  return path
}

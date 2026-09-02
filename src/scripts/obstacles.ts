// Coarse spatial hash of solid obstacle positions (tree trunks, rocks, ruin
// columns) for AI steering — physics colliders only stream near the player,
// but dinos everywhere need to know what not to walk through.
const CELL = 16
const cells = new Map<string, { x: number; z: number; r: number }[]>()

const keyOf = (x: number, z: number): string => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`

export function addObstacle(x: number, z: number, r: number): void {
  const key = keyOf(x, z)
  if (!cells.has(key)) cells.set(key, [])
  cells.get(key)!.push({ x, z, r })
}

/** Nearest obstacle within maxDist of (x, z), or null. */
export function nearestObstacle(
  x: number,
  z: number,
  maxDist: number,
): { x: number; z: number; d: number } | null {
  let best: { x: number; z: number; d: number } | null = null
  const cx = Math.floor(x / CELL)
  const cz = Math.floor(z / CELL)
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const list = cells.get(`${cx + dx},${cz + dz}`)
      if (!list) continue
      for (const o of list) {
        const d = Math.hypot(o.x - x, o.z - z) - o.r
        if (d < maxDist && (!best || d < best.d)) best = { x: o.x, z: o.z, d: Math.max(0, d) }
      }
    }
  }
  return best
}

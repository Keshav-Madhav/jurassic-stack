// Coarse spatial hash of solid obstacle positions (tree trunks, rocks, ruin
// columns) for AI steering — physics colliders only stream near the player,
// but dinos everywhere need to know what not to walk through.
//
// Numeric keys and a reused result: the string-keyed version built nine
// template strings per query, and every awake dino queries every frame —
// 2.3% of the CPU profile at the wood line (M25).
const CELL = 16
const HALF = 2048
const SIDE = Math.ceil((HALF * 2) / CELL) + 2
const cells: (Float32Array | null)[] = new Array(SIDE * SIDE).fill(null)
const counts = new Uint16Array(SIDE * SIDE)

const cellIndex = (x: number, z: number): number => {
  const cx = Math.floor((x + HALF) / CELL) + 1
  const cz = Math.floor((z + HALF) / CELL) + 1
  if (cx < 0 || cz < 0 || cx >= SIDE || cz >= SIDE) return -1
  return cz * SIDE + cx
}

export function addObstacle(x: number, z: number, r: number): void {
  const i = cellIndex(x, z)
  if (i < 0) return
  let arr = cells[i]
  const n = counts[i]
  if (!arr || n * 3 + 3 > arr.length) {
    const grown = new Float32Array(Math.max(12, (arr?.length ?? 0) * 2))
    if (arr) grown.set(arr)
    arr = cells[i] = grown
  }
  arr[n * 3] = x; arr[n * 3 + 1] = z; arr[n * 3 + 2] = r
  counts[i] = n + 1
}

const result = { x: 0, z: 0, d: 0 }

/** Nearest obstacle within maxDist of (x, z), or null. The returned object is REUSED across calls. */
export function nearestObstacle(x: number, z: number, maxDist: number): { x: number; z: number; d: number } | null {
  const c = cellIndex(x, z)
  if (c < 0) return null
  let bestD = Infinity
  let bx = 0, bz = 0
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const i = c + dz * SIDE + dx
      const n = counts[i]
      if (!n) continue
      const arr = cells[i]!
      for (let k = 0; k < n; k++) {
        const ox = arr[k * 3], oz = arr[k * 3 + 1]
        const d = Math.hypot(ox - x, oz - z) - arr[k * 3 + 2]
        if (d < maxDist && d < bestD) { bestD = d; bx = ox; bz = oz }
      }
    }
  }
  if (bestD === Infinity) return null
  result.x = bx; result.z = bz; result.d = Math.max(0, bestD)
  return result
}

// Reading the baked world in tools. heightmap.bin is int16 ROW-DELTA encoded
// (each cell stores its difference from the cell to its west; row starts are
// absolute): the same grid brotli-compresses ~30% smaller on the wire than
// raw heights, and decoding is one add per cell. Mirrors heightmap.ts.
import { readFileSync } from 'node:fs'

export function readWorld(dir = 'public/world') {
  const meta = JSON.parse(readFileSync(`${dir}/world-meta.json`, 'utf8'))
  const raw = readFileSync(`${dir}/heightmap.bin`)
  const grid = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
  if (meta.encoding === 'row-delta') decodeRowDelta(grid, meta.side)
  return { meta, grid }
}

export function decodeRowDelta(grid, side) {
  for (let z = 0; z < side; z++) {
    const row = z * side
    for (let x = 1; x < side; x++) grid[row + x] = (grid[row + x] + grid[row + x - 1]) | 0
  }
}

export function encodeRowDelta(grid, side) {
  const out = new Int16Array(grid.length)
  for (let z = 0; z < side; z++) {
    const row = z * side
    out[row] = grid[row]
    for (let x = 1; x < side; x++) out[row + x] = grid[row + x] - grid[row + x - 1]
  }
  return out
}

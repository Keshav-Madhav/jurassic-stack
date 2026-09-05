// Find flat, dry, open ground near a wished-for spot — for placing ruins by
// hand without guessing. node tools/site-finder.mjs <x> <z> [radius=150]
import { readWorld } from './world-io.mjs'
import { FORESTS, CLEARINGS, RIVER_PATHS, LAKES, shoreDist, distToPath } from './hand-geometry.mjs'
const [cx, cz, radius = 150] = process.argv.slice(2).map(Number)
const { meta, grid } = readWorld()
const { side, res, scale, half } = meta
const hAt = (x, z) => { const fx = (x + half) / res, fz = (z + half) / res; const ix = Math.max(0, Math.min(side - 2, Math.floor(fx))), iz = Math.max(0, Math.min(side - 2, Math.floor(fz))); const u = fx - ix, v = fz - iz; const i0 = iz * side + ix; return (grid[i0] * (1 - u) * (1 - v) + grid[i0 + 1] * u * (1 - v) + grid[i0 + side] * (1 - u) * v + grid[i0 + side + 1] * u * v) * scale }
const flat = (x, z, r = 12) => { let mn = Infinity, mx = -Infinity; for (let oz = -r; oz <= r; oz += 4) for (let ox = -r; ox <= r; ox += 4) { const h = hAt(x + ox, z + oz); mn = Math.min(mn, h); mx = Math.max(mx, h) } return mx - mn }
const inWood = (x, z) => FORESTS.some((f) => shoreDist(x, z, f.shore) < -10) && !CLEARINGS.some((c) => shoreDist(x, z, c) < -8)
const out = []
for (let z = cz - radius; z <= cz + radius; z += 6) for (let x = cx - radius; x <= cx + radius; x += 6) {
  const h = hAt(x, z); if (h < 1.6) continue
  const f = flat(x, z); if (f > 6) continue
  if (RIVER_PATHS.some((p) => distToPath(x, z, p).d < 45)) continue
  if (LAKES.some((l) => shoreDist(x, z, l.shore) < 22)) continue
  out.push({ x, z, h: +h.toFixed(1), flat: +f.toFixed(1), wood: inWood(x, z), d: Math.hypot(x - cx, z - cz) })
}
out.sort((a, b) => (a.wood ? 1 : 0) - (b.wood ? 1 : 0) || a.d - b.d)
console.log(out.slice(0, 5).map((o) => `(${o.x},${o.z}) h${o.h} flat${o.flat} ${o.wood ? 'IN WOOD (needs a glade)' : 'open'} ${o.d.toFixed(0)}m off`).join('\n') || 'nothing flat and dry here')

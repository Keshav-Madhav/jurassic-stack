// FOREST FITTING (M79): does a traced wood stand on ground a tree can hold?
//
// The bake reports the percentage; this shows the SHAPE, so a polygon can be
// re-traced against the actual plantable ground instead of guessed at. Same
// rule the bake validates with, read straight from the baked grid — no bake
// needed to iterate.
//   node tools/forest-fit.mjs                 report every wood
//   node tools/forest-fit.mjs <name>          + an ASCII map of that one
import { readFileSync } from 'node:fs'
import { FORESTS, VOLCANO, shoreDist } from './hand-geometry.mjs'
import { readWorld } from './world-io.mjs'

const { meta, grid } = readWorld()
const { side, res, scale, half } = meta
const hAt = (x, z) => {
  const fx = (x + half) / res, fz = (z + half) / res
  const ix = Math.max(0, Math.min(side - 2, Math.floor(fx))), iz = Math.max(0, Math.min(side - 2, Math.floor(fz)))
  const u = fx - ix, v = fz - iz, i0 = iz * side + ix
  return (grid[i0] * (1 - u) * (1 - v) + grid[i0 + 1] * u * (1 - v) + grid[i0 + side] * (1 - u) * v + grid[i0 + side + 1] * u * v) * scale
}
const capOf = (kind) => (kind === 'pine' ? 210 : kind === 'redwood' ? 1e9 : 130)

/** the bake's own test, cell for cell */
export function plantable(x, z, cap) {
  const h = hAt(x, z)
  if (h <= 6) return { ok: false, why: 'wet' }
  const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z)
  if (dv < 300 || (dv < 700 && h > 60)) return { ok: false, why: 'ash' }
  if (h > cap) return { ok: false, why: 'high' }
  const e = 2
  const gx = (hAt(x + e, z) - hAt(x - e, z)) / (2 * e)
  const gz = (hAt(x, z + e) - hAt(x, z - e)) / (2 * e)
  if (1 / Math.sqrt(1 + gx * gx + gz * gz) < 0.72) return { ok: false, why: 'steep' }
  return { ok: true, why: '' }
}

export function score(shore, kind, step = 8) {
  const xs = shore.map((p) => p[0]), zs = shore.map((p) => p[1])
  const cap = capOf(kind)
  const tally = { ok: 0, steep: 0, high: 0, ash: 0, wet: 0, n: 0 }
  for (let z = Math.min(...zs); z <= Math.max(...zs); z += step) {
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
      if (shoreDist(x, z, shore) >= 0) continue
      tally.n++
      const r = plantable(x, z, cap)
      if (r.ok) tally.ok++
      else tally[r.why]++
    }
  }
  return tally
}

const want = String(process.argv[2] ?? '').startsWith('--') ? null : process.argv[2]
console.log('wood                 kind        cells  plantable   steep   >line    ash')
for (const f of FORESTS) {
  const t = score(f.shore, f.kind)
  const pct = (v) => String(Math.round((v / t.n) * 100)).padStart(4) + '%'
  const flag = t.ok / t.n < 0.75 ? '  <-- under 75%' : ''
  console.log(`${f.name.padEnd(20)} ${f.kind.padEnd(10)} ${String(t.n).padStart(6)}  ${pct(t.ok)}   ${pct(t.steep)}  ${pct(t.high)}  ${pct(t.ash)}${flag}`)
}

if (want) {
  const f = FORESTS.find((q) => q.name === want)
  if (!f) { console.error(`no wood called ${want}`); process.exit(1) }
  const xs = f.shore.map((p) => p[0]), zs = f.shore.map((p) => p[1])
  const x0 = Math.min(...xs) - 80, x1 = Math.max(...xs) + 80
  const z0 = Math.min(...zs) - 80, z1 = Math.max(...zs) + 80
  const cap = capOf(f.kind)
  const SX = Math.max(8, Math.round((x1 - x0) / 110 / 2) * 2)
  const SZ = SX * 2
  console.log(`\n${f.name}: ${SX} m per column, ${SZ} m per row`)
  console.log('  # plantable · s too steep · ^ over the line · a volcanic ash · ~ wet · space outside the trace')
  let hdr = '        '
  for (let x = x0; x <= x1; x += SX) hdr += String(Math.abs(Math.round(x / 100)) % 10)
  console.log(hdr)
  for (let z = z0; z <= z1; z += SZ) {
    let row = String(Math.round(z)).padStart(6) + '  '
    for (let x = x0; x <= x1; x += SX) {
      if (shoreDist(x, z, f.shore) >= 0) { row += ' '; continue }
      const r = plantable(x, z, cap)
      row += r.ok ? '#' : r.why === 'steep' ? 's' : r.why === 'high' ? '^' : r.why === 'ash' ? 'a' : '~'
    }
    console.log(row)
  }
}

// --- `--ribbon <name> [rowStep] [pad]` ---------------------------------
// Walks the wood's bounding box row by row, finds the widest CONTIGUOUS run
// of plantable ground in each, and prints those runs as a closed polygon:
// down the left edge, back up the right. A starting trace to hand-adjust,
// not a generated answer — the vertices still get read and edited.
if (process.argv[2] === '--ribbon') {
  const name = process.argv[3]
  const ROW = Number(process.argv[4] ?? 60)
  const PAD = Number(process.argv[5] ?? 10)
  const f = FORESTS.find((q) => q.name === name)
  if (!f) { console.error(`no wood called ${name}`); process.exit(1) }
  const xs = f.shore.map((p) => p[0]), zs = f.shore.map((p) => p[1])
  const x0 = Math.min(...xs) - 60, x1 = Math.max(...xs) + 60
  const cap = capOf(f.kind)
  const left = [], right = []
  for (let z = Math.min(...zs); z <= Math.max(...zs); z += ROW) {
    let bestA = null, bestB = null, a = null
    for (let x = x0; x <= x1; x += 8) {
      const ok = plantable(x, z, cap).ok
      if (ok && a === null) a = x
      if ((!ok || x + 8 > x1) && a !== null) {
        const b = x
        if (bestA === null || b - a > bestB - bestA) { bestA = a; bestB = b }
        a = null
      }
    }
    if (bestA === null || bestB - bestA < 90) continue
    left.push([Math.round(bestA + PAD), Math.round(z)])
    right.push([Math.round(bestB - PAD), Math.round(z)])
  }
  const poly = [...left, ...right.reverse()]
  console.log(`\n// ${name}: ribbon over the plantable band, ${poly.length} vertices`)
  console.log('shore: [' + poly.map(([x, z]) => `[${x}, ${z}]`).join(', ') + '],')
  console.log('\nscored:', JSON.stringify(score(poly, f.kind)))
}

// --- `--runs <name> [rowStep] [minRun]` -------------------------------
// Every contiguous plantable run in each row, not just the widest — a range
// has a flank on BOTH sides of its crest and the widest-run view hides one.
if (process.argv[2] === '--runs') {
  const name = process.argv[3]
  const ROW = Number(process.argv[4] ?? 80)
  const MIN = Number(process.argv[5] ?? 80)
  const f = FORESTS.find((q) => q.name === name)
  if (!f) { console.error(`no wood called ${name}`); process.exit(1) }
  const xs = f.shore.map((p) => p[0]), zs = f.shore.map((p) => p[1])
  const x0 = Math.min(...xs) - 120, x1 = Math.max(...xs) + 120
  const cap = capOf(f.kind)
  console.log(`\n${name}: plantable runs per row (x from ${Math.round(x0)} to ${Math.round(x1)})`)
  for (let z = Math.min(...zs); z <= Math.max(...zs); z += ROW) {
    const runs = []
    let a = null
    for (let x = x0; x <= x1; x += 8) {
      const ok = plantable(x, z, cap).ok
      if (ok && a === null) a = x
      if ((!ok || x + 8 > x1) && a !== null) { if (x - a >= MIN) runs.push([Math.round(a), Math.round(x)]); a = null }
    }
    console.log(`  z=${String(Math.round(z)).padStart(5)}  ${runs.map(([p, q]) => `[${p}..${q}]`).join('  ') || '—'}`)
  }
}

// --- `--try '<json shore>' <kind>` ------------------------------------
// Score a candidate trace before it goes anywhere near the bake.
if (process.argv[2] === '--try') {
  const shore = JSON.parse(process.argv[3])
  const kind = process.argv[4] ?? 'pine'
  const t = score(shore, kind)
  const pct = (v) => Math.round((v / t.n) * 100) + '%'
  console.log(`${t.n} cells · plantable ${pct(t.ok)} · steep ${pct(t.steep)} · over the line ${pct(t.high)} · ash ${pct(t.ash)} · wet ${pct(t.wet)}`)
}

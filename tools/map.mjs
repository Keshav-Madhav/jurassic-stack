// The planning map: a top-down, coordinate-gridded chart of the baked island
// with every piece of hand geometry drawn on it — the sheet you trace new
// polygons against (forest lines, swamp edge, clearings…), then re-run to see
// them in place.
//   node tools/map.mjs [out.png] [--region x0,z0,x1,z1] [--ppm 1] [--sketch]
//     --region  world-metre window (default whole island)
//     --ppm     pixels per metre (default 0.5 → 2048 px for the 4 km canvas; 2-3 for zooms)
//     --sketch  draw only the hand geometry on a blank grid (no bake needed)
// Output PNG via sips (macOS). Grid every 100 m, heavy every 500 m, labelled.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { FORESTS, CLEARINGS, COAST, RANGES, HOLM, RIVER, LAKES, SPAWN, VOLCANO, HALF as HAND_HALF, shoreDist, closedPath } from './hand-geometry.mjs'
import { readWorld } from './world-io.mjs'

const args = process.argv.slice(2)
const out = args.find((a) => !a.startsWith('--')) ?? 'shots/planning-map.png'
const regionArg = args[args.indexOf('--region') + 1]
const sketch = args.includes('--sketch') || !existsSync('public/world/heightmap.bin')
const ppm = args.includes('--ppm') ? Number(args[args.indexOf('--ppm') + 1]) : 0.5
const world = sketch ? null : readWorld()
const meta = sketch
  ? { side: 0, res: 2, scale: 0.02, half: HAND_HALF, sea: 0, spawn: SPAWN, volcano: VOLCANO, lakes: LAKES, rivers: RIVER.parts.map(closedPath), ruinSites: [] }
  : world.meta
const H = sketch ? null : world.grid
const B = sketch ? null : new Uint8Array(readFileSync('public/world/biomes.bin').buffer.slice(0))
const { side, res, scale, half, sea } = meta
const [x0, z0, x1, z1] = regionArg && args.includes('--region') ? regionArg.split(',').map(Number) : [-half, -half, half, half]
const W = Math.round((x1 - x0) * ppm)
const Hh = Math.round((z1 - z0) * ppm)

const hAt = (x, z) => {
  const fx = (x + half) / res, fz = (z + half) / res
  const ix = Math.max(0, Math.min(side - 2, Math.floor(fx)))
  const iz = Math.max(0, Math.min(side - 2, Math.floor(fz)))
  const u = fx - ix, v = fz - iz
  const i0 = iz * side + ix
  return (H[i0] * (1 - u) * (1 - v) + H[i0 + 1] * u * (1 - v) + H[i0 + side] * (1 - u) * v + H[i0 + side + 1] * u * v) * scale
}
const bAt = (x, z) => {
  const ix = Math.round((x + half) / res), iz = Math.round((z + half) / res)
  if (ix < 0 || iz < 0 || ix >= side || iz >= side) return 0
  return B[iz * side + ix]
}

// ---------- raster ----------
const px = new Float32Array(W * Hh * 3)
const put = (i, j, r, g, b, a = 1) => {
  if (i < 0 || j < 0 || i >= W || j >= Hh) return
  const o = (j * W + i) * 3
  px[o] = px[o] * (1 - a) + r * a
  px[o + 1] = px[o + 1] * (1 - a) + g * a
  px[o + 2] = px[o + 2] * (1 - a) + b * a
}
const toPx = (x, z) => [Math.round((x - x0) * ppm), Math.round((z - z0) * ppm)]
const lerp = (a, b, t) => a + (b - a) * t

// terrain: hypsometric tint × hillshade, water, sand line, biome tint
// (sketch mode: sea outside the traced coast, parchment inside)
for (let j = 0; j < Hh; j++) {
  for (let i = 0; i < W; i++) {
    const x = x0 + i / ppm, z = z0 + j / ppm
    if (sketch) {
      const inland = shoreDist(x, z, COAST) < 0
      put(i, j, inland ? 214 : 120, inland ? 205 : 170, inland ? 170 : 210)
      continue
    }
    const h = hAt(x, z)
    let r, g, b
    if (h < sea) {
      const d = Math.min(1, -h / 20)
      r = lerp(120, 30, d); g = lerp(170, 70, d); b = lerp(210, 140, d)
    } else {
      const gx = hAt(x + 2, z) - hAt(x - 2, z)
      const gz = hAt(x, z + 2) - hAt(x, z - 2)
      const shade = Math.max(0, Math.min(1, 0.55 - (gx * -0.6 + gz * -0.8) * 0.09))
      // low = pale green, 40 m = olive, 90 m = brown, 150 m+ = grey → white
      if (h < 40) { const t = h / 40; r = lerp(190, 160, t); g = lerp(210, 175, t); b = lerp(150, 105, t) }
      else if (h < 90) { const t = (h - 40) / 50; r = lerp(160, 150, t); g = lerp(175, 120, t); b = lerp(105, 80, t) }
      else if (h < 150) { const t = (h - 90) / 60; r = lerp(150, 165, t); g = lerp(120, 165, t); b = lerp(80, 165, t) }
      else { const t = Math.min(1, (h - 150) / 60); r = lerp(165, 245, t); g = lerp(165, 245, t); b = lerp(165, 250, t) }
      const k = 0.55 + shade * 0.9
      r *= k; g *= k; b *= k
      if (h < sea + 1.2) { r = 225; g = 210; b = 160 }
      const bio = bAt(x, z)
      if (bio === 1) { r = lerp(r, 40, 0.35); g = lerp(g, 120, 0.35); b = lerp(b, 110, 0.35) }
      else if (bio === 2) { r = lerp(r, 230, 0.4); g = lerp(g, 190, 0.4); b = lerp(b, 110, 0.4) }
      else if (bio === 3) { r = lerp(r, 210, 0.3); g = lerp(g, 220, 0.3); b = lerp(b, 120, 0.3) }
    }
    put(i, j, r, g, b)
  }
}

// polygon fill (signed-distance test per pixel inside the bbox) + outline
function fillPoly(poly, r, g, b, a) {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1])
  const [i0, j0] = toPx(Math.min(...xs), Math.min(...zs))
  const [i1, j1] = toPx(Math.max(...xs), Math.max(...zs))
  for (let j = Math.max(0, j0); j <= Math.min(Hh - 1, j1); j++) {
    for (let i = Math.max(0, i0); i <= Math.min(W - 1, i1); i++) {
      if (shoreDist(x0 + i / ppm, z0 + j / ppm, poly) < 0) put(i, j, r, g, b, a)
    }
  }
}
function line(xa, za, xb, zb, r, g, b, w = 1, a = 1) {
  const [ia, ja] = toPx(xa, za)
  const [ib, jb] = toPx(xb, zb)
  const n = Math.max(1, Math.ceil(Math.hypot(ib - ia, jb - ja)))
  for (let s = 0; s <= n; s++) {
    const i = Math.round(lerp(ia, ib, s / n)), j = Math.round(lerp(ja, jb, s / n))
    for (let dj = -Math.floor(w / 2); dj <= Math.floor(w / 2); dj++) {
      for (let di = -Math.floor(w / 2); di <= Math.floor(w / 2); di++) put(i + di, j + dj, r, g, b, a)
    }
  }
}
function outline(poly, r, g, b, w = 2) {
  for (let i = 0; i < poly.length; i++) {
    const [xa, za] = poly[i], [xb, zb] = poly[(i + 1) % poly.length]
    line(xa, za, xb, zb, r, g, b, w)
  }
  for (const [vx, vz] of poly) dot(vx, vz, r, g, b, 3) // the vertices themselves
}
function dot(x, z, r, g, b, rad = 4) {
  const [i, j] = toPx(x, z)
  for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) if (di * di + dj * dj <= rad * rad) put(i + di, j + dj, r, g, b)
}

// 3×5 glyphs for grid labels
const FONT = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'], '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '001', '001', '001'], '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'], '-': ['000', '000', '111', '000', '000'], ' ': ['000', '000', '000', '000', '000'],
}
function text(i, j, str, r, g, b, s = 2) {
  for (const ch of String(str)) {
    const gl = FONT[ch] ?? FONT[' ']
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (gl[y][x] === '1') for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) put(i + x * s + dx, j + y * s + dy, r, g, b)
    i += 4 * s
  }
}

// forests (drawn first so water and grid stay legible on top)
const FOREST_RGB = { broadleaf: [20, 110, 30], pine: [10, 70, 60], mixed: [60, 100, 20] }
for (const f of FORESTS) {
  const [r, g, b] = FOREST_RGB[f.kind] ?? [20, 110, 30]
  fillPoly(f.shore, r, g, b, 0.45 * (f.density ?? 1))
  outline(f.shore, r * 0.5, g * 0.5, b * 0.5, 2)
}
for (const c of CLEARINGS) {
  fillPoly(c, 235, 225, 120, 0.55)
  outline(c, 160, 130, 20, 2)
}
// the coast line, the Holm plateau line, the range crests with their heights
outline(COAST, 40, 30, 20, 3)
outline(HOLM, 120, 80, 20, 2)
for (const r of RANGES) {
  for (let i = 0; i < r.crest.length - 1; i++) line(r.crest[i].x, r.crest[i].z, r.crest[i + 1].x, r.crest[i + 1].z, 90, 40, 40, 4)
  for (const v of r.crest) {
    dot(v.x, v.z, 90, 40, 40, 5)
    const [i, j] = toPx(v.x, v.z)
    text(i + 8, j - 6, v.h, 60, 20, 20, Math.max(2, Math.round(ppm * 3)))
  }
}
// lakes + rivers
for (const lake of meta.lakes) {
  fillPoly(lake.shore, 70, 140, 220, 0.9)
  outline(lake.shore, 20, 60, 140, 2)
}
for (const part of RIVER.parts) {
  const path = closedPath(part)
  const w = Math.max(3, part.halfWidth * 2 * ppm)
  for (let i = 0; i < path.length - 1; i++) line(path[i].x, path[i].z, path[i + 1].x, path[i + 1].z, part.flow ? 60 : 90, part.flow ? 120 : 150, 230, w)
  for (const p of part.path) dot(p.x, p.z, 20, 60, 140, 3)
  if (part.ford) dot(part.ford.x, part.ford.z, 230, 200, 90, 6)
}
// grid
for (let g = Math.ceil(x0 / 100) * 100; g <= x1; g += 100) {
  const heavy = g % 500 === 0
  line(g, z0, g, z1, 0, 0, 0, heavy ? 2 : 1, heavy ? 0.55 : 0.22)
  const [i] = toPx(g, 0)
  text(i + 3, 3, g, 0, 0, 0, Math.max(2, Math.round(ppm * 3)))
}
for (let g = Math.ceil(z0 / 100) * 100; g <= z1; g += 100) {
  const heavy = g % 500 === 0
  line(x0, g, x1, g, 0, 0, 0, heavy ? 2 : 1, heavy ? 0.55 : 0.22)
  const [, j] = toPx(0, g)
  text(3, j + 3, g, 0, 0, 0, Math.max(2, Math.round(ppm * 3)))
}
// markers
dot(meta.spawn.x, meta.spawn.z, 255, 0, 200, 6)
dot(meta.volcano.x, meta.volcano.z, 255, 40, 0, 6)
for (const s of meta.ruinSites) dot(s.x, s.z, 255, 230, 0, 5)

// ---------- BMP → PNG ----------
const rowPad = (4 - ((W * 3) % 4)) % 4
const dataSize = (W * 3 + rowPad) * Hh
const buf = Buffer.alloc(54 + dataSize)
buf.write('BM'); buf.writeUInt32LE(54 + dataSize, 2); buf.writeUInt32LE(54, 10)
buf.writeUInt32LE(40, 14); buf.writeInt32LE(W, 18); buf.writeInt32LE(Hh, 22)
buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(dataSize, 34)
let o = 54
for (let j = Hh - 1; j >= 0; j--) {
  for (let i = 0; i < W; i++) {
    const p = (j * W + i) * 3
    buf[o++] = Math.max(0, Math.min(255, px[p + 2])); buf[o++] = Math.max(0, Math.min(255, px[p + 1])); buf[o++] = Math.max(0, Math.min(255, px[p]))
  }
  o += rowPad
}
mkdirSync('shots', { recursive: true })
const bmp = out.replace(/\.png$/, '.bmp')
writeFileSync(bmp, buf)
execSync(`sips -s format png "${bmp}" --out "${out}" >/dev/null 2>&1 && rm -f "${bmp}"`)
console.log(`${out}  (${W}×${Hh}px, ${ppm} px/m, region ${x0},${z0} → ${x1},${z1})`)

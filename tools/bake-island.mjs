// The island bake: hand geometry → composition → carve → erosion → validation
// → committed artifacts.  node tools/bake-island.mjs
//
// Deterministic (seeded). Outputs:
//   public/world/heightmap.bin   int16 heights (scale 0.02), 2049×2049 @ 2 m
//   public/world/world-meta.json grid params, spawn/volcano, river parts, lakes, ruins…
//   public/world/biomes.bin      one byte per cell: 0 default 1 swamp 2 desert 3 plains 4 alpine
//   public/world/forest.bin      one byte per cell: density<<2 | kind
//   shots/island-hillshade.bmp   top-down hillshade for eyeball QA
//
// Everything with a shape is TRACED in tools/hand-geometry.mjs (the coast,
// the ranges' crests, the river, the lakes, the forests) — PLAN.md → "The
// island v2 — the Lasso". This file only decides how the drawn lines become
// ground: how the coast falls to the sea, how a crest becomes a massif, how a
// river path becomes a bed, and then lets erosion age it.
import { writeFileSync, mkdirSync } from 'node:fs'
import {
  HALF, SPAWN, VOLCANO, COAST, RANGES, HOLM, SHELVES, RIVER, RIVER_PATHS, LAKES, FALLS, FORESTS, CLEARINGS, RUINS, BIOMES, RAVINE, CAVES,
  shoreDist, distToPath, closedPath,
} from './hand-geometry.mjs'
import { encodeRowDelta } from './world-io.mjs'
// `node tools/bake-island.mjs --no-lakes aster,tarn` bakes WITHOUT the named
// basins so their ground can be probed before a level is chosen
const noLakes = process.argv.includes('--no-lakes') ? process.argv[process.argv.indexOf('--no-lakes') + 1].split(',') : []
const LAKES_ACTIVE = LAKES.filter((l) => !noLakes.includes(l.name))

const RES = 2
const SIDE = HALF * 2 / RES + 1 // 2049
const SEA = 0
const SCALE = 0.02 // int16 → ±655 m at 2 cm; the ranges pass 400 m

// ---------- deterministic rng + noise ----------
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const perm = new Uint8Array(512)
{
  const r = mulberry32(1337)
  const p = [...Array(256).keys()]
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
const grad = (h, x, y) => ((h & 1 ? -x : x) + (h & 2 ? -y : y))
function noise2(x, y) {
  const X = Math.floor(x) & 255
  const Y = Math.floor(y) & 255
  x -= Math.floor(x); y -= Math.floor(y)
  const u = fade(x), v = fade(y)
  const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1]
  const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1]
  const l = (a, b, t) => a + t * (b - a)
  return l(l(grad(aa, x, y), grad(ba, x - 1, y), u), l(grad(ab, x, y - 1), grad(bb, x - 1, y - 1), u), v)
}
function fbm(x, y, octaves = 6, lac = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq)
    norm += amp
    amp *= gain; freq *= lac
  }
  return sum / norm
}
const smoothstep = (a, b, t) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)))
  return u * u * (3 - 2 * u)
}
const lerp = (a, b, t) => a + (b - a) * t

const H = new Float32Array(SIDE * SIDE)
const idx = (ix, iz) => iz * SIDE + ix
const worldX = (ix) => -HALF + ix * RES
const worldZ = (iz) => -HALF + iz * RES
const hAt = (x, z) => {
  const fx = (x + HALF) / RES, fz = (z + HALF) / RES
  const ix = Math.max(0, Math.min(SIDE - 2, Math.floor(fx)))
  const iz = Math.max(0, Math.min(SIDE - 2, Math.floor(fz)))
  const u = fx - ix, v = fz - iz
  return H[idx(ix, iz)] * (1 - u) * (1 - v) + H[idx(ix + 1, iz)] * u * (1 - v) +
    H[idx(ix, iz + 1)] * (1 - u) * v + H[idx(ix + 1, iz + 1)] * u * v
}

// ---------- coarse signed-distance fields for the big polygons ----------
// shoreDist against the 100-vertex coast per 2 m cell is 400M ops; an 8 m
// field sampled bilinearly is plenty for 100 m+ falloffs.
function sdfField(poly, step) {
  const n = Math.floor(HALF * 2 / step) + 1
  const f = new Float32Array(n * n)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) f[j * n + i] = shoreDist(-HALF + i * step, -HALF + j * step, poly)
  return (x, z) => {
    const fx = Math.max(0, Math.min(n - 1.001, (x + HALF) / step))
    const fz = Math.max(0, Math.min(n - 1.001, (z + HALF) / step))
    const i = Math.floor(fx), j = Math.floor(fz)
    const u = fx - i, v = fz - j
    return f[j * n + i] * (1 - u) * (1 - v) + f[j * n + i + 1] * u * (1 - v) + f[(j + 1) * n + i] * (1 - u) * v + f[(j + 1) * n + i + 1] * u * v
  }
}
console.time('sdf')
const coastSD = sdfField(COAST, 8)
const holmSD = sdfField(HOLM, 8)
console.timeEnd('sdf')

// ---- biomes: traced polygons (tools/hand-geometry.mjs); sampled through
// coarse SDF fields like the coast ----
const SWAMP = BIOMES.find((b) => b.name === 'swamp')
const biomeSD = BIOMES.map((b) => sdfField(b.shore, 8))

// ---------- composition ----------
console.time('compose')
for (let iz = 0; iz < SIDE; iz++) {
  for (let ix = 0; ix < SIDE; ix++) {
    const x = worldX(ix), z = worldZ(iz)
    const sd = coastSD(x, z) // negative inland
    const inland = -sd

    // base: domain-warped FBM hills
    const wx = x + 220 * fbm(x * 0.0009 + 40, z * 0.0009 - 17, 3)
    const wz = z + 220 * fbm(x * 0.0009 - 31, z * 0.0009 + 23, 3)
    // (amplitude kept under the plateau: the interior floor must stay above
    // the Knot's water level so the inflow always has somewhere to run down to)
    let h = 12 * fbm(wx * 0.0014, wz * 0.0014, 6)
    h += 5 * fbm(x * 0.008, z * 0.008, 4)
    h += 4 * fbm(x * 0.004 + 7, z * 0.004 - 3, 4)

    // the interior is held above the sea from the coast inward: a broad
    // tableland the whole water story is carved into
    h += 32 * smoothstep(80, 520, inland)
    // MOUNDS: positive-only billows (200–500 m across, up to 18 m) — variety
    // on top of the tableland without lowering the floor the river needs
    h += 18 * Math.pow(Math.max(0, fbm(x * 0.0032 + 9, z * 0.0032 - 4, 4)), 1.4) * smoothstep(60, 300, inland)
    // the long rise north toward the volcano's foot
    h += Math.max(0, -z - 200) * 0.01

    // THE BEACH BAND: inside the traced coast the land eases to a low sandy
    // shore that dips to the waterline exactly AT the line (so the shoreline
    // is where it was drawn); ranges are added after this, so where a crest
    // meets the coast the sea gets cliffs, not sand
    if (inland < 110) {
      const beachT = 1 - smoothstep(30, 110, inland) // 1 at and beyond the line
      const target = lerp(1.7, 2.9 + 0.5 * fbm(x * 0.02, z * 0.02, 2), smoothstep(-5, 45, inland))
      // full easing at the line itself (a 5% residual of a 30 m base pushed
      // the waterline 70 m out to sea), 95% a little inland
      h = lerp(h, target, beachT * lerp(1, 0.95, smoothstep(0, 40, inland)))
    }

    // THE RANGES: a massif around each traced crest and a sharp ridge on it.
    // Every crest vertex is a PEAK — the skyline dips into a saddle between
    // neighbours — and a slow lateral warp turns the flanks into spurs and
    // side valleys instead of a slab.
    for (const range of RANGES) {
      const rr = distToPath(x, z, range.crest)
      if (rr.d > range.width * 2.2) continue
      const hA = range.crest[rr.seg].h
      const hB = range.crest[Math.min(rr.seg + 1, range.crest.length - 1)].h
      const crestH = lerp(hA, hB, rr.t) - 0.2 * Math.min(hA, hB) * Math.sin(rr.t * Math.PI)
      const dWarp = rr.d + 90 * fbm(x * 0.0028 + 31, z * 0.0028 - 13, 3) + 22 * fbm(x * 0.009 + 3, z * 0.009 + 8, 2)
      const W = range.width
      if (range.soft) {
        // foothills: a rolling massif, no sharp crest, no scree
        h += 0.9 * crestH * Math.exp(-(dWarp * dWarp) / (2 * (W * 0.55) * (W * 0.55)))
        continue
      }
      // A ROUNDED CREST, NOT A KNIFE EDGE (M75, user: "a natural less steep
      // smoother mountain but the same max height, just smoother, less
      // spiky, gentler"). The second term used to be exp(-|d|/…), whose
      // derivative is discontinuous at the crest — that cusp IS the spike.
      // Both terms are Gaussians now and they still sum to 1.0 × crestH at
      // d = 0, so every summit keeps the height its crest vertex asks for.
      // The widths are chosen so the pair carries about the SAME MASS as the
      // old massif+cusp did — a Gaussian of sigma s has area 2.5s and an
      // exponential of length L has area 2L, so a straight swap at equal
      // peak height inflates the whole mountain (first cut: 412 m → 431 m,
      // and four ruin sites lost their flat ground to the new bulk).
      h += 0.435 * crestH * Math.exp(-(dWarp * dWarp) / (2 * (W * 0.62) * (W * 0.62))) // massif
      h += 0.605 * crestH * Math.exp(-(dWarp * dWarp) / (2 * (W * 0.15) * (W * 0.15))) // the crest itself
      const alt = smoothstep(90, 180, h)
      // long swells instead of scree: 2.3× the wavelength and half the
      // octaves, because FREQUENCY is what sets the slope. The amplitude
      // comes DOWN from 22 to 17 even so — a 2-octave fbm has fewer
      // cancelling components than a 4-octave one and so reaches nearer its
      // full ±1, which quietly added 7 m to the island's summit
      h += 17 * alt * fbm(x * 0.013 + 5, z * 0.013 - 9, 2)
    }

    // THE VOLCANO: angular radius modulation breaks the cone, radial ridges
    // gully the flanks, a raised rim reads from the spawn beach 2.8 km away
    {
      const dvx = x - VOLCANO.x
      const dvz = z - VOLCANO.z
      const vAng = Math.atan2(dvz, dvx)
      const radMod = 1 + 0.13 * Math.sin(vAng * 5 + 1.3) + 0.07 * Math.sin(vAng * 9 - 0.6)
      const dv = Math.hypot(dvx, dvz) / radMod
      const cone = Math.max(0, 1 - dv / 540)
      h += 330 * cone * cone
      h += 40 * Math.exp(-(dv * dv) / (2 * 130 * 130))
      h += 14 * Math.sin(vAng * 12 + 0.7) * cone * cone * smoothstep(60, 150, dv) // flank ridges
      h += 22 * Math.exp(-((dv - 86) * (dv - 86)) / (2 * 16 * 16)) // crater rim lip
      h -= 150 * Math.exp(-(dv * dv) / (2 * 68 * 68)) // the caldera dish
      // THE ESCARPMENT: a 52 m cliff band ringing the cone at ~280 m — the
      // cone's own flank never passed 47° and the caldera door could be
      // walked around up any side of the mountain (user, M19). The ring is
      // the only way in: the Ravine cuts through the band, the gate-wall
      // shelf flattens it where the door stands
      h += 52 * smoothstep(298, 268, dv)
      // two ridgelines radiating south-east and south-west from the cone
      for (const ang of [0.75, -0.75]) {
        const rx = VOLCANO.x + Math.sin(ang) * 760
        const rz = VOLCANO.z + Math.cos(ang) * 760
        const { d } = distToPath(x, z, [{ x: VOLCANO.x, z: VOLCANO.z }, { x: rx, z: rz }])
        h += 18 * Math.exp(-(d * d) / (2 * 130 * 130)) * smoothstep(1400, 500, Math.hypot(dvx, dvz))
      }
    }

    // SHELVES: hand-cut benches in the mountains (the Tarn's cirque)
    for (const sh of SHELVES) {
      const sd = shoreDist(x, z, sh.shore)
      const edge = sh.edge ?? 40
      if (sd > edge) continue
      const t = smoothstep(edge, -edge * 0.35, sd)
      h = lerp(h, sh.h + 1.5 * fbm(x * 0.02, z * 0.02, 2), t)
    }

    // THE CAVES: a bowl sunk into a hillside, with a throat down from the
    // mouth. The roof is a mesh (caves.ts) — a heightmap has no overhangs —
    // but the floor, the walls and the way in are all terrain (M51).
    for (const cv of CAVES) {
      const cx = cv.mouth.x + cv.into.x * cv.reach
      const cz = cv.mouth.z + cv.into.z * cv.reach
      const dCh = Math.hypot(x - cx, z - cz)
      const mouthH = cv.mouthY
      const floor = cv.floorY
      if (dCh < cv.radius + 26) {
        // the chamber: a flat floor, its rim blended into the hill
        const t = smoothstep(cv.radius + 22, cv.radius * 0.55, dCh)
        h = lerp(h, floor, t)
      }
      // the throat: a ramp from the mouth down into the chamber
      const { d: dTh, t: along, seg: segTh } = distToPath(x, z, [
        { x: cv.mouth.x - cv.into.x * 12, z: cv.mouth.z - cv.into.z * 12 },
        { x: cx, z: cz },
      ])
      if (dTh < 20) {
        void segTh
        const want = lerp(mouthH + 0.4, floor, smoothstep(0.05, 0.85, along ?? 0))
        h = lerp(h, want, smoothstep(20, 7, dTh))
      }
    }

    // THE GATE-WALL'S BACK: the 104 m shelf the door is set into must not be
    // a landing you can walk off onto the cone — its north edge rises 52 m
    // into the mountain as a cliff (the escarpment band is flattened under it)
    if (Math.abs(x) < 120 && z < -996) h += 52 * smoothstep(-996, -1022, z) * smoothstep(120, 96, Math.abs(x))

    // THE HOLM: the plateau the ring is cut into — held at ~20 m so the ring,
    // the Reservoir and the Knot are carved INTO ground
    {
      const t = smoothstep(120, -30, holmSD(x, z))
      if (t > 0) {
        const hold = 20 + 5 * fbm(x * 0.006, z * 0.006, 3)
        h = lerp(h, Math.max(h, hold), t)
      }
    }

    // BIOME FLOORS: inside each traced edge the ground eases to the biome's
    // floor over `edge` metres — the swamp a low wet basin with pools, the
    // desert a dune flat, the plain a grassy shelf. Never cuts into a range
    // (the old desert disc sliced the West Range into a wall), never climbs
    // onto the Holm.
    for (let bi = 0; bi < BIOMES.length; bi++) {
      const b = BIOMES[bi]
      if (b.floor === null) continue
      const sd = biomeSD[bi](x, z)
      if (sd > 0) continue
      let w = smoothstep(0, -b.edge, sd) * smoothstep(90, 45, h)
      if (b.name === 'swamp') w *= smoothstep(-20, 140, holmSD(x, z))
      if (w <= 0.01) continue
      let floor = b.floor
      if (b.name === 'swamp') floor -= Math.max(0, fbm(x * 0.02 + 11, z * 0.02 - 5, 3)) * 2.6 // pools under the table
      else if (b.name === 'desert') floor += 2.2 * fbm(x * 0.012 + 3, z * 0.012 + 9, 3) + 0.7 * Math.sin(x * 0.045 + z * 0.02) // dunes
      else floor += 1.4 * fbm(x * 0.01 - 7, z * 0.01 + 2, 3)
      h = h * (1 - w) + floor * w
    }

    // THE SEA: outside the traced coast the ground falls to the sea floor
    if (sd > 0) {
      const seaT = smoothstep(-20, 240, sd) // no flat start: the water line is ~15 m off the drawn line
      const floor = -14 - 12 * smoothstep(240, 800, sd)
      h = lerp(h, floor, seaT)
    }

    // the spawn beach apron: calm and dry, wins over everything else — on
    // LAND; it stops at the drawn coast so the bay stays where it was traced
    const ds = Math.hypot(x - SPAWN.x, z - SPAWN.z)
    if (ds < 600 && sd < 20) {
      const beach = Math.exp(-(ds * ds) / (2 * 230 * 230)) * 0.92 * smoothstep(20, -40, sd)
      h = h * (1 - beach) + 3.0 * beach
    }

    H[idx(ix, iz)] = h
  }
}
console.timeEnd('compose')

// ---------- standing water: carve the traced basins ----------
// Depth grows from the drawn shore toward the hand-picked deep point up to the
// lake's `depth`; banks slope in over a 14 m band outside the shoreline.
// Carve-only: ground is never raised, so a lake sits IN the land (no donut).
console.time('lakes')
for (const lake of LAKES_ACTIVE) {
  {
    let mn = Infinity, mx = -Infinity
    for (const [vx, vz] of lake.shore) {
      const h = hAt(vx, vz)
      mn = Math.min(mn, h); mx = Math.max(mx, h)
    }
    console.log(`  lake ${lake.name}: shore terrain ${mn.toFixed(1)}..${mx.toFixed(1)} (level ${lake.level})`)
  }
  const xs = lake.shore.map((p) => p[0]), zs = lake.shore.map((p) => p[1])
  const ix0 = Math.max(0, Math.floor((Math.min(...xs) - 20 + HALF) / RES)), ix1 = Math.min(SIDE - 1, Math.ceil((Math.max(...xs) + 20 + HALF) / RES))
  const iz0 = Math.max(0, Math.floor((Math.min(...zs) - 20 + HALF) / RES)), iz1 = Math.min(SIDE - 1, Math.ceil((Math.max(...zs) + 20 + HALF) / RES))
  const depthMax = lake.depth ?? 6
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const x = worldX(ix), z = worldZ(iz)
      const sd = shoreDist(x, z, lake.shore)
      if (sd > 14) continue
      const i0 = idx(ix, iz)
      if (sd > 0) {
        const t = 1 - sd / 14
        const bankTarget = lake.level + 0.4 + sd * 0.35
        if (H[i0] > bankTarget) H[i0] = H[i0] * (1 - t * 0.85) + bankTarget * (t * 0.85)
      } else {
        const dDeep = Math.hypot(x - lake.deep.x, z - lake.deep.z)
        const shoreT = Math.min(1, -sd / 26)
        const deepT = Math.max(0, 1 - dDeep / 120)
        const depth = 1.2 + shoreT * depthMax * 0.55 + deepT * depthMax * 0.45
        const target = lake.level - depth
        if (H[i0] > target) H[i0] = target
      }
    }
  }
}
console.timeEnd('lakes')

// ---------- THE LASSO: carve the river's three parts ----------
// Bed profiles per part: the ring is LEVEL (dead water at the Knot's level);
// the legs are monotonic downhill from their start to their end, following the
// terrain 3.5 m under it but never rising. The inflow must arrive at the Knot
// exactly at the ring's bed, so its tail is bent onto it.
console.time('rivers')
const RING_BED = RIVER.level - 3.6
const BED_UNDER = 3.5
const wellspring = LAKES.find((l) => l.name === 'wellspring')
const inStandingWater = (x, z) => LAKES_ACTIVE.some((l) => shoreDist(x, z, l.shore) < 0)
const RIVER_BEDS = RIVER.parts.map((part) => {
  const path = closedPath(part)
  if (!part.flow) return path.map(() => RING_BED)
  const beds = []
  const startsAtKnot = Math.hypot(path[0].x - RIVER.knot.x, path[0].z - RIVER.knot.z) < 1
  // a leg either drops out of the ring, or out of the standing water it names
  // (`source`), or — the original inflow — out of the Wellspring by default
  const from = part.source ? LAKES.find((l) => l.name === part.source) : wellspring
  let prev = startsAtKnot ? RING_BED : (from ? from.level - 2.4 : Infinity)
  for (let i = 0; i < path.length; i++) {
    // points inside standing water (the pool, the Reservoir) read the carved
    // basin, not the bank — they don't constrain the profile
    const under = part.cut ?? BED_UNDER
    const terrain = inStandingWater(path[i].x, path[i].z) ? Infinity : hAt(path[i].x, path[i].z) - under
    let bed = i === 0 ? Math.min(prev, terrain) : Math.min(terrain, prev - 0.5)
    // floor: through the swamp the river runs at the marsh's water table
    // (one sheet, not a trench under it); to the sea it may dig to -2.5
    const inSwamp = SWAMP && shoreDist(path[i].x, path[i].z, SWAMP.shore) < 60
    bed = Math.max(bed, inSwamp ? SWAMP.level - 1.25 : -2.5)
    bed = Math.min(bed, prev)
    beds.push(bed)
    prev = bed
  }
  // a leg that ENDS at the Knot bends onto the ring's bed over its last third
  const endsAtKnot = Math.hypot(path[path.length - 1].x - RIVER.knot.x, path[path.length - 1].z - RIVER.knot.z) < 1
  if (endsAtKnot) {
    const n = beds.length
    for (let i = 0; i < n; i++) {
      const tail = smoothstep(0.62, 1, i / (n - 1))
      if (tail > 0) beds[i] = Math.min(beds[i], lerp(beds[i], RING_BED, tail))
    }
    for (let i = 1; i < n; i++) beds[i] = Math.min(beds[i], beds[i - 1]) // still monotonic
  }
  return beds
})
for (const [i, part] of RIVER.parts.entries()) {
  const b = RIVER_BEDS[i]
  const path = RIVER_PATHS[i]
  console.log(`  ${part.name}: bed ${b[0].toFixed(1)} → ${b[b.length - 1].toFixed(1)} m over ${b.length} points`)
  if (part.flow) console.log(`    terrain along: ${path.map((p) => hAt(p.x, p.z).toFixed(0)).join(' ')}`)
}
for (let iz = 0; iz < SIDE; iz++) {
  for (let ix = 0; ix < SIDE; ix++) {
    const x = worldX(ix), z = worldZ(iz)
    if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < 300) continue // never carve the cone
    for (let ri = 0; ri < RIVER.parts.length; ri++) {
      const part = RIVER.parts[ri]
      const path = RIVER_PATHS[ri]
      const { d, seg, t } = distToPath(x, z, path)
      const hw = part.halfWidth
      if (d > hw * 9) continue
      const beds = RIVER_BEDS[ri]
      const bed = beds[seg] * (1 - t) + beds[Math.min(seg + 1, beds.length - 1)] * t
      const frac = (seg + t) / (path.length - 1)
      const canyon = !!part.canyon && frac > part.canyon[0] && frac < part.canyon[1]
      // `slot`: a gorge, not a valley — steep walls right up to the bed and
      // no shoulder at all. The Wellspring's spill crosses a shelf that is
      // nearly level with the pool, and the ordinary 1.7-sigma bell spread a
      // 3 m cut over 40 m of ground: a damp smear, not a channel you can see
      const sigma = part.slot ? hw * 1.05 : canyon ? hw * 1.2 : hw * 1.7
      const wBed = Math.exp(-(d * d) / (2 * sigma * sigma))
      const wValley = (part.slot ? 0.1 : canyon ? 0.15 : 0.35) * Math.exp(-(d * d) / (2 * (hw * 5.5) * (hw * 5.5)))
      const i0 = idx(ix, iz)
      const target = Math.min(H[i0], bed)
      H[i0] = H[i0] * (1 - wBed) + target * wBed - wValley * 2.0
      if (canyon) {
        H[i0] += 7 * Math.exp(-((d - hw * 2.4) * (d - hw * 2.4)) / (2 * 10 * 10)) // rim lift
      } else if (!part.slot && d < hw * 3.6) {
        // bank cap: where a bend cuts through a hill the walls soften instead
        // of towering — banks cap ~5 m over the bed (the ring keeps a firm
        // 6 m moat wall into the Holm plateau). FEATHERED at its outer edge:
        // a hard stop left a 10 m step around every channel that no path
        // could climb (navmesh reachability caught it)
        const cap = bed + (part.flow ? 5 : 6)
        if (H[i0] > cap) {
          const capT = smoothstep(hw * 3.6, hw * 2.4, d)
          H[i0] = lerp(H[i0], cap + (H[i0] - cap) * 0.35, capT)
        }
      }
    }
  }
}
// THE LEVEE: the ring is dead water held at the Knot's level, and its south
// end leaves the Holm plateau for the plains, which sit 1–3 m UNDER that
// level — the carve never raised anything, so the water sheet floated over
// the low bank and dinos grazed on a dry trench beside a wall of water (user
// screenshots 21–22, M19). Standing water must be held by its banks: within
// 2.4 half-widths the ground rises to the level + 0.7 and feathers out.
function containRing() {
  for (let ri = 0; ri < RIVER.parts.length; ri++) {
    const part = RIVER.parts[ri]
    if (part.flow) continue
    const path = RIVER_PATHS[ri]
    const hw = part.halfWidth
    const level = RIVER.level
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const x = worldX(ix), z = worldZ(iz)
        const { d } = distToPath(x, z, path)
        if (d < hw * 0.65 || d > hw * 2.6) continue
        if (LAKES_ACTIVE.some((l) => shoreDist(x, z, l.shore) < 4)) continue // not into the Reservoir
        if (RIVER.parts.some((p, j) => p.flow && distToPath(x, z, RIVER_PATHS[j]).d < p.halfWidth * 1.6)) continue // the legs cross the ring
        const i0 = idx(ix, iz)
        // a wading shore (level −1.5 at 0.7 hw) rising to the crest (level +0.7
        // at 1.2 hw), then feathering back into whatever the land was
        const crest = level - 1.5 + 2.2 * smoothstep(hw * 0.7, hw * 1.2, d)
        const bank = lerp(crest, H[i0], smoothstep(hw * 1.25, hw * 2.6, d))
        if (H[i0] < bank) H[i0] = bank
      }
    }
  }
}
containRing()

// THE FORD: a gravel bar across the ring on its far side, knee-deep
for (const part of RIVER.parts) {
  if (!part.ford) continue
  const path = closedPath(part)
  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const x = worldX(ix), z = worldZ(iz)
      const df = Math.hypot(x - part.ford.x, z - part.ford.z)
      if (df > 34) continue
      const { d } = distToPath(x, z, path)
      if (d > part.halfWidth * 2.2) continue
      const t = 1 - smoothstep(22, 34, df)
      const bar = RIVER.level - 0.7 - 0.25 * smoothstep(0, part.halfWidth, d)
      const i0 = idx(ix, iz)
      if (H[i0] < bar) H[i0] = lerp(H[i0], bar, t)
    }
  }
}
// THE PLUNGE POOLS: a fall scours a basin at its foot. Carved with the river
// (so erosion can soften the rim) and re-asserted after it (so droplets can't
// silt it back up), exactly as the Ravine's floor and the cave chambers are.
function carveFalls() {
  for (const f of FALLS) {
    const pl = f.plunge
    if (!pl) continue
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const x = worldX(ix), z = worldZ(iz)
        const d = Math.hypot(x - pl.x, z - pl.z)
        if (d > pl.r) continue
        const i0 = idx(ix, iz)
        const bowl = lerp(pl.floor, H[i0], smoothstep(pl.r * 0.35, pl.r, d))
        if (H[i0] > bowl) H[i0] = bowl
      }
    }
  }
  // AND HOLD THE LIP. Droplets cut hardest where a channel meets a hole, and
  // once the pool was there erosion took the lip from 29.5 m down to 24.8 —
  // the sheet would have started five metres inside the rock. The river
  // re-assert can only ever LOWER a bed, so it cannot undo this; the lip is
  // asserted here, and only on its inland side so the cliff face is never
  // rebuilt.
  for (const f of FALLS) {
    if (!f.spill) continue
    const si = RIVER.parts.findIndex((p) => p.name === f.spill)
    if (si < 0) continue
    const beds = RIVER_BEDS[si]
    const bed = beds[beds.length - 1]
    const hw = RIVER.parts[si].halfWidth
    const al = Math.hypot(f.aim.x, f.aim.z) || 1
    const ax = f.aim.x / al, az = f.aim.z / al
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const x = worldX(ix), z = worldZ(iz)
        const dx = x - f.lip.x, dz = z - f.lip.z
        if (dx * ax + dz * az > 1) continue // seaward of the lip: that is the fall
        const d = Math.hypot(dx, dz)
        if (d > hw) continue
        const i0 = idx(ix, iz)
        if (H[i0] < bed) H[i0] = lerp(bed, H[i0], smoothstep(hw * 0.5, hw, d))
      }
    }
  }
}
carveFalls()
console.timeEnd('rivers')

// ---------- THE RAVINE: a slot up the volcano's flank into the crater ----------
// Cut before erosion (so the walls weather like the rest of the cone) and
// re-laid after it (`assert`): 100 m walls shed talus into a 14 m slot, and
// droplets gullied the floor into steps the navmesh wouldn't climb.
const RAVINE_CUM = [0]
for (let i = 1; i < RAVINE.path.length; i++) RAVINE_CUM.push(RAVINE_CUM[i - 1] + Math.hypot(RAVINE.path[i].x - RAVINE.path[i - 1].x, RAVINE.path[i].z - RAVINE.path[i - 1].z))
function ravineFloorAt(seg, t) {
  const along = (RAVINE_CUM[seg] + (RAVINE_CUM[Math.min(seg + 1, RAVINE_CUM.length - 1)] - RAVINE_CUM[seg]) * t) / RAVINE_CUM[RAVINE_CUM.length - 1]
  return lerp(RAVINE.floorStart, RAVINE.floorEnd, smoothstep(0, 1, along) * 0.35 + along * 0.65)
}
function ravineAlong(seg, t) {
  return (RAVINE_CUM[seg] + (RAVINE_CUM[Math.min(seg + 1, RAVINE_CUM.length - 1)] - RAVINE_CUM[seg]) * t) / RAVINE_CUM[RAVINE_CUM.length - 1]
}
/** the slot's half-width: a 6.5 m THROAT for the first ~30 m so the rock meets
 *  the gate arch's piers (13 m wide), then the full width */
function ravineHalfWidth(along) {
  return lerp(RAVINE.throatHalfWidth ?? RAVINE.halfWidth, RAVINE.halfWidth, smoothstep(0.075, 0.14, along))
}
function carveRavine(assert) {
  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const x = worldX(ix), z = worldZ(iz)
      const { d, seg, t } = distToPath(x, z, RAVINE.path)
      if (d > 60) continue
      const hw = ravineHalfWidth(ravineAlong(seg, t))
      const floor = ravineFloorAt(seg, t)
      const i0 = idx(ix, iz)
      // flat slot floor, then a steep wall up to wherever the mountain already is
      const cap = d < hw ? floor : floor + (d - hw) * RAVINE.wallSlope
      if (H[i0] > cap) H[i0] = cap
      // after erosion the floor is LAID, not just capped — talus and silt out
      if (assert && d < hw + 2) H[i0] = lerp(floor, H[i0], smoothstep(hw - 1, hw + 2, d))
    }
  }
}
console.time('ravine')
carveRavine(false)
console.timeEnd('ravine')


// ---------- sculpt: rock bands on the ranges and the canyon walls ----------
console.time('sculpt')
{
  const terrace = (h, step, sharp) => {
    const t = h / step
    const f = t - Math.floor(t)
    const shaped = Math.pow(f, sharp) / (Math.pow(f, sharp) + Math.pow(1 - f, sharp))
    return (Math.floor(t) + shaped) * step
  }
  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const x = worldX(ix), z = worldZ(iz)
      const i0 = idx(ix, iz)
      let h = H[i0]
      for (const range of RANGES) {
        if (range.soft) continue // foothills stay rolling
        const rr = distToPath(x, z, range.crest)
        if (rr.d < range.width * 0.6 && h > 40) {
          // 14 m steps at sharpness 3.2 are near-vertical risers, and the
          // navmesh's walkableClimb is ONE metre — this pass alone turned
          // every flank into a staircase nothing could climb (M74). Shorter
          // bands, rounded, and mixed in more gently: still the "terraced
          // rock bands" PLAN asks for, no longer a wall every 14 m.
          const w = smoothstep(range.width * 0.6, range.width * 0.25, rr.d) * 0.8
          h = h * (1 - w) + terrace(h, 8, 1.7) * w
        }
      }
      for (let ri = 0; ri < RIVER.parts.length; ri++) {
        const part = RIVER.parts[ri]
        if (!part.canyon) continue
        const path = RIVER_PATHS[ri]
        const { d, seg, t } = distToPath(x, z, path)
        const frac = (seg + t) / (path.length - 1)
        if (frac > part.canyon[0] && frac < part.canyon[1] && d > 16 && d < 64 && h > 6) {
          const w = smoothstep(64, 34, d) * 0.75
          h = h * (1 - w) + terrace(h, 7, 3.4) * w
        }
      }
      H[i0] = h
    }
  }
}
console.timeEnd('sculpt')

// ---------- hydraulic erosion (droplet method) ----------
console.time('erosion')
{
  const rand = mulberry32(9001)
  const DROPS = 880_000 // 4× the 2 km bake — same droplets per hectare
  const INERTIA = 0.05
  const CAPACITY = 3.2
  const DEPOSIT = 0.3
  const ERODE = 0.25
  const EVAP = 0.02
  const RADIUS = 2
  const MIN_SLOPE = 0.01
  const gradientAt = (fx, fz) => {
    const ix = Math.max(0, Math.min(SIDE - 2, Math.floor(fx)))
    const iz = Math.max(0, Math.min(SIDE - 2, Math.floor(fz)))
    const u = fx - ix, v = fz - iz
    const h00 = H[idx(ix, iz)], h10 = H[idx(ix + 1, iz)]
    const h01 = H[idx(ix, iz + 1)], h11 = H[idx(ix + 1, iz + 1)]
    return {
      gx: (h10 - h00) * (1 - v) + (h11 - h01) * v,
      gz: (h01 - h00) * (1 - u) + (h11 - h10) * u,
      h: h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v,
    }
  }
  let wsum = 0
  for (let bz = -RADIUS; bz <= RADIUS; bz++) for (let bx = -RADIUS; bx <= RADIUS; bx++) wsum += Math.max(0, RADIUS - Math.hypot(bx, bz))
  for (let n = 0; n < DROPS; n++) {
    let fx = rand() * (SIDE - 1)
    let fz = rand() * (SIDE - 1)
    let dx = 0, dz = 0, speed = 1, water = 1, sediment = 0
    for (let step = 0; step < 40; step++) {
      const { gx, gz, h } = gradientAt(fx, fz)
      dx = dx * INERTIA - gx * (1 - INERTIA)
      dz = dz * INERTIA - gz * (1 - INERTIA)
      const len = Math.hypot(dx, dz)
      if (len < 1e-6) break
      dx /= len; dz /= len
      const nfx = fx + dx, nfz = fz + dz
      if (nfx < 1 || nfz < 1 || nfx >= SIDE - 2 || nfz >= SIDE - 2) break
      const nh = gradientAt(nfx, nfz).h
      const dh = nh - h
      const capacity = Math.max(-dh, MIN_SLOPE) * speed * water * CAPACITY
      if (sediment > capacity || dh > 0) {
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * DEPOSIT
        sediment -= amount
        const ix = Math.floor(fx), iz = Math.floor(fz)
        const u = fx - ix, v = fz - iz
        H[idx(ix, iz)] += amount * (1 - u) * (1 - v)
        H[idx(ix + 1, iz)] += amount * u * (1 - v)
        H[idx(ix, iz + 1)] += amount * (1 - u) * v
        H[idx(ix + 1, iz + 1)] += amount * u * v
      } else {
        const amount = Math.min((capacity - sediment) * ERODE, -dh)
        const cx = Math.floor(fx), cz = Math.floor(fz)
        for (let bz = -RADIUS; bz <= RADIUS; bz++) {
          for (let bx = -RADIUS; bx <= RADIUS; bx++) {
            const px = cx + bx, pz = cz + bz
            if (px < 0 || pz < 0 || px >= SIDE || pz >= SIDE) continue
            const w = Math.max(0, RADIUS - Math.hypot(bx, bz)) / wsum
            H[idx(px, pz)] -= amount * w
          }
        }
        sediment += amount
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * -9.81 * 0.05))
      water *= 1 - EVAP
      fx = nfx; fz = nfz
      if (water < 0.01) break
    }
  }
}
console.timeEnd('erosion')

// ---------- thermal erosion (talus relaxation) ----------
console.time('thermal')
{
  // FROM A SNAPSHOT (M75). This read and wrote H in the same sweep, so a
  // cell's second neighbour saw a height its first neighbour had already
  // changed — an unstable diffusion that RAISED the roughness it exists to
  // remove (measured: 57.8% of cells above 100 m over talus before it, 64.5%
  // after). Reading last pass's heights and applying the deltas at the end
  // makes it the relaxation it always claimed to be.
  const TALUS = 0.72 * RES
  const src = new Float32Array(H.length)
  const add = new Float32Array(H.length)
  for (let pass = 0; pass < 3; pass++) {
    src.set(H)
    add.fill(0)
    for (let iz = 1; iz < SIDE - 1; iz++) {
      for (let ix = 1; ix < SIDE - 1; ix++) {
        const i = idx(ix, iz)
        const h = src[i]
        for (const j of [i + 1, i + SIDE]) {
          const d = h - src[j]
          if (Math.abs(d) > TALUS) {
            const move = (Math.abs(d) - TALUS) * 0.25 * Math.sign(d)
            add[i] -= move
            add[j] += move
          }
        }
      }
    }
    for (let i = 0; i < H.length; i++) H[i] += add[i]
  }
}
console.timeEnd('thermal')

// ---------- THE RANGES RELAX (M75) ----------
// Widening the crest smooths the SILHOUETTE but adds volume, and volume puts
// more of the map on mountainside: at sigma 0.32W the peaks looked right and
// three pine woods went above the treeline. Talus relaxation is the other
// lever and the honest one — it conserves mass, so it smooths without
// inflating anything, and it reduces steepness by construction.
//
// Musgrave's scheme, from a SNAPSHOT each pass: move half the worst excess
// over the talus angle, shared among the downhill neighbours in proportion
// to their drop. Masked to the ranges, because a global relaxation would
// also eat the features that are deliberately vertical — the caldera
// escarpment that seals the crater, the Ravine's walls, and the Wellspring
// bluff the M72 waterfall falls down.
console.time('relax')
{
  const TALUS = 0.72 * RES
  const mask = new Uint8Array(SIDE * SIDE)
  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const x = worldX(ix), z = worldZ(iz)
      if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < 900) continue
      for (const range of RANGES) {
        if (range.soft) continue
        if (distToPath(x, z, range.crest).d < range.width * 2.2) { mask[idx(ix, iz)] = 1; break }
      }
    }
  }
  const src = new Float32Array(H.length)
  const add = new Float32Array(H.length)
  for (let pass = 0; pass < 90; pass++) {
    src.set(H); add.fill(0)
    let moved = 0
    for (let iz = 1; iz < SIDE - 1; iz++) {
      for (let ix = 1; ix < SIDE - 1; ix++) {
        const i = idx(ix, iz)
        if (!mask[i]) continue
        const h = src[i]
        const nb = [i - 1, i + 1, i - SIDE, i + SIDE]
        let total = 0, worst = 0
        const ex = [0, 0, 0, 0]
        for (let k = 0; k < 4; k++) {
          const d = h - src[nb[k]] - TALUS
          if (d > 0) { ex[k] = d; total += d; if (d > worst) worst = d }
        }
        if (total <= 0) continue
        const give = 0.5 * worst
        add[i] -= give
        for (let k = 0; k < 4; k++) if (ex[k] > 0) add[nb[k]] += give * (ex[k] / total)
        moved += give
      }
    }
    for (let i = 0; i < H.length; i++) H[i] += add[i]
    if (moved < 150) { console.log(`  relax: settled after ${pass + 1} passes`); break }
  }
}
console.timeEnd('relax')


// micro-detail baked into the grid (a runtime detail term desynced props from
// LOD-rendered terrain — everything floated)
for (let iz = 0; iz < SIDE; iz++) {
  for (let ix = 0; ix < SIDE; ix++) {
    const x = worldX(ix), z = worldZ(iz)
    const i0 = idx(ix, iz)
    const b = H[i0]
    const detail =
      0.22 * Math.sin(x * 0.71 + z * 0.53) * Math.cos(x * 0.47 - z * 0.66) +
      0.13 * Math.sin(x * 1.63 - z * 1.31) * Math.cos(x * 1.19 + z * 1.7)
    const fadeD = Math.min(1, Math.max(0, (b - 1.2) / 1.4))
    H[i0] = b + detail * fadeD
  }
}

// ---------- post-erosion re-asserts ----------
console.time('reassert')
// standing water containment: erosion can gully a rim cell below the level —
// nudge only those cells (cm-scale) just above it; river corridors stay open
for (const lake of LAKES_ACTIVE) {
  const xs = lake.shore.map((p) => p[0]), zs = lake.shore.map((p) => p[1])
  const ix0 = Math.max(0, Math.floor((Math.min(...xs) - 20 + HALF) / RES)), ix1 = Math.min(SIDE - 1, Math.ceil((Math.max(...xs) + 20 + HALF) / RES))
  const iz0 = Math.max(0, Math.floor((Math.min(...zs) - 20 + HALF) / RES)), iz1 = Math.min(SIDE - 1, Math.ceil((Math.max(...zs) + 20 + HALF) / RES))
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const x = worldX(ix), z = worldZ(iz)
      const sd = shoreDist(x, z, lake.shore)
      if (sd < 1 || sd > 16) continue
      if (RIVER_PATHS.some((p) => distToPath(x, z, p).d < 30)) continue
      const i0 = idx(ix, iz)
      if (H[i0] < lake.level + 0.25) H[i0] = lake.level + 0.25
    }
  }
}
// river beds: droplets silt the channels to wading depth — re-cut them, and
// re-lay the ford's bar
for (let iz = 0; iz < SIDE; iz++) {
  for (let ix = 0; ix < SIDE; ix++) {
    const x = worldX(ix), z = worldZ(iz)
    for (let ri = 0; ri < RIVER.parts.length; ri++) {
      const part = RIVER.parts[ri]
      const { d, seg, t } = distToPath(x, z, RIVER_PATHS[ri])
      if (d > part.halfWidth) continue
      const beds = RIVER_BEDS[ri]
      let bed = beds[seg] * (1 - t) + beds[Math.min(seg + 1, beds.length - 1)] * t
      if (part.ford) {
        const df = Math.hypot(x - part.ford.x, z - part.ford.z)
        if (df < 34) bed = Math.max(bed, lerp(bed, RIVER.level - 0.7 - 0.25 * smoothstep(0, part.halfWidth, d), 1 - smoothstep(22, 34, df)))
      }
      const i0 = idx(ix, iz)
      const w = Math.exp(-(d * d) / (2 * (part.halfWidth * 0.55) * (part.halfWidth * 0.55)))
      H[i0] = Math.min(H[i0], bed * w + H[i0] * (1 - w) + 0.001)
      if (part.ford && Math.hypot(x - part.ford.x, z - part.ford.z) < 22 && H[i0] < bed - 0.05) H[i0] = bed
      // the ring's floor is a moat, not a canyon: droplets pouring into the
      // Reservoir gully it — lift anything more than 2.5 m under the bed
      if (!part.flow && H[i0] < bed - 2.5) H[i0] = lerp(H[i0], bed - 2.5, w)
    }
  }
}
containRing() // droplets gully the levee too
// the sea: 880K droplets carry sediment to the shore and build a beach out
// past the drawn coast — cap the sea floor to its designed profile so the
// waterline stays where it was traced (deposits may only deepen, never fill)
for (let iz = 0; iz < SIDE; iz++) {
  for (let ix = 0; ix < SIDE; ix++) {
    const x = worldX(ix), z = worldZ(iz)
    const sd = coastSD(x, z)
    if (sd <= 0) continue
    const profile = lerp(1.7, -14 - 12 * smoothstep(240, 800, sd), smoothstep(-20, 240, sd))
    const i0 = idx(ix, iz)
    if (H[i0] > profile) H[i0] = profile
  }
}
// the beach band: no puddles — erosion and the baked ripple dip the sand
// under the sea plane in spots and the ocean shows through as blue speckle
for (let iz = 0; iz < SIDE; iz++) {
  for (let ix = 0; ix < SIDE; ix++) {
    const x = worldX(ix), z = worldZ(iz)
    const inland = -coastSD(x, z)
    if (inland < -2 || inland > 90) continue
    const i0 = idx(ix, iz)
    // (high enough that a coarse-LOD chunk's interpolation between a sea-floor
    // vertex and a beach vertex can't dip under the sea plane inland)
    const floorH = lerp(1.5, 2.2, smoothstep(0, 60, inland))
    if (H[i0] < floorH && !RIVER_PATHS.some((p) => distToPath(x, z, p).d < 40)) H[i0] = floorH
  }
}
// the Ravine's floor and the crater bench: re-laid (see carveRavine)
carveRavine(true)
carveFalls() // and the plunge pools
// AND THE CAVES. Erosion fills a carved bowl the way it fills any hollow —
// the first bake asked for a 139 m floor and got 146 back (M51). A cave you
// cannot stand up in is not a cave, so the chamber floor and the throat are
// asserted again here, exactly as the Ravine's floor is.
for (const cv of CAVES) {
  const cx = cv.mouth.x + cv.into.x * cv.reach
  const cz = cv.mouth.z + cv.into.z * cv.reach
  const throat = [
    { x: cv.mouth.x - cv.into.x * 12, z: cv.mouth.z - cv.into.z * 12 },
    { x: cx, z: cz },
  ]
  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const x = worldX(ix), z = worldZ(iz)
      const dCh = Math.hypot(x - cx, z - cz)
      const { d: dTh, t: along } = distToPath(x, z, throat)
      if (dCh > cv.radius + 24 && dTh > 20) continue
      const i0 = idx(ix, iz)
      let want = null
      if (dCh < cv.radius + 22) {
        const t = smoothstep(cv.radius + 22, cv.radius * 0.55, dCh)
        want = lerp(H[i0], cv.floorY, t)
      }
      if (dTh < 20) {
        const ramp = lerp(cv.mouthY + 0.4, cv.floorY, smoothstep(0.05, 0.85, along ?? 0))
        const t2 = smoothstep(20, 7, dTh)
        want = want === null ? lerp(H[i0], ramp, t2) : Math.min(want, lerp(H[i0], ramp, t2))
      }
      if (want !== null) H[i0] = want
    }
  }
}
{
  const crater = SHELVES.find((sh) => sh.name === 'crater')
  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const x = worldX(ix), z = worldZ(iz)
      const sd = shoreDist(x, z, crater.shore)
      if (sd > 6) continue
      const i0 = idx(ix, iz)
      const bench = crater.h + 1.5 * fbm(x * 0.02, z * 0.02, 2)
      // silt from the rim piles on the bench: shave it back down to the bench
      const t = smoothstep(6, -6, sd)
      if (H[i0] > bench + 0.3) H[i0] = lerp(H[i0], bench + 0.3, t)
    }
  }
}
// the spawn beach (droplets gully everything)
for (let iz = 0; iz < SIDE; iz++) {
  for (let ix = 0; ix < SIDE; ix++) {
    const x = worldX(ix), z = worldZ(iz)
    const ds = Math.hypot(x - SPAWN.x, z - SPAWN.z)
    if (ds > 400) continue
    const w = Math.exp(-(ds * ds) / (2 * 190 * 190)) * 0.9 * smoothstep(20, -40, coastSD(x, z))
    H[idx(ix, iz)] = H[idx(ix, iz)] * (1 - w) + 3.0 * w
  }
}
console.timeEnd('reassert')

// ---------- forest map ----------
// one byte per grid cell — density (0..63) in the high six bits, kind in the
// low two (0 broadleaf · 1 pine · 2 mixed · 3 redwood). Density is the hand
// polygon's fullness feathered to zero over its `edge` metres inside the wood
// line; clearings punch feathered holes. Runtime scatter/colors read this.
console.time('forest')
const KIND_ID = { broadleaf: 0, pine: 1, mixed: 2, redwood: 3 }
const forest = new Uint8Array(SIDE * SIDE)
{
  let cells = 0
  for (const f of FORESTS) {
    const xs = f.shore.map((p) => p[0]), zs = f.shore.map((p) => p[1])
    const ix0 = Math.max(0, Math.floor((Math.min(...xs) + HALF) / RES)), ix1 = Math.min(SIDE - 1, Math.ceil((Math.max(...xs) + HALF) / RES))
    const iz0 = Math.max(0, Math.floor((Math.min(...zs) + HALF) / RES)), iz1 = Math.min(SIDE - 1, Math.ceil((Math.max(...zs) + HALF) / RES))
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = worldX(ix), z = worldZ(iz)
        const sd = shoreDist(x, z, f.shore)
        if (sd >= 0) continue
        let d = f.density * smoothstep(0, -(f.edge ?? 40), sd)
        for (const c of CLEARINGS) {
          const cd = shoreDist(x, z, c)
          if (cd < 15) d *= Math.max(0, cd) / 15
        }
        // the open biomes stay open: a wood polygon drawn over the plain or the
        // dunes thins to nothing inside them (feathered over 60 m)
        for (let bi = 0; bi < BIOMES.length; bi++) {
          if (BIOMES[bi].name !== 'plains' && BIOMES[bi].name !== 'desert') continue
          d *= smoothstep(-60, 0, biomeSD[bi](x, z))
        }
        const i0 = idx(ix, iz)
        if (d * 63 > (forest[i0] >> 2)) {
          if (forest[i0] === 0 && d > 0.02) cells++
          forest[i0] = (Math.round(Math.min(1, d) * 63) << 2) | (KIND_ID[f.kind] ?? 0)
        }
      }
    }
  }
  // COPSES in the open country: where a slow noise peaks, the open land grows
  // a thicket (density ~0.4) — so woods blend into fields through scattered
  // clumps instead of stopping at a line. Not on beaches, not in the open
  // biomes, not on the cone; pines north of the volcano's latitude, else broadleaf.
  {
    const isOpenBiome = (x, z) => BIOMES.some((b, bi) => (b.name === 'plains' || b.name === 'desert') && biomeSD[bi](x, z) < 20)
    let copse = 0
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const i0 = idx(ix, iz)
        if (forest[i0] >> 2 > 3) continue
        const x = worldX(ix), z = worldZ(iz)
        const h = H[i0]
        if (h < 4 || h > 150 || coastSD(x, z) > -120) continue
        if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < 620) continue
        if (isOpenBiome(x, z)) continue
        const n = fbm(x * 0.0055 + 17, z * 0.0055 + 3, 3)
        const d = 0.42 * smoothstep(0.22, 0.5, n)
        if (d < 0.05) continue
        forest[i0] = (Math.round(d * 63) << 2) | (z < -900 ? KIND_ID.pine : KIND_ID.broadleaf)
        copse++
      }
    }
    console.log(`  forest: ${FORESTS.length} woods, ${CLEARINGS.length} glades, ${((cells * RES * RES) / 1e6).toFixed(2)} km² wooded + ${((copse * RES * RES) / 1e6).toFixed(2)} km² of copses`)
    // CAN THIS WOOD ACTUALLY HOLD TREES? (M73)
    // The forest polygons are hand-traced as shapes on a map. The rules that
    // decide whether a tree may STAND somewhere — the 0.72 normal floor, the
    // pine treeline at 210 m, the volcano's bare skirt — were written
    // separately in scatter.ts, and nothing ever checked the two against each
    // other. Measured: `horns-pines` is 42% inside the cone's ash exclusion,
    // `range-pines-west` is 47% too steep and 21% above the treeline. Four
    // named woods are less than two-thirds plantable and one is half.
    // This does not redraw anyone's hand geometry — the trace is the author's
    // (the hand-made mandate). It puts the number on screen at bake time and
    // fails only a wood that is mostly unplantable, which none is today.
    for (const f of FORESTS) {
      const xs = f.shore.map((p) => p[0]), zs = f.shore.map((p) => p[1])
      let n = 0, plant = 0, steep = 0, high = 0, ash = 0
      const cap = f.kind === 'pine' ? 210 : f.kind === 'redwood' ? 1e9 : 130
      for (let z = Math.min(...zs); z <= Math.max(...zs); z += 10) {
        for (let x = Math.min(...xs); x <= Math.max(...xs); x += 10) {
          if (shoreDist(x, z, f.shore) >= 0) continue
          n++
          const h = hAt(x, z)
          const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z)
          const isAsh = dv < 300 || (dv < 700 && h > 60)
          // the same normal the scatter tests, from the same grid
          const e = 2
          const gx = (hAt(x + e, z) - hAt(x - e, z)) / (2 * e)
          const gz = (hAt(x, z + e) - hAt(x, z - e)) / (2 * e)
          const isSteep = 1 / Math.sqrt(1 + gx * gx + gz * gz) < 0.72
          const isHigh = h > cap
          if (isAsh) ash++
          if (isSteep) steep++
          if (isHigh) high++
          if (!isAsh && !isSteep && !isHigh && h > 6) plant++
        }
      }
      const pct = (v) => Math.round((v / n) * 100)
      if (pct(plant) < 75) {
        console.log(`    ${f.name}: only ${pct(plant)}% of it can hold a tree (${pct(steep)}% too steep, ${pct(high)}% over the ${cap} m line, ${pct(ash)}% volcanic ash)`)
      }
      if (pct(plant) < 35) {
        console.error(`VALIDATOR FAIL: forest ${f.name} is ${pct(plant)}% plantable — that polygon is drawn over ground no tree can stand on`)
        process.exitCode = 1
      }
    }
  }
}
const forestDensityAt = (x, z) => (forest[idx(Math.round((x + HALF) / RES), Math.round((z + HALF) / RES))] >> 2) / 63
console.timeEnd('forest')

// ---------- ruin sites: hand-placed (tools/hand-geometry.mjs), asserted here ----------
const flatness = (x, z, r = 12) => {
  let mn = Infinity, mx = -Infinity
  for (let oz = -r; oz <= r; oz += 4) {
    for (let ox = -r; ox <= r; ox += 4) {
      const h = hAt(x + ox, z + oz)
      mn = Math.min(mn, h); mx = Math.max(mx, h)
    }
  }
  return mx - mn
}
const RUIN_SITES = RUINS.map((r) => ({ tag: r.tag, x: r.x, z: r.z, y: +hAt(r.x, r.z).toFixed(1), keystone: !!r.keystone, layout: r.layout ?? null }))
for (const site of RUIN_SITES) {
  const h = hAt(site.x, site.z)
  const f = flatness(site.x, site.z)
  const river = Math.min(...RIVER_PATHS.map((p) => distToPath(site.x, site.z, p).d))
  const crater = site.tag === 'crater-beacon' // stands on a hand bench inside the cone; the tree rule can't apply
  const lake = Math.min(...LAKES_ACTIVE.map((l) => shoreDist(site.x, site.z, l.shore)))
  const problems = []
  if (h < SEA + 1.6) problems.push(`wet (h ${h.toFixed(1)})`)
  if (f > 6) problems.push(`not flat (${f.toFixed(1)} m over 24 m)`)
  if (river < 40) problems.push(`in the river corridor (${river.toFixed(0)} m)`)
  if (lake < 20) problems.push(`in standing water (${lake.toFixed(0)} m)`)
  if (!crater && forestDensityAt(site.x, site.z) > 0.15) problems.push(`in forest (density ${forestDensityAt(site.x, site.z).toFixed(2)})`)
  if (problems.length) {
    console.error(`VALIDATOR FAIL: ruin ${site.tag} at (${site.x},${site.z}): ${problems.join('; ')}`)
    process.exitCode = 1
  }
}

// ---------- WATERFALLS: walk the baked rock down from each hand-placed lip ----------
// The lip and the direction are drawn by hand; the PROFILE is whatever the
// cliff turned out to be after carving, erosion and the re-asserts. Tracing
// it here (rather than in the renderer) means the sheet is cut from the same
// bytes the player stands on, so it can neither hang in the air nor bury
// itself in the rock when a bake moves the face by a metre.
const FALL_SURFACE_ABOVE_BED = 1.35 // water.ts's RIVER_SURFACE_ABOVE_BED
const FALL_DEFS = FALLS.map((f) => {
  const si = RIVER.parts.findIndex((p) => p.name === f.spill)
  const beds = si >= 0 ? RIVER_BEDS[si] : null
  // the water arrives at the lip on its channel's surface, not on the rock
  const topY = beds ? beds[beds.length - 1] + FALL_SURFACE_ABOVE_BED : hAt(f.lip.x, f.lip.z)
  const len = Math.hypot(f.aim.x, f.aim.z) || 1
  const ax = f.aim.x / len, az = f.aim.z / len
  const pts = [{ x: f.lip.x, y: +topY.toFixed(2), z: f.lip.z }]
  let x = f.lip.x, z = f.lip.z, y = topY
  let flat = 0
  for (let i = 1; i <= 240 && flat < 6; i++) {
    x += ax; z += az
    const y2 = Math.min(y, hAt(x, z)) // water never climbs
    flat = y - y2 < 0.2 ? flat + 1 : 0
    y = y2
    pts.push({ x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) })
    if (y <= SEA + 0.1) break
  }
  // trim the run-out: the sheet ends where the water stops falling, not where
  // the ground finally levels — a 6 m horizontal skirt at the bottom reads as
  // a slick on the sand, not a waterfall
  while (pts.length > 2 && pts[pts.length - 1].y >= pts[pts.length - 2].y - 0.35) pts.pop()
  const foot = pts[pts.length - 1]
  return {
    name: f.name, width: f.width, spill: f.spill ?? null,
    top: pts[0], foot, drop: +(pts[0].y - foot.y).toFixed(1), path: pts,
  }
})
for (const f of FALL_DEFS) {
  console.log(`  ${f.name}: ${f.drop} m, ${f.top.y.toFixed(1)} → ${f.foot.y.toFixed(1)} over ${f.path.length - 1} m of ground`)
}

// ---------- validators ----------
const fail = (msg) => {
  console.error(`VALIDATOR FAIL: ${msg}`)
  process.exitCode = 1
}
let nan = 0
let mn = Infinity, mx = -Infinity
for (let i = 0; i < H.length; i++) {
  if (!Number.isFinite(H[i])) nan++
  mn = Math.min(mn, H[i]); mx = Math.max(mx, H[i])
}
if (nan) fail(`${nan} non-finite heights`)
if (mx > 600 || mn < -60) fail(`height range out of bounds: ${mn.toFixed(1)}..${mx.toFixed(1)}`)
const hSpawn = hAt(SPAWN.x, SPAWN.z)
if (hSpawn < SEA + 1.5 || hSpawn > SEA + 6) fail(`spawn beach height ${hSpawn.toFixed(2)} outside 1.5..6`)
// the rim ring sits outside the sunk crater bench (~100 m) — probe at 140 m
const hPeak = Math.max(hAt(VOLCANO.x, VOLCANO.z - 140), hAt(VOLCANO.x, VOLCANO.z + 140), hAt(VOLCANO.x - 140, VOLCANO.z), hAt(VOLCANO.x + 140, VOLCANO.z))
if (hPeak < 240) fail(`volcano rim only ${hPeak.toFixed(0)} m`)
// the crater: a real bowl now — its bench must sit well under the rim
const hBench = hAt(VOLCANO.x, VOLCANO.z)
if (hBench > hPeak - 60) fail(`crater bench ${hBench.toFixed(0)} m is not sunk under the rim ${hPeak.toFixed(0)} m`)
{
  // spawn → volcano sightline: from eye height at spawn, the rim must clear all terrain between
  const eye = hSpawn + 1.6
  const rim = { x: VOLCANO.x, z: VOLCANO.z + 140, y: hAt(VOLCANO.x, VOLCANO.z + 140) }
  let blocked = false
  for (let t = 0.05; t < 0.95; t += 0.005) {
    const x = SPAWN.x + (rim.x - SPAWN.x) * t
    const z = SPAWN.z + (rim.z - SPAWN.z) * t
    const sight = eye + (rim.y - eye) * t
    if (hAt(x, z) > sight + 2) { blocked = true; break }
  }
  if (blocked) fail('volcano rim not visible from spawn eye height')
}
// the river: legs run downhill (bed sampled densely, end → start must never
// drop), the ring is level at its bed, the inflow lands on the ring's bed
for (const [ri, part] of RIVER.parts.entries()) {
  const path = RIVER_PATHS[ri]
  const samples = []
  for (let i = 0; i < path.length - 1; i++) {
    for (let t = 0; t < 1; t += 0.1) {
      const sx = path[i].x + (path[i + 1].x - path[i].x) * t, sz = path[i].z + (path[i + 1].z - path[i].z) * t
      if (inStandingWater(sx, sz)) continue // the pool and the Reservoir are basins, not bed
      const len = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z) || 1
      // the segment's left normal, for bank probes
      samples.push({ x: sx, z: sz, nx: -(path[i + 1].z - path[i].z) / len, nz: (path[i + 1].x - path[i].x) / len })
    }
  }
  if (part.flow) {
    let prev = -Infinity
    for (let i = samples.length - 1; i >= 0; i--) {
      const h = hAt(samples[i].x, samples[i].z)
      if (h < prev - 2.5) fail(`${part.name} bed rises then falls near (${samples[i].x.toFixed(0)},${samples[i].z.toFixed(0)}): ${h.toFixed(1)} after ${prev.toFixed(1)}`)
      prev = Math.max(prev, h)
    }
  } else {
    for (const s of samples) {
      const h = hAt(s.x, s.z)
      const nearFord = part.ford && Math.hypot(s.x - part.ford.x, s.z - part.ford.z) < 40
      // erosion may gully the entrance to the Reservoir a little deeper; what
      // matters is that the bed never rises toward the level surface
      const lo = RING_BED - 4, hi = nearFord ? RIVER.level - 0.3 : RING_BED + 1.6
      if (h < lo || h > hi) fail(`${part.name} bed off level near (${s.x.toFixed(0)},${s.z.toFixed(0)}): ${h.toFixed(1)} (want ${lo.toFixed(1)}..${hi.toFixed(1)})`)
    }
    if (part.ford) {
      const hf = hAt(part.ford.x, part.ford.z)
      if (hf > RIVER.level - 0.3 || hf < RIVER.level - 1.05) fail(`ford bed ${hf.toFixed(2)} not knee-deep under level ${RIVER.level}`)
    }
    // the banks HOLD the water: at 1.25 half-widths from the centreline the
    // ground must sit above the level all the way round (except where the
    // legs and the Reservoir join) — the sheet floated over low ground before
    let lowBank = 0
    let worst = null
    for (const s of samples) {
      for (const side of [1, -1]) {
        const bx = s.x + s.nx * side * part.halfWidth * 1.4, bz = s.z + s.nz * side * part.halfWidth * 1.4
        if (distToPath(bx, bz, path).d < part.halfWidth * 1.15) continue // inside a bend, the probe fell back into the channel
        if (LAKES_ACTIVE.some((l) => shoreDist(bx, bz, l.shore) < 6)) continue
        if (RIVER.parts.some((p, j) => p.flow && distToPath(bx, bz, RIVER_PATHS[j]).d < p.halfWidth * 1.8)) continue
        const h = hAt(bx, bz)
        if (h < RIVER.level + 0.3) { lowBank++; if (!worst || h < worst.h) worst = { h, x: bx, z: bz } }
      }
    }
    if (lowBank) fail(`${part.name}: ${lowBank} bank samples under the water level (lowest ${worst.h.toFixed(2)} at ${worst.x.toFixed(0)},${worst.z.toFixed(0)})`)
  }
}
// standing water holds: deep point below level; every shore vertex's outside
// ground above level (river corridors excepted)
for (const lake of LAKES_ACTIVE) {
  if (hAt(lake.deep.x, lake.deep.z) > lake.level - 1) fail(`lake ${lake.name}: deep point above fill level`)
  const cx = lake.shore.reduce((a, v) => a + v[0], 0) / lake.shore.length
  const cz = lake.shore.reduce((a, v) => a + v[1], 0) / lake.shore.length
  for (const [vx, vz] of lake.shore) {
    const dx = vx - cx, dz = vz - cz
    const len = Math.hypot(dx, dz) || 1
    const sx = vx + (dx / len) * 6, sz = vz + (dz / len) * 6
    const nearRiver = RIVER_PATHS.some((p) => distToPath(sx, sz, p).d < 30)
    if (!nearRiver && hAt(sx, sz) < lake.level + 0.1) {
      fail(`lake ${lake.name}: shore below level near (${vx},${vz})`)
      break
    }
  }
}

// the falls: a hand-placed lip that turned out to be flat ground is a bug in
// the trace, not scenery — and one whose foot hangs above the water is a
// sheet ending in mid-air
for (const f of FALL_DEFS) {
  if (f.drop < 10) fail(`fall ${f.name}: only ${f.drop} m of drop — the lip is not on a cliff`)
  if (f.path.length < 2) fail(`fall ${f.name}: no descent traced`)
  if (f.foot.y > SEA + 4) fail(`fall ${f.name}: foot at ${f.foot.y.toFixed(1)} m, nothing to land in`)
  // the plunge pool is carved with a disc and a disc has no idea where the
  // cliff is: the first cut reached 10 m back under the lip and took the top
  // of the fall away with it (29.5 m of rock became 5.5)
  // sampled three metres INLAND of the lip: the lip cell itself straddles the
  // edge, and a 2 m bilinear tap there is half cliff face by construction
  const def = FALLS.find((q) => q.name === f.name)
  const al = Math.hypot(def.aim.x, def.aim.z) || 1
  const lipGround = hAt(f.top.x - (def.aim.x / al) * 3, f.top.z - (def.aim.z / al) * 3)
  if (lipGround < f.top.y - 2.2) fail(`fall ${f.name}: the lip is undercut — ground ${lipGround.toFixed(1)} m under a water surface of ${f.top.y.toFixed(1)}`)
  // the sheet must not be a slide: the drop has to beat the horizontal run
  const run = Math.hypot(f.foot.x - f.top.x, f.foot.z - f.top.z)
  if (run > f.drop * 1.2) fail(`fall ${f.name}: ${run.toFixed(0)} m of run for ${f.drop} m of drop — that is a rapid, not a fall`)
  // and the channel above it must actually reach the lip with water in it
  if (f.spill) {
    const part = RIVER.parts.find((p) => p.name === f.spill)
    const end = part.path[part.path.length - 1]
    const d = Math.hypot(end.x - f.top.x, end.z - f.top.z)
    if (d > 6) fail(`fall ${f.name}: its channel ${f.spill} ends ${d.toFixed(0)} m from the lip`)
  }
}

// ---------- outputs ----------
mkdirSync('public/world', { recursive: true })
const out = new Int16Array(SIDE * SIDE)
for (let i = 0; i < H.length; i++) out[i] = Math.round(H[i] / SCALE)
// row-delta int16: ~30% smaller over the wire than raw heights (world-io.mjs)
writeFileSync('public/world/heightmap.bin', Buffer.from(encodeRowDelta(out, SIDE).buffer))
const meta = {
  side: SIDE, res: RES, scale: SCALE, half: HALF, sea: SEA, encoding: 'row-delta',
  spawn: SPAWN, volcano: VOLCANO,
  // every part as a plain polyline (closed ones wrapped), flowing legs first —
  // gates and the scatter's river-distance read these
  rivers: [...RIVER.parts.filter((p) => p.flow), ...RIVER.parts.filter((p) => !p.flow)].map(closedPath),
  river: { knot: RIVER.knot, level: RIVER.level, parts: RIVER.parts.map((p) => ({ name: p.name, flow: p.flow, halfWidth: p.halfWidth, closed: !!p.closed, ford: p.ford ?? null, path: p.path })) },
  lakes: LAKES_ACTIVE, ruinSites: RUIN_SITES, ruins: RUINS,
  swamp: SWAMP ? { level: SWAMP.level, shore: SWAMP.shore } : null,
  biomes: BIOMES,
  coast: COAST, ranges: RANGES, holm: HOLM, ravine: RAVINE,
  caves: CAVES.map((c) => ({
    name: c.name, mouth: c.mouth, into: c.into, reach: c.reach, radius: c.radius,
    keystone: !!c.keystone,
    mouthY: c.mouthY,
    floorY: c.floorY,
    // what the bake actually produced, so the runtime and the gates can check
    // the carve landed where it was asked to
    bakedFloorY: +hAt(c.mouth.x + c.into.x * c.reach, c.mouth.z + c.into.z * c.reach).toFixed(1),
    bakedMouthY: +hAt(c.mouth.x, c.mouth.z).toFixed(1),
  })),
  forests: FORESTS, clearings: CLEARINGS,
  falls: FALL_DEFS,
  bakedAt: new Date().toISOString(),
}
writeFileSync('public/world/world-meta.json', JSON.stringify(meta, null, 2))
writeFileSync('public/world/forest.bin', Buffer.from(forest.buffer))

// ---------- sky view: the island's own ambient occlusion, baked ----------
// Screen-space AO costs 2-6 ms a frame and redraws the scene for normals
// (M42/M44). The LANDSCAPE's share of it does not change, ever — a gorge is
// always a gorge — so it is computed here instead, once, and costs nothing at
// runtime: every vertex colour and every prop tint is multiplied by it as the
// world is built (M47).
//
// For each cell, march sixteen directions out to 240 m, keep the highest
// horizon angle each way, and average the sky each direction still shows. Deep
// valleys and cliff feet come out dark, ridges and the open plain stay bright.
{
  const SV_SIDE = 1024
  const SV_STEP = (HALF * 2) / SV_SIDE
  const DIRS = 16
  const REACH = 240
  const STEPS = 24
  const sv = new Uint8Array(SV_SIDE * SV_SIDE)
  const cos = [], sin = []
  for (let d = 0; d < DIRS; d++) { const a = (d / DIRS) * Math.PI * 2; cos.push(Math.cos(a)); sin.push(Math.sin(a)) }
  const t0 = Date.now()
  for (let j = 0; j < SV_SIDE; j++) {
    const z = -HALF + (j + 0.5) * SV_STEP
    for (let i = 0; i < SV_SIDE; i++) {
      const x = -HALF + (i + 0.5) * SV_STEP
      const h0 = hAt(x, z)
      let open = 0
      for (let d = 0; d < DIRS; d++) {
        let maxSlope = 0
        // geometric steps: fine detail close in, coarse far out
        for (let k = 1; k <= STEPS; k++) {
          const dist = REACH * Math.pow(k / STEPS, 2)
          const hx = hAt(x + cos[d] * dist, z + sin[d] * dist)
          const slope = (hx - h0) / dist
          if (slope > maxSlope) maxSlope = slope
        }
        // the sky this direction still shows: 1 at a flat horizon, 0 at a wall
        open += 1 / Math.sqrt(1 + maxSlope * maxSlope)
      }
      sv[j * SV_SIDE + i] = Math.round(Math.max(0, Math.min(1, open / DIRS)) * 255)
    }
  }
  writeFileSync('public/world/skyview.bin', Buffer.from(sv.buffer))
  let min = 255, max = 0, sum = 0
  for (const v of sv) { if (v < min) min = v; if (v > max) max = v; sum += v }
  console.log(`skyview: ${SV_SIDE}² in ${((Date.now() - t0) / 1000).toFixed(1)}s — min ${min}, max ${max}, mean ${Math.round(sum / sv.length)}`)
}

// biome map: the traced polygons (alpine is altitude)
{
  const biomes = new Uint8Array(SIDE * SIDE)
  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const x = worldX(ix), z = worldZ(iz)
      const h = H[idx(ix, iz)]
      let b = 0
      for (let bi = 0; bi < BIOMES.length && !b; bi++) if (biomeSD[bi](x, z) < 0) b = BIOMES[bi].id
      if (!b && h > 120) b = 4
      biomes[idx(ix, iz)] = b
    }
  }
  writeFileSync('public/world/biomes.bin', Buffer.from(biomes.buffer))
}

// hillshade BMP for eyeball QA (24-bit, no deps)
{
  const W = SIDE, Hh = SIDE
  const rowPad = (4 - ((W * 3) % 4)) % 4
  const dataSize = (W * 3 + rowPad) * Hh
  const buf = Buffer.alloc(54 + dataSize)
  buf.write('BM'); buf.writeUInt32LE(54 + dataSize, 2); buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14); buf.writeInt32LE(W, 18); buf.writeInt32LE(Hh, 22)
  buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(dataSize, 34)
  let o = 54
  const lx = -0.6, lz = -0.8
  for (let iz = Hh - 1; iz >= 0; iz--) {
    for (let ix = 0; ix < W; ix++) {
      const h = H[idx(ix, iz)]
      const gx = H[idx(Math.min(ix + 1, W - 1), iz)] - H[idx(Math.max(ix - 1, 0), iz)]
      const gz = H[idx(ix, Math.min(iz + 1, Hh - 1))] - H[idx(ix, Math.max(iz - 1, 0))]
      const shade = Math.max(0, Math.min(1, 0.5 - (gx * lx + gz * lz) * 0.12))
      let r, g, b
      if (h < SEA) { r = 40; g = 80; b = 140 + Math.max(-60, h * 3) }
      else {
        const base = 60 + shade * 160
        r = base * (h > 150 ? 1 : 0.7)
        g = base
        b = base * 0.55
        if (h < SEA + 1.2) { r = 200; g = 190; b = 140 }
      }
      buf[o++] = b; buf[o++] = g; buf[o++] = r
    }
    o += rowPad
  }
  mkdirSync('shots', { recursive: true })
  writeFileSync('shots/island-hillshade.bmp', buf)
}

console.log(`baked: ${SIDE}×${SIDE} @ ${RES}m · height ${mn.toFixed(1)}..${mx.toFixed(1)} m`)
console.log(`spawn h=${hSpawn.toFixed(2)} · rim ${hPeak.toFixed(0)} m · ruins: ${RUIN_SITES.map((r) => `${r.tag}(${r.x},${r.z})`).join(' ')}`)
console.log(`validators: ${process.exitCode ? 'FAILED' : 'all pass'}`)

// The island bake: composition → erosion → validation → committed artifacts.
//   node tools/bake-island.mjs
//
// Deterministic (seeded). Outputs:
//   public/world/heightmap.bin   int16 heights (scale 0.01), 1025×1025 @ 2 m
//   public/world/world-meta.json grid params + spawn/volcano/ruin sites
//   shots/island-hillshade.bmp   top-down hillshade for eyeball QA
//
// Composition intent (the arc's geography, PLAN.md):
//   south coast: wide calm spawn beach · interior: rolling forest hills,
//   rising north · north-center: the volcano, visible from spawn · two river
//   valleys carved from the volcano's flanks to the sea (wet at M5b) · two
//   lake basins · six flat ruin sites on a spawn→summit gradient.
import { writeFileSync, mkdirSync } from 'node:fs'

const HALF = 1024
const RES = 2
const SIDE = HALF * 2 / RES + 1 // 1025
const SEA = 0
const SCALE = 0.01
const SPAWN = { x: 0, z: 780 }
const VOLCANO = { x: 0, z: -620 }

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
// gradient noise (improved-Perlin-style) + FBM + domain warp
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

// ---------- composition ----------
console.time('compose')
const H = new Float32Array(SIDE * SIDE)
const idx = (ix, iz) => iz * SIDE + ix
const worldX = (ix) => -HALF + ix * RES
const worldZ = (iz) => -HALF + iz * RES

// river paths: control points from the volcano flanks to the sea (carved now,
// wet at M5b). Stored in meta for the water pass.
const RIVERS = [
  // east river: volcano east flank → curls southeast → east coast
  [{ x: 120, z: -480 }, { x: 320, z: -320 }, { x: 430, z: -60 }, { x: 520, z: 220 }, { x: 640, z: 460 }, { x: 760, z: 640 }],
  // west river: west flank → lake basin → southwest coast
  [{ x: -160, z: -440 }, { x: -340, z: -240 }, { x: -430, z: 20 }, { x: -460, z: 60 }, { x: -520, z: 340 }, { x: -640, z: 560 }],
]
// HAND-TRACED lakes: each shoreline is an explicit polygon, drawn vertex by
// vertex like tracing a map — no center/radius/noise formula anywhere.
// (x,z) pairs, counterclockwise. `level` is chosen against the surrounding
// terrain and asserted by the validator; `deep` is the hand-picked deepest spot.
const LAKES = [
  {
    // WEST LAKE — elongated highland lake the west river flows through.
    // Design: wide southern basin, narrowing north neck where the river
    // enters, a peninsula pinching the east side, a small west bay.
    name: 'west',
    level: 8.2,
    deep: { x: -445, z: 55 },
    shore: [
      [-390, -95], [-355, -60], [-345, -15], [-360, 20],   // NE inlet neck (river enters)
      [-385, 40], [-395, 75], [-380, 105],                 // east shore → peninsula root
      [-410, 120], [-450, 150], [-490, 165],               // peninsula pinch + south bulge
      [-525, 150], [-545, 115], [-540, 75],                // SW shore (river exits ~here)
      [-560, 45], [-555, 5], [-530, -25],                  // west bay
      [-495, -40], [-470, -70], [-435, -95], [-405, -105], // NW shore back to inlet
    ],
  },
  {
    // EAST LAKE — smaller lowland lake with a marshy south end and one bay.
    name: 'east',
    level: 5.4,
    deep: { x: 310, z: 290 },
    shore: [
      [255, 240], [290, 225], [330, 230], [355, 250],  // north shore
      [370, 280], [360, 315], [372, 345],              // east + SE bay notch
      [345, 370], [305, 380], [270, 365],              // south (marshy)
      [245, 335], [238, 295], [242, 262],              // west shore
    ],
  },
]

/** Signed distance to a hand-traced shoreline: negative inside. */
function shoreDist(px, pz, shore) {
  let inside = false
  let minD = Infinity
  for (let i = 0, j = shore.length - 1; i < shore.length; j = i++) {
    const [xi, zi] = shore[i]
    const [xj, zj] = shore[j]
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside
    const dx = xj - xi
    const dz = zj - zi
    const t = Math.max(0, Math.min(1, ((px - xi) * dx + (pz - zi) * dz) / (dx * dx + dz * dz)))
    minD = Math.min(minD, Math.hypot(px - (xi + dx * t), pz - (zi + dz * t)))
  }
  return inside ? -minD : minD
}

// Meander: densify each river's control polyline and push points sideways
// with two superimposed sine waves over arc length (amplitude grows down-
// stream, pinned at source and mouth). Rivers stop being ruler-straight
// (backlog #2: "no twisty turney").
function meander(path, seed) {
  const pts = []
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const steps = Math.max(4, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 26))
    for (let st = 0; st < steps; st++) {
      const t = st / steps
      pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
    }
  }
  pts.push(path[path.length - 1])
  const out = []
  let arc = 0
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) arc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)
    const prev = pts[Math.max(0, i - 1)]
    const next = pts[Math.min(pts.length - 1, i + 1)]
    const dx = next.x - prev.x
    const dz = next.z - prev.z
    const len = Math.hypot(dx, dz) || 1
    const t = i / (pts.length - 1)
    const pin = smoothstep(0, 0.12, t) * (1 - smoothstep(0.88, 1, t))
    // downstream amp capped: 30m meanders over low coastal ground carved a
    // bay through the southwest coast on first bake
    const amp = (13 + 14 * t) * pin
    const off = Math.sin(arc * 0.022 + seed) * 0.62 + Math.sin(arc * 0.0093 - seed * 0.7) * 0.38
    out.push({ x: pts[i].x + (-dz / len) * off * amp, z: pts[i].z + (dx / len) * off * amp })
  }
  return out
}
const RIVERS_DENSE = RIVERS.map((p, i) => meander(p, i * 3.7 + 1.2))

// ---- biome regions (the depth mandate: distinct traversable lands) ----
const SWAMP = { x: 560, z: 330, r: 170, level: 4.2 } // east-coast marsh, the canyon river deltas through it
const DESERT = { x: -520, z: 300, r: 220 } // west rain-shadow flats, the west river oasis crosses it
const PLAINS = { x: -240, z: 520, r: 200 } // rolling bush plains southwest of spawn
const RIDGES = [
  // NE and NW ranges: denser wobbled spines (straight 3-point lines read as
  // smooth mounds from the air)
  [{ x: 590, z: -390 }, { x: 640, z: -290 }, { x: 700, z: -170 }, { x: 705, z: -60 }, { x: 745, z: 40 }, { x: 720, z: 130 }],
  [{ x: -590, z: -440 }, { x: -660, z: -330 }, { x: -680, z: -210 }, { x: -730, z: -90 }, { x: -720, z: 10 }, { x: -750, z: 90 }],
]

/** Noise-warped radial distance: turns circular region masks into natural
 *  irregular boundaries (bays, headlands, lobes). Amp is a fraction of r. */
function warpedDist(x, z, cx, cz, r, seed, amp = 0.42) {
  const d = Math.hypot(x - cx, z - cz)
  // low-frequency, 2-octave: smooth lobes, no high-freq jitter at the boundary
  const wob = fbm((x + seed * 137) * 0.006, (z - seed * 91) * 0.006, 2)
  return d + wob * r * amp
}

/** distance from point to a polyline; also returns segment index + local t */
function distToPath(px, pz, path) {
  let best = Infinity
  let bseg = 0
  let bt = 0
  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i].x, az = path[i].z
    const bx = path[i + 1].x, bz = path[i + 1].z
    const dx = bx - ax, dz = bz - az
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
    const d = Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
    if (d < best) {
      best = d
      bseg = i
      bt = t
    }
  }
  return { d: best, seg: bseg, t: bt }
}

for (let iz = 0; iz < SIDE; iz++) {
  for (let ix = 0; ix < SIDE; ix++) {
    const x = worldX(ix), z = worldZ(iz)

    // base: domain-warped FBM hills (the graybox's sin/cos, grown up)
    const wx = x + 180 * fbm(x * 0.0016 + 40, z * 0.0016 - 17, 3)
    const wz = z + 180 * fbm(x * 0.0016 - 31, z * 0.0016 + 23, 3)
    let h = 14.5 * fbm(wx * 0.0021, wz * 0.0021, 6)
    h += 5 * fbm(x * 0.011, z * 0.011, 4) // mid-frequency detail
    h += 4 * fbm(x * 0.006 + 7, z * 0.006 - 3, 4) // extra mid band (backlog #5)

    // interior plateau: hold the island's core solidly above the sea so FBM
    // valleys read as inland lowlands, not a flooding strait (v1 bake split
    // the island in half — caught on the hillshade)
    const rPlateau = Math.sqrt(x * x * 1.15 + z * z * 0.95)
    h += 11 * smoothstep(940, 520, rPlateau)

    // northward rise into the foothills
    h += Math.max(0, -z) * 0.014

    // ridgelines radiating southeast/southwest from the volcano
    for (const ang of [2.4, -2.4]) {
      const rx = VOLCANO.x + Math.sin(ang) * 460
      const rz = VOLCANO.z + Math.cos(ang) * 460
      const { d } = distToPath(x, z, [{ x: VOLCANO.x, z: VOLCANO.z }, { x: rx, z: rz }])
      h += 14 * Math.exp(-(d * d) / (2 * 90 * 90)) * smoothstep(900, 300, Math.hypot(x - VOLCANO.x, z - VOLCANO.z))
    }

    // mountain ranges: two coastal ridges with pass dips (traversable)
    for (const ridge of RIDGES) {
      const rr = distToPath(x, z, ridge)
      const frac = (rr.seg + rr.t) / (ridge.length - 1)
      // ARK-reference mountains v3: taller, exponential-ridge crest (sharp
      // spine, not gaussian mound), multi-frequency peak line, and jagged
      // high-altitude noise. Peaks reach ~190m with base terrain.
      const peaks = 0.62 + 0.28 * Math.sin(frac * Math.PI * 7 + 1.7) + 0.1 * Math.sin(frac * Math.PI * 17 - 0.4)
      const passes = 0.76 + 0.24 * Math.sin(frac * Math.PI * 2 + 0.9)
      // warp the lateral distance so flank contours wander
      const dWarp = rr.d + 18 * fbm(x * 0.01 + 31, z * 0.01 - 13, 3)
      h += 88 * passes * Math.exp(-(dWarp * dWarp) / (2 * 78 * 78)) // broad massif
      h += 74 * peaks * passes * Math.exp(-Math.abs(dWarp) / 17) // exponential ridge: sharp crest
      // jagged rock noise that only bites at altitude (scree fields + spurs)
      const alt = smoothstep(55, 110, h)
      h += 13 * alt * fbm(x * 0.045 + 5, z * 0.045 - 9, 4)
    }

    // the volcano, resculpted (MAP OVERHAUL: "looks weirdly bad" — too smooth):
    // angular radius modulation breaks the perfect-cone silhouette, radial
    // ridges give the flanks gullies, and a raised crater rim reads from afar
    const dvx = x - VOLCANO.x
    const dvz = z - VOLCANO.z
    const vAng = Math.atan2(dvz, dvx)
    const radMod = 1 + 0.13 * Math.sin(vAng * 5 + 1.3) + 0.07 * Math.sin(vAng * 9 - 0.6)
    const dv = Math.hypot(dvx, dvz) / radMod
    const cone = Math.max(0, 1 - dv / 330)
    h += 252 * cone * cone
    h += 30 * Math.exp(-(dv * dv) / (2 * 85 * 85))
    h += 9 * Math.sin(vAng * 12 + 0.7) * cone * cone * smoothstep(40, 95, dv) // flank ridges
    h += 15 * Math.exp(-((dv - 54) * (dv - 54)) / (2 * 11 * 11)) // crater rim lip
    h -= 110 * Math.exp(-(dv * dv) / (2 * 44 * 44)) // deeper caldera dish

    // island falloff to ocean floor
    const r = Math.sqrt(x * x * 1.15 + z * z * 0.95)
    const falloff = smoothstep(690, 960, r)
    h = h * (1 - falloff) + -14 * falloff

    // spawn beach apron: calm, dry, wins over everything else
    const ds = Math.hypot(x - SPAWN.x, z - SPAWN.z)
    const beach = Math.exp(-(ds * ds) / (2 * 210 * 210)) * 0.92
    h = h * (1 - beach) + 3.0 * beach

    // swamp: noise-warped marsh basin (the circular region read as a stamped
    // disc from the air) with pool depressions below the water table
    {
      const d = warpedDist(x, z, SWAMP.x, SWAMP.z, SWAMP.r, 55)
      const w = smoothstep(SWAMP.r * 1.05, SWAMP.r * 0.5, d)
      if (w > 0.01) {
        const pool = Math.max(0, fbm(x * 0.02 + 11, z * 0.02 - 5, 3)) * 2.6
        h = h * (1 - w) + (5.5 - pool) * w
      }
    }
    // desert: gentle dune flats
    {
      const d = Math.hypot(x - DESERT.x, z - DESERT.z)
      const w = smoothstep(DESERT.r, DESERT.r * 0.5, d)
      if (w > 0.01) h = h * (1 - w) + (7.5 + 2.2 * fbm(x * 0.012 + 3, z * 0.012 + 9, 3) + 0.7 * Math.sin(x * 0.045 + z * 0.02)) * w
    }
    // plains: soft rolling open ground
    {
      const d = Math.hypot(x - PLAINS.x, z - PLAINS.z)
      const w = smoothstep(PLAINS.r, PLAINS.r * 0.5, d)
      if (w > 0.01) h = h * (1 - w) + (7 + 1.4 * fbm(x * 0.01 - 7, z * 0.01 + 2, 3)) * w
    }

    H[idx(ix, iz)] = h
  }
}
console.timeEnd('compose')

// ---------- lakes: carve the hand-traced basins ----------
// Depth follows distance from the drawn shore toward the hand-picked deep
// point; banks slope in over a 14m band outside the shoreline. Carve-only:
// ground is never raised, so the lake sits IN the land (no donut).
console.time('lakes')
for (const lake of LAKES) {
  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const x = worldX(ix), z = worldZ(iz)
      const sd = shoreDist(x, z, lake.shore)
      if (sd > 14) continue
      const i0 = idx(ix, iz)
      if (sd > 0) {
        // bank: ease existing ground down toward shore level
        const t = 1 - sd / 14
        const bankTarget = lake.level + 0.4 + sd * 0.35
        if (H[i0] > bankTarget) H[i0] = H[i0] * (1 - t * 0.85) + bankTarget * (t * 0.85)
      } else {
        // interior: depth grows from shore toward the deep point
        const dDeep = Math.hypot(x - lake.deep.x, z - lake.deep.z)
        const shoreT = Math.min(1, -sd / 26) // 0 at shore → 1 by 26m in
        const deepT = Math.max(0, 1 - dDeep / 120)
        const depth = 1.2 + shoreT * 3.2 + deepT * 1.6
        const target = lake.level - depth
        if (H[i0] > target) H[i0] = target
      }
    }
  }
}
console.timeEnd('lakes')

// ---------- river carve pass (after base terrain exists) ----------
// The bed follows a MONOTONIC downstream profile derived from the terrain at
// the control points, so the river can only ever run downhill and never digs
// below its own mouth. (v1 carved a fixed depth and dove under sea level —
// caught by the uphill validator.)
console.time('rivers')
const hAtGrid = (x, z) => {
  const fx = (x + HALF) / RES, fz = (z + HALF) / RES
  const ix = Math.max(0, Math.min(SIDE - 2, Math.floor(fx)))
  const iz = Math.max(0, Math.min(SIDE - 2, Math.floor(fz)))
  const u = fx - ix, v = fz - iz
  return H[idx(ix, iz)] * (1 - u) * (1 - v) + H[idx(ix + 1, iz)] * u * (1 - v) +
    H[idx(ix, iz + 1)] * (1 - u) * v + H[idx(ix + 1, iz + 1)] * u * v
}
const RIVER_BEDS = RIVERS_DENSE.map((path) => {
  // source → mouth: bed sits ~3.5 m under terrain, clamped monotonic downhill
  const beds = []
  let prev = Infinity
  for (let i = 0; i < path.length; i++) {
    const target = Math.min(hAtGrid(path[i].x, path[i].z) - 3.5, prev - 0.8)
    const bed = Math.max(target, -2.5) // never dig canyons below the sea mouth
    beds.push(Math.min(bed, prev))
    prev = beds[i]
  }
  return beds
})
for (let iz = 0; iz < SIDE; iz++) {
  for (let ix = 0; ix < SIDE; ix++) {
    const x = worldX(ix), z = worldZ(iz)
    const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z)
    if (dv < 200) continue // never carve the cone itself
    for (let ri = 0; ri < RIVERS_DENSE.length; ri++) {
      const { d, seg, t } = distToPath(x, z, RIVERS_DENSE[ri])
      if (d > 120) continue
      const beds = RIVER_BEDS[ri]
      const bed = beds[seg] * (1 - t) + beds[Math.min(seg + 1, beds.length - 1)] * t
      // the east river's mid-course is a canyon: tight channel, steep walls,
      // raised rims; elsewhere a soft valley
      const frac = seg / (RIVERS_DENSE[ri].length - 1)
      const canyon = ri === 0 && frac > 0.18 && frac < 0.62
      const sigma = canyon ? 14 : 22
      const wBed = Math.exp(-(d * d) / (2 * sigma * sigma))
      const wValley = (canyon ? 0.15 : 0.35) * Math.exp(-(d * d) / (2 * 65 * 65))
      const i0 = idx(ix, iz)
      const target = Math.min(H[i0], bed)
      H[i0] = H[i0] * (1 - wBed) + target * wBed - wValley * 2.0
      if (canyon) {
        // rim lift: shoulders rise well above the surrounding ground
        H[i0] += 6.5 * Math.exp(-((d - 28) * (d - 28)) / (2 * 10 * 10))
      } else if (d < 34) {
        // bank cap (user: "randomly very tall banks"): outside the canyon,
        // where the meander cuts through a hill the walls soften instead of
        // towering — banks cap ~5m over the bed
        const cap = bed + 5
        if (H[i0] > cap) H[i0] = cap + (H[i0] - cap) * 0.35
      }
    }
  }
}
console.timeEnd('rivers')

// ---------- sculpt pass: escarpments, mesas, canyon (the ARK terrain drama) ----------
console.time('sculpt')
{
  // terrace operator: quantize height into steps with steep risers
  const terrace = (h, step, sharp) => {
    const t = h / step
    const f = t - Math.floor(t)
    const shaped = Math.pow(f, sharp) / (Math.pow(f, sharp) + Math.pow(1 - f, sharp))
    return (Math.floor(t) + shaped) * step
  }
  // mesas: flat-topped buttes in the dry east and west interior
  // mesas removed: even relocated they read as "circles pulled up" from the
  // air (player review). Rock formations return later as placed meshes.
  const MESAS = []
  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const x = worldX(ix), z = worldZ(iz)
      const i0 = idx(ix, iz)
      let h = H[i0]

      // highland escarpments: the northern rise (between the forest belt and
      // the volcano foothills) breaks into terraced cliff bands
      if (z < -60 && z > -460 && h > 16 && h < 90) {
        const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z)
        if (dv > 330) {
          const mask = smoothstep(16, 30, h) * (1 - smoothstep(70, 90, h)) *
            smoothstep(-60, -140, z) * (1 - smoothstep(-380, -460, z)) *
            (0.55 + 0.45 * fbm(x * 0.004 + 9, z * 0.004 - 4, 3))
          h = h * (1 - mask) + terrace(h, 14, 3.2) * mask
        }
      }

      // canyon walls: terrace the east river's mid-course flanks so the gorge
      // reads as stratified rock, not a soft ditch (backlog #4)
      {
        const { d, seg } = distToPath(x, z, RIVERS_DENSE[0])
        const frac = seg / (RIVERS_DENSE[0].length - 1)
        if (frac > 0.18 && frac < 0.62 && d > 16 && d < 64 && h > 6) {
          const w = smoothstep(64, 34, d) * 0.75
          h = h * (1 - w) + terrace(h, 7, 3.4) * w
        }
      }

      // mountain ridge cliffs: terrace the range flanks into rock bands
      for (const ridge of RIDGES) {
        const rr = distToPath(x, z, ridge)
        if (rr.d < 130 && h > 18) {
          const w = smoothstep(130, 55, rr.d) * 0.8
          h = h * (1 - w) + terrace(h, 11, 3.2) * w
        }
      }

      // mesas: raise to a flat top inside r, sheer sides via smoothstep
      for (const m of MESAS) {
        const d = Math.hypot(x - m.x, z - m.z)
        if (d > m.r * 1.5) continue
        const w = 1 - smoothstep(m.r * 0.82, m.r * 1.12, d)
        const rim = 1 + 0.04 * Math.sin(Math.atan2(z - m.z, x - m.x) * 7) // ragged edge
        if (h < m.top && h > SEA + 1) h = h * (1 - w) + (m.top * rim + fbm(x * 0.05, z * 0.05, 2) * 1.5) * w
      }

      H[i0] = h
    }
  }
}
console.timeEnd('sculpt')

// ---------- hydraulic erosion (droplet method, SebLague-style) ----------
console.time('erosion')
{
  const rand = mulberry32(9001)
  const DROPS = 220_000
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
        // erode a small brush around the drop
        let wsum = 0
        const cx = Math.floor(fx), cz = Math.floor(fz)
        for (let bz = -RADIUS; bz <= RADIUS; bz++) {
          for (let bx = -RADIUS; bx <= RADIUS; bx++) {
            const w = Math.max(0, RADIUS - Math.hypot(bx, bz))
            wsum += w
          }
        }
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
  const TALUS = 0.72 * RES // max height diff between neighbors before slumping
  for (let pass = 0; pass < 3; pass++) {
    for (let iz = 1; iz < SIDE - 1; iz++) {
      for (let ix = 1; ix < SIDE - 1; ix++) {
        const h = H[idx(ix, iz)]
        for (const [ox, oz] of [[1, 0], [0, 1]]) {
          const j = idx(ix + ox, iz + oz)
          const d = h - H[j]
          if (Math.abs(d) > TALUS) {
            const move = (Math.abs(d) - TALUS) * 0.25 * Math.sign(d)
            H[idx(ix, iz)] -= move
            H[j] += move
          }
        }
      }
    }
  }
}
console.timeEnd('thermal')

// micro-detail: high-frequency ripple BAKED into the grid (a runtime detail
// term desynced props from LOD-rendered terrain — everything floated)
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

// containment touch-up: erosion can gully a rim cell below the level — nudge
// only those cells (cm-scale) just above it; river corridors stay open
for (const lake of LAKES) {
  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const x = worldX(ix), z = worldZ(iz)
      const sd = shoreDist(x, z, lake.shore)
      if (sd < 1 || sd > 16) continue
      let nearRiver = false
      for (const path of RIVERS_DENSE) {
        if (distToPath(x, z, path).d < 26) { nearRiver = true; break }
      }
      if (nearRiver) continue
      const i0 = idx(ix, iz)
      if (H[i0] < lake.level + 0.25) H[i0] = lake.level + 0.25
    }
  }
}

// re-assert river beds after erosion: 220K droplets deposit sediment into the
// carved channels, silting them up to wading depth (caught by the swim gate
// after the meander moved its probe point onto a silt bar)
for (let iz = 0; iz < SIDE; iz++) {
  for (let ix = 0; ix < SIDE; ix++) {
    const x = worldX(ix), z = worldZ(iz)
    for (let ri = 0; ri < RIVERS_DENSE.length; ri++) {
      const { d, seg, t } = distToPath(x, z, RIVERS_DENSE[ri])
      if (d > 10) continue
      const beds = RIVER_BEDS[ri]
      const bed = beds[seg] * (1 - t) + beds[Math.min(seg + 1, beds.length - 1)] * t
      const i0 = idx(ix, iz)
      const w = Math.exp(-(d * d) / (2 * 6 * 6))
      H[i0] = Math.min(H[i0], bed * w + H[i0] * (1 - w) + 0.001)
    }
  }
}

// re-assert the spawn beach after erosion (droplets gully everything)
for (let iz = 0; iz < SIDE; iz++) {
  for (let ix = 0; ix < SIDE; ix++) {
    const x = worldX(ix), z = worldZ(iz)
    const ds = Math.hypot(x - SPAWN.x, z - SPAWN.z)
    if (ds > 320) continue
    const w = Math.exp(-(ds * ds) / (2 * 160 * 160)) * 0.9
    H[idx(ix, iz)] = H[idx(ix, iz)] * (1 - w) + 3.0 * w
  }
}

// ---------- ruin sites: six flat, dry spots on a spawn→summit gradient ----------
const hAt = (x, z) => {
  const fx = (x + HALF) / RES, fz = (z + HALF) / RES
  const ix = Math.max(0, Math.min(SIDE - 2, Math.floor(fx)))
  const iz = Math.max(0, Math.min(SIDE - 2, Math.floor(fz)))
  const u = fx - ix, v = fz - iz
  return H[idx(ix, iz)] * (1 - u) * (1 - v) + H[idx(ix + 1, iz)] * u * (1 - v) +
    H[idx(ix, iz + 1)] * (1 - u) * v + H[idx(ix + 1, iz + 1)] * u * v
}
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
const siteRand = mulberry32(4242)
const targets = [
  { z: 640, tag: 'beach-statue' }, { z: 380, tag: 'coast-shrine' },
  { z: 100, tag: 'forest-temple' }, { z: -160, tag: 'highland-arch' },
  { z: -340, tag: 'foothill-vault' }, { z: -520, tag: 'caldera-gate' },
]
const RUIN_SITES = []
for (const t of targets) {
  let placed = null
  for (let tries = 0; tries < 400 && !placed; tries++) {
    const x = (siteRand() - 0.5) * 1100
    const z = t.z + (siteRand() - 0.5) * 120
    const h = hAt(x, z)
    if (h < SEA + 2.5) continue
    if (flatness(x, z) > 3.5) continue
    if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 40) continue
    placed = { tag: t.tag, x: Math.round(x), z: Math.round(z), y: +h.toFixed(1) }
  }
  if (!placed) {
    console.error(`VALIDATOR FAIL: no flat dry site found for ${t.tag}`)
    process.exit(1)
  }
  RUIN_SITES.push(placed)
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
if (mx > 320 || mn < -40) fail(`height range out of bounds: ${mn.toFixed(1)}..${mx.toFixed(1)}`)
const hSpawn = hAt(SPAWN.x, SPAWN.z)
if (hSpawn < SEA + 1.5 || hSpawn > SEA + 6) fail(`spawn beach height ${hSpawn.toFixed(2)} outside 1.5..6`)
const hPeak = Math.max(hAt(VOLCANO.x, VOLCANO.z - 70), hAt(VOLCANO.x, VOLCANO.z + 70), hAt(VOLCANO.x - 70, VOLCANO.z), hAt(VOLCANO.x + 70, VOLCANO.z))
if (hPeak < 140) fail(`volcano rim only ${hPeak.toFixed(0)} m`)
// spawn → volcano sightline: from eye height at spawn, the rim must clear all terrain between
{
  const eye = hSpawn + 1.6
  const rim = { x: VOLCANO.x, z: VOLCANO.z + 90, y: hAt(VOLCANO.x, VOLCANO.z + 90) }
  let blocked = false
  for (let t = 0.05; t < 0.95; t += 0.01) {
    const x = SPAWN.x + (rim.x - SPAWN.x) * t
    const z = SPAWN.z + (rim.z - SPAWN.z) * t
    const sight = eye + (rim.y - eye) * t
    if (hAt(x, z) > sight + 2) { blocked = true; break }
  }
  if (blocked) fail('volcano rim not visible from spawn eye height')
}
// rivers must run downhill: sample the BED densely along each path, mouth → source
for (const [ri, path] of RIVERS_DENSE.entries()) {
  let prev = -Infinity
  const samples = []
  for (let i = path.length - 1; i > 0; i--) {
    for (let t = 0; t <= 1; t += 0.1) {
      samples.push({
        x: path[i].x + (path[i - 1].x - path[i].x) * t,
        z: path[i].z + (path[i - 1].z - path[i].z) * t,
      })
    }
  }
  for (const s of samples) {
    const h = hAt(s.x, s.z)
    if (h < prev - 2.5) fail(`river ${ri} bed rises then falls near (${s.x.toFixed(0)},${s.z.toFixed(0)}): ${h.toFixed(1)} after ${prev.toFixed(1)}`)
    prev = Math.max(prev, h)
  }
}
// lakes hold water: deep point below level; every shore vertex's outside
// ground above level (river corridors excepted)
for (const lake of LAKES) {
  if (hAt(lake.deep.x, lake.deep.z) > lake.level - 1) fail(`lake ${lake.name}: deep point above fill level`)
  for (const [vx, vz] of lake.shore) {
    // sample 6m outside the shoreline at this vertex
    const cx = lake.shore.reduce((a, v) => a + v[0], 0) / lake.shore.length
    const cz = lake.shore.reduce((a, v) => a + v[1], 0) / lake.shore.length
    const dx = vx - cx
    const dz = vz - cz
    const len = Math.hypot(dx, dz) || 1
    const sx = vx + (dx / len) * 6
    const sz = vz + (dz / len) * 6
    const nearRiver = RIVERS_DENSE.some((pp) => distToPath(sx, sz, pp).d < 28)
    if (!nearRiver && hAt(sx, sz) < lake.level + 0.1) {
      fail(`lake ${lake.name}: shore below level near (${vx},${vz})`)
      break
    }
  }
}

// ---------- outputs ----------
mkdirSync('public/world', { recursive: true })
const out = new Int16Array(SIDE * SIDE)
for (let i = 0; i < H.length; i++) out[i] = Math.round(H[i] / SCALE)
writeFileSync('public/world/heightmap.bin', Buffer.from(out.buffer))
const meta = {
  side: SIDE, res: RES, scale: SCALE, half: HALF, sea: SEA,
  spawn: SPAWN, volcano: VOLCANO,
  rivers: RIVERS_DENSE, lakes: LAKES, ruinSites: RUIN_SITES,
  swamp: SWAMP,
  bakedAt: new Date().toISOString(),
}
writeFileSync('public/world/world-meta.json', JSON.stringify(meta, null, 2))

// biome map: one byte per grid cell (0 default, 1 swamp, 2 desert, 3 plains,
// 4 alpine) — runtime scatter/colors/water read the SAME data as the bake
{
  const biomes = new Uint8Array(SIDE * SIDE)
  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const x = worldX(ix), z = worldZ(iz)
      const h = H[idx(ix, iz)]
      let b = 0
      if (warpedDist(x, z, SWAMP.x, SWAMP.z, SWAMP.r, 55) < SWAMP.r) b = 1
      else if (warpedDist(x, z, DESERT.x, DESERT.z, DESERT.r, 77) < DESERT.r) b = 2
      else if (warpedDist(x, z, PLAINS.x, PLAINS.z, PLAINS.r, 99) < PLAINS.r) b = 3
      else if (h > 52) b = 4
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
  const lx = -0.6, lz = -0.8 // light from the northwest
  for (let iz = Hh - 1; iz >= 0; iz--) { // BMP is bottom-up; row 0 = north
    for (let ix = 0; ix < W; ix++) {
      const h = H[idx(ix, iz)]
      const gx = H[idx(Math.min(ix + 1, W - 1), iz)] - H[idx(Math.max(ix - 1, 0), iz)]
      const gz = H[idx(ix, Math.min(iz + 1, Hh - 1))] - H[idx(ix, Math.max(iz - 1, 0))]
      const shade = Math.max(0, Math.min(1, 0.5 - (gx * lx + gz * lz) * 0.12))
      let r, g, b
      if (h < SEA) { r = 40; g = 80; b = 140 + Math.max(-60, h * 3) }
      else {
        const base = 60 + shade * 160
        r = base * (h > 100 ? 1 : 0.7)
        g = base
        b = base * 0.55
        if (h < SEA + 1.2) { r = 200; g = 190; b = 140 } // sand line
      }
      buf[o++] = b; buf[o++] = g; buf[o++] = r
    }
    o += rowPad
  }
  mkdirSync('shots', { recursive: true })
  writeFileSync('shots/island-hillshade.bmp', buf)
}

console.log(`baked: ${SIDE}×${SIDE} @ ${RES}m · height ${mn.toFixed(1)}..${mx.toFixed(1)} m`)
console.log(`spawn h=${hSpawn.toFixed(2)} · ruins: ${RUIN_SITES.map((r) => `${r.tag}(${r.x},${r.z})`).join(' ')}`)
console.log(`validators: ${process.exitCode ? 'FAILED' : 'all pass'}`)

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
const LAKES = [
  { x: -430, z: 20, r: 90, level: 14 }, // west river widens into a highland lake
  { x: 300, z: 300, r: 70, level: 6 },  // lowland lake east of center
]

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
    let h = 13 * fbm(wx * 0.0021, wz * 0.0021, 6)
    h += 5 * fbm(x * 0.011, z * 0.011, 4) // mid-frequency detail

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

    // the volcano: concave-flank cone + shoulder + crater (M3 recipe, kept)
    const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z)
    const cone = Math.max(0, 1 - dv / 320)
    h += 240 * cone * cone
    h += 40 * Math.exp(-(dv * dv) / (2 * 90 * 90))
    h -= 95 * Math.exp(-(dv * dv) / (2 * 48 * 48))

    // island falloff to ocean floor
    const r = Math.sqrt(x * x * 1.15 + z * z * 0.95)
    const falloff = smoothstep(690, 960, r)
    h = h * (1 - falloff) + -14 * falloff

    // spawn beach apron: calm, dry, wins over everything else
    const ds = Math.hypot(x - SPAWN.x, z - SPAWN.z)
    const beach = Math.exp(-(ds * ds) / (2 * 210 * 210)) * 0.92
    h = h * (1 - beach) + 3.0 * beach

    // lake basins: uniformly DEEP inside the waterline (a soft-blended basin
    // left a walkable shelf 1-3m under the surface — you could stand on the
    // bed with the water sheet overhead; backlog #3 "lake is floating")
    for (const lake of LAKES) {
      const d = Math.hypot(x - lake.x, z - lake.z)
      const w = smoothstep(lake.r * 1.02, lake.r * 0.8, d)
      h = h * (1 - w) + (lake.level - 4.5) * w
    }

    H[idx(ix, iz)] = h
  }
}
console.timeEnd('compose')

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
const RIVER_BEDS = RIVERS.map((path) => {
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
    for (let ri = 0; ri < RIVERS.length; ri++) {
      const { d, seg, t } = distToPath(x, z, RIVERS[ri])
      if (d > 120) continue
      const beds = RIVER_BEDS[ri]
      const bed = beds[seg] * (1 - t) + beds[seg + 1] * t
      // the east river's mid-course is a canyon: tight channel, steep walls,
      // raised rims; elsewhere a soft valley
      const canyon = ri === 0 && seg >= 1 && seg <= 3
      const sigma = canyon ? 14 : 22
      const wBed = Math.exp(-(d * d) / (2 * sigma * sigma))
      const wValley = (canyon ? 0.15 : 0.35) * Math.exp(-(d * d) / (2 * 65 * 65))
      const i0 = idx(ix, iz)
      const target = Math.min(H[i0], bed)
      H[i0] = H[i0] * (1 - wBed) + target * wBed - wValley * 2.0
      if (canyon) {
        // rim lift: shoulders rise above the surrounding ground
        H[i0] += 3.2 * Math.exp(-((d - 30) * (d - 30)) / (2 * 9 * 9))
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
  const MESAS = [
    { x: 560, z: -120, r: 70, top: 46 },
    { x: -560, z: -260, r: 60, top: 58 },
    { x: 620, z: 140, r: 45, top: 34 },
  ]
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

// lake shore ring: terrain just outside each basin must sit ABOVE the fill
// level, or the water disc edge hangs over lower ground ("infinity pool" rim
// seen edge-on — caught on the M5b screenshots)
for (let iz = 0; iz < SIDE; iz++) {
  for (let ix = 0; ix < SIDE; ix++) {
    const x = worldX(ix), z = worldZ(iz)
    for (const lake of LAKES) {
      const d = Math.hypot(x - lake.x, z - lake.z)
      if (d < lake.r * 0.92 || d > lake.r * 1.5) continue
      // rivers cut through the shore — leave their corridors as inlets/outlets
      let riverGap = false
      for (const path of RIVERS) {
        if (distToPath(x, z, path).d < 26) {
          riverGap = true
          break
        }
      }
      if (riverGap) continue
      const i0 = idx(ix, iz)
      // natural bank: wobble the ring radius and height with noise so the
      // shore doesn't read as a stamped circle (v1 looked like a crop circle)
      const wob = fbm(x * 0.022 + 3, z * 0.022 - 7, 3)
      const dw = d + wob * 14
      if (dw < lake.r * 0.92 || dw > lake.r * 1.5) continue
      const need = lake.level + 0.55 + wob * 0.5
      if (H[i0] < need) {
        const t = 1 - Math.abs(dw - lake.r * 1.1) / (lake.r * 0.45)
        H[i0] = Math.max(H[i0], need - 0.4 + Math.max(0, t) * (0.7 + wob * 0.5))
      }
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
for (const [ri, path] of RIVERS.entries()) {
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
// lakes hold water: basin floor below fill level, shore ring above it
for (const lake of LAKES) {
  if (hAt(lake.x, lake.z) > lake.level - 1) fail(`lake at (${lake.x},${lake.z}) floor above fill level`)
  for (let a = 0; a < Math.PI * 2; a += 0.3) {
    const sx = lake.x + Math.cos(a) * lake.r * 1.12
    const sz = lake.z + Math.sin(a) * lake.r * 1.12
    const nearRiver = RIVERS.some((p) => distToPath(sx, sz, p).d < 30)
    if (!nearRiver && hAt(sx, sz) < lake.level + 0.2) {
      fail(`lake at (${lake.x},${lake.z}) shore below fill level at angle ${a.toFixed(1)}`)
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
  rivers: RIVERS, lakes: LAKES, ruinSites: RUIN_SITES,
  bakedAt: new Date().toISOString(),
}
writeFileSync('public/world/world-meta.json', JSON.stringify(meta, null, 2))

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

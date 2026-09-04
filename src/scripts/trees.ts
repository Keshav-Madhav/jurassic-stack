// Built trees: wide-canopy broadleafs and elder giants, assembled from a
// tapered trunk, real branches, and a crown of many overlapping leaf masses —
// so a wood reads as one continuous canopy with trunks glimpsed beneath it
// (the ARK reference), not a field of lollipops. Deterministic per seed; the
// scatter treats a built root exactly like a loaded GLB (instanced, pivoted
// on the trunk base, harvestable).
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BARK = new THREE.Color(0x3a2a1c)
const BARK_LIT = new THREE.Color(0x5a4430)
// real-leaf greens (user art direction: dark like leaves in shadow) — the
// crown's underside runs blue-dark, its sunlit top toward yellow-green
const LEAF_DEEP = new THREE.Color(0x14301a)
const LEAF = new THREE.Color(0x1f4a17)
const LEAF_SUN = new THREE.Color(0x3a6a1e)

const _c = new THREE.Color()
const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)

/** Per-vertex color fill. */
function paint(geo: THREE.BufferGeometry, color: THREE.Color, jitter: number, rand: () => number): void {
  const n = geo.getAttribute('position').count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const k = 1 + (rand() - 0.5) * jitter
    col[i * 3] = color.r * k
    col[i * 3 + 1] = color.g * k
    col[i * 3 + 2] = color.b * k
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
}

/**
 * One leaf mass: a lumpy, flattened icosphere. Lumps come from a hash of the
 * vertex position so the (non-indexed) shared corners stay welded.
 */
let massDetail = 1
function leafMass(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: THREE.Color, rand: () => number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, massDetail)
  const pos = geo.getAttribute('position')
  const phase = rand() * 100
  for (let i = 0; i < pos.count; i++) {
    _v.set(pos.getX(i), pos.getY(i), pos.getZ(i))
    const h = Math.sin(_v.x * 7.3 + phase) * Math.cos(_v.y * 5.1 - phase) * Math.sin(_v.z * 6.7 + phase * 0.5)
    const k = 1 + h * 0.16
    pos.setXYZ(i, _v.x * k * rx + cx, _v.y * k * ry + cy, _v.z * k * rz + cz)
  }
  paint(geo, color, 0.12, rand)
  return geo
}

/** Tapered branch from a to b (radius r0 → r1). */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, segs: number, rand: () => number): THREE.BufferGeometry {
  const len = a.distanceTo(b)
  // non-indexed like the icospheres so the crown merges into one buffer
  const geo = new THREE.CylinderGeometry(r1, r0, len, segs, 1, true).toNonIndexed()
  geo.translate(0, len / 2, 0)
  _v.subVectors(b, a).normalize()
  _q.setFromUnitVectors(UP, _v)
  geo.applyQuaternion(_q)
  geo.translate(a.x, a.y, a.z)
  paint(geo, _c.copy(BARK).lerp(BARK_LIT, rand() * 0.5), 0.1, rand)
  return geo
}

function finish(parts: THREE.BufferGeometry[], name: string): THREE.Group {
  const geo = mergeGeometries(parts, false)!
  for (const p of parts) p.dispose()
  geo.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = name
  const g = new THREE.Group()
  g.add(mesh)
  g.updateMatrixWorld(true)
  return g
}

/**
 * Wide-canopy broadleaf, unit height. Short trunk, four to six limbs, and a
 * crown of nine lumpy masses a full tree-height across — crowns dominate.
 */
export function buildCanopyTree(seed: number, far = false): THREE.Group {
  massDetail = far ? 0 : 1 // far LOD: same layout and colours, 20-tri masses
  const rand = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const lean = (rand() - 0.5) * 0.06
  const trunkTop = new THREE.Vector3(lean, 0.42 + rand() * 0.06, lean * 0.5)
  // root flare + trunk (7 sides — the low-poly grain of the rest of the props)
  parts.push(limb(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(lean * 0.2, 0.07, lean * 0.1), 0.052, 0.036, 7, rand))
  parts.push(limb(new THREE.Vector3(lean * 0.2, 0.06, lean * 0.1), trunkTop, 0.036, 0.024, 7, rand))

  const crownY = 0.66 + rand() * 0.04
  // the ring: five masses around the crown's waist, each on a limb
  const n = 5
  const a0 = rand() * Math.PI * 2
  for (let i = 0; i < n; i++) {
    const ang = a0 + (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.5
    const rad = 0.22 + rand() * 0.1
    const y = crownY - 0.1 + rand() * 0.12
    const c = new THREE.Vector3(Math.cos(ang) * rad, y, Math.sin(ang) * rad)
    parts.push(limb(new THREE.Vector3(trunkTop.x, trunkTop.y - 0.04, trunkTop.z), c, 0.018, 0.008, 5, rand))
    const r = 0.16 + rand() * 0.06
    parts.push(leafMass(c.x, c.y, c.z, r, r * (0.7 + rand() * 0.15), r, _c.copy(LEAF).lerp(LEAF_DEEP, rand() * 0.5), rand))
  }
  // the heart: one big mass over the trunk
  parts.push(leafMass(trunkTop.x, crownY + 0.02, trunkTop.z, 0.3, 0.22, 0.3, LEAF, rand))
  // the crown top: two sunlit masses
  const top = 2
  for (let i = 0; i < top; i++) {
    const ang = rand() * Math.PI * 2
    const rad = 0.06 + rand() * 0.1
    const r = 0.13 + rand() * 0.05
    parts.push(leafMass(Math.cos(ang) * rad, 0.8 + rand() * 0.06, Math.sin(ang) * rad, r, r * 0.8, r, _c.copy(LEAF).lerp(LEAF_SUN, 0.35 + rand() * 0.4), rand))
  }
  return finish(parts, `CanopyTree_${seed}${far ? '_far' : ''}`)
}

/**
 * Elder giant, unit height (place at 35-55 m). Buttressed trunk that carries
 * more than half the height bare, then three tiers of crown — an old-growth
 * emergent the whole wood is seen against.
 */
export function buildElderTree(seed: number, far = false): THREE.Group {
  massDetail = far ? 0 : 1
  const rand = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const R = 0.05
  // buttress flare, then the great trunk in two tapering runs
  parts.push(limb(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(0, 0.06, 0), R * 1.9, R * 1.15, 9, rand))
  parts.push(limb(new THREE.Vector3(0, 0.055, 0), new THREE.Vector3(0.01, 0.5, 0), R * 1.15, R * 0.8, 9, rand))
  parts.push(limb(new THREE.Vector3(0.01, 0.49, 0), new THREE.Vector3(0.015, 0.9, 0.005), R * 0.8, R * 0.3, 7, rand))
  // three tiers of limbs + masses, narrowing upward
  const tiers = [
    { y: 0.5, n: 5, rad: 0.24, r: 0.12, lean: 0.06, tone: 0.55 },
    { y: 0.68, n: 6, rad: 0.2, r: 0.14, lean: 0.04, tone: 0.3 },
    { y: 0.84, n: 4, rad: 0.12, r: 0.11, lean: 0.03, tone: 0.1 },
  ]
  for (const t of tiers) {
    const a0 = rand() * Math.PI * 2
    for (let i = 0; i < t.n; i++) {
      const ang = a0 + (i / t.n) * Math.PI * 2 + (rand() - 0.5) * 0.4
      const rad = t.rad * (0.8 + rand() * 0.4)
      const c = new THREE.Vector3(Math.cos(ang) * rad, t.y + rand() * t.lean, Math.sin(ang) * rad)
      parts.push(limb(new THREE.Vector3(0.01, t.y - 0.03, 0), c, R * 0.35, R * 0.12, 5, rand))
      const r = t.r * (0.85 + rand() * 0.3)
      parts.push(leafMass(c.x, c.y + r * 0.2, c.z, r, r * 0.75, r, _c.copy(LEAF).lerp(LEAF_DEEP, t.tone * rand()).lerp(LEAF_SUN, (1 - t.tone) * 0.3 * rand()), rand))
    }
  }
  // the heart mass and the crown cap
  parts.push(leafMass(0.01, 0.72, 0, 0.19, 0.15, 0.19, LEAF, rand))
  parts.push(leafMass(0.015, 0.94, 0.005, 0.1, 0.08, 0.1, _c.copy(LEAF).lerp(LEAF_SUN, 0.6), rand))
  return finish(parts, `ElderTree_${seed}${far ? '_far' : ''}`)
}

/**
 * Distant stand-in (beyond ~900 m a tree is a few pixels): a trunk and one
 * or two coarse masses matching the kind's silhouette and leaf colour. Pines
 * get a dark cone. ~30-50 tris.
 */
export function buildDotTree(kind: 'canopy' | 'elder' | 'pine' | 'palm' | 'bare' | 'redwood', seed: number): THREE.Group {
  massDetail = 0
  const rand = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  if (kind === 'redwood') {
    // a tall red column with a narrow dark crown, readable from kilometres off
    const t = limb(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(0.01, 0.75, 0), 0.05, 0.02, 5, rand)
    paint(t, REDWOOD_BARK, 0.08, rand); parts.push(t)
    parts.push(leafMass(0.008, 0.7, 0, 0.12, 0.22, 0.12, _c.copy(LEAF).lerp(LEAF_DEEP, 0.4), rand))
    parts.push(leafMass(0.012, 0.92, 0.004, 0.07, 0.1, 0.07, LEAF, rand))
  } else if (kind === 'palm') {
    // a leaning trunk and one flat frond mass, palm-green
    parts.push(limb(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(0.08, 0.78, 0.04), 0.045, 0.03, 5, rand))
    parts.push(leafMass(0.08, 0.84, 0.04, 0.42, 0.14, 0.42, new THREE.Color(0x3f7a2c), rand))
  } else if (kind === 'bare') {
    // a dead tree from afar: trunk and two forks, no leaves
    parts.push(limb(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(0, 0.55, 0), 0.05, 0.03, 5, rand))
    parts.push(limb(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0.28, 0.95, 0.1), 0.03, 0.01, 4, rand))
    parts.push(limb(new THREE.Vector3(0, 0.55, 0), new THREE.Vector3(-0.24, 0.9, -0.14), 0.03, 0.01, 4, rand))
  } else if (kind === 'pine') {
    parts.push(limb(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(0, 0.3, 0), 0.03, 0.02, 5, rand))
    const cone = new THREE.CylinderGeometry(0.01, 0.22, 0.78, 7, 1, true).toNonIndexed()
    cone.translate(0, 0.61, 0)
    paint(cone, _c.copy(LEAF).lerp(LEAF_DEEP, 0.4), 0.1, rand)
    parts.push(cone)
  } else if (kind === 'elder') {
    parts.push(limb(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(0.01, 0.62, 0), 0.06, 0.035, 6, rand))
    parts.push(leafMass(0.01, 0.6, 0, 0.3, 0.16, 0.3, _c.copy(LEAF).lerp(LEAF_DEEP, 0.3), rand))
    parts.push(leafMass(0.015, 0.82, 0.005, 0.22, 0.17, 0.22, LEAF, rand))
  } else {
    parts.push(limb(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(0, 0.5, 0), 0.05, 0.03, 5, rand))
    parts.push(leafMass(0, 0.68, 0, 0.42, 0.3, 0.42, LEAF, rand))
  }
  return finish(parts, `Dot_${kind}_${seed}`)
}

/**
 * Mid-distance pine (300-900 m): three stacked cones on a trunk, painted in
 * the loaded pine's own leaf and bark colours so the swap doesn't read.
 * ~60 tris against the GLB's 616.
 */
export function buildFarPine(leaf: THREE.Color, bark: THREE.Color, seed: number): THREE.Group {
  const rand = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const trunk = new THREE.CylinderGeometry(0.02, 0.035, 0.4, 5, 1, true).toNonIndexed()
  trunk.translate(0, 0.19, 0)
  paint(trunk, bark, 0.08, rand)
  parts.push(trunk)
  for (const [y, r, h] of [[0.26, 0.27, 0.34], [0.5, 0.21, 0.32], [0.72, 0.14, 0.3]]) {
    const cone = new THREE.CylinderGeometry(0.005, r, h, 7, 1, true).toNonIndexed()
    cone.translate(0, y + h / 2, 0)
    paint(cone, _c.copy(leaf).multiplyScalar(0.9 + y * 0.2), 0.08, rand)
    parts.push(cone)
  }
  return finish(parts, `FarPine_${seed}`)
}

/**
 * A forest-floor mushroom cluster: three caps on stems, ~60 tris. (The
 * Quaternius "Mushroom" GLB turned out to be a 6K-tri mushroom CREATURE with
 * eyes and arms — 670 of them stood in the woods at knee height.)
 */
export function buildMushroom(seed: number): THREE.Group {
  massDetail = 0
  const rand = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const stemC = new THREE.Color(0xd8cdb0)
  const caps = [new THREE.Color(0x8a3a24), new THREE.Color(0xb0602a), new THREE.Color(0x6e4a2a)]
  const n = 2 + Math.floor(rand() * 2)
  for (let i = 0; i < n; i++) {
    const x = (rand() - 0.5) * 0.7
    const z = (rand() - 0.5) * 0.7
    const hgt = 0.45 + rand() * 0.55
    const stem = new THREE.CylinderGeometry(0.05, 0.07, hgt, 5, 1, true).toNonIndexed()
    stem.translate(x, hgt / 2 - 0.02, z)
    paint(stem, stemC, 0.08, rand)
    parts.push(stem)
    const r = 0.14 + rand() * 0.12
    parts.push(leafMass(x, hgt - r * 0.15, z, r, r * 0.55, r, caps[i % caps.length], rand))
  }
  return finish(parts, `Mushroom_${seed}`)
}

const REDWOOD_BARK = new THREE.Color(0x5a2e1e)
const REDWOOD_BARK_LIT = new THREE.Color(0x8a4a30)
/**
 * Redwood, unit height (place at 55-80 m): a fluted, buttressed red trunk
 * carrying more than half the height bare, then a narrow crown of small
 * dark masses in tiers — the emergent the Holm is seen by from anywhere on
 * the south half. Grows nowhere else.
 */
export function buildRedwood(seed: number, far = false): THREE.Group {
  massDetail = far ? 0 : 1
  const rand = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const R = 0.036
  const bark = (t: number) => _c.copy(REDWOOD_BARK).lerp(REDWOOD_BARK_LIT, t)
  // buttress flare, then the trunk in three tapering runs (9 sides: the
  // fluting reads at the base where you stand)
  const b0 = limb(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(0, 0.05, 0), R * 2.1, R * 1.25, 9, rand)
  paint(b0, bark(0.15), 0.1, rand); parts.push(b0)
  const b1 = limb(new THREE.Vector3(0, 0.045, 0), new THREE.Vector3(0.005, 0.45, 0), R * 1.25, R * 0.8, 9, rand)
  paint(b1, bark(0.35), 0.08, rand); parts.push(b1)
  const b2 = limb(new THREE.Vector3(0.005, 0.44, 0), new THREE.Vector3(0.01, 0.78, 0.004), R * 0.8, R * 0.45, 7, rand)
  paint(b2, bark(0.45), 0.08, rand); parts.push(b2)
  const b3 = limb(new THREE.Vector3(0.01, 0.77, 0.004), new THREE.Vector3(0.012, 0.99, 0.006), R * 0.45, R * 0.12, 6, rand)
  paint(b3, bark(0.5), 0.08, rand); parts.push(b3)
  // crown tiers: narrow — a redwood is a column, not a dome
  const tiers = [
    { y: 0.56, n: 4, rad: 0.11, r: 0.075, tone: 0.6 },
    { y: 0.68, n: 4, rad: 0.1, r: 0.08, tone: 0.45 },
    { y: 0.8, n: 3, rad: 0.08, r: 0.07, tone: 0.3 },
    { y: 0.9, n: 3, rad: 0.05, r: 0.06, tone: 0.15 },
  ]
  for (const t of tiers) {
    const a0 = rand() * Math.PI * 2
    for (let i = 0; i < t.n; i++) {
      const ang = a0 + (i / t.n) * Math.PI * 2 + (rand() - 0.5) * 0.5
      const rad = t.rad * (0.8 + rand() * 0.4)
      const c = new THREE.Vector3(Math.cos(ang) * rad, t.y + (rand() - 0.5) * 0.03, Math.sin(ang) * rad)
      const lb = limb(new THREE.Vector3(0.008, t.y - 0.02, 0.003), c, R * 0.25, R * 0.08, 4, rand)
      paint(lb, bark(0.4), 0.08, rand); parts.push(lb)
      const r = t.r * (0.85 + rand() * 0.3)
      parts.push(leafMass(c.x, c.y + r * 0.3, c.z, r, r * 0.8, r, _c.copy(LEAF).lerp(LEAF_DEEP, t.tone * 0.9).lerp(LEAF_SUN, (1 - t.tone) * 0.25), rand))
    }
  }
  parts.push(leafMass(0.012, 0.985, 0.006, 0.045, 0.06, 0.045, _c.copy(LEAF).lerp(LEAF_SUN, 0.4), rand)) // the spire
  return finish(parts, `Redwood_${seed}${far ? '_far' : ''}`)
}

// ---------- swamp + desert flora (mandate item 4) ----------
const MANGROVE_LEAF = new THREE.Color(0x3d5a1e)
const MANGROVE_BARK = new THREE.Color(0x4a3a2a)
/**
 * Mangrove-type swamp tree, unit height (place at 7-12 m): a short trunk on
 * a splay of stilt roots that reach the water, a low broad olive crown.
 */
export function buildMangrove(seed: number, far = false): THREE.Group {
  massDetail = far ? 0 : 1
  const rand = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const trunkBase = new THREE.Vector3(0, 0.22, 0)
  const trunkTop = new THREE.Vector3(0.02, 0.5, 0.01)
  // stilt roots: from the trunk's foot down and out to the ground
  const n = 5 + Math.floor(rand() * 3)
  const a0 = rand() * Math.PI * 2
  for (let i = 0; i < n; i++) {
    const ang = a0 + (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.6
    const rad = 0.16 + rand() * 0.12
    const foot = new THREE.Vector3(Math.cos(ang) * rad, -0.03, Math.sin(ang) * rad)
    const root = limb(trunkBase, foot, 0.022, 0.012, 4, rand)
    paint(root, MANGROVE_BARK, 0.12, rand); parts.push(root)
  }
  const trunk = limb(new THREE.Vector3(0, 0.2, 0), trunkTop, 0.032, 0.022, 6, rand)
  paint(trunk, MANGROVE_BARK, 0.1, rand); parts.push(trunk)
  // crown: a low, broad spread of masses
  const m = 5 + Math.floor(rand() * 2)
  const b0 = rand() * Math.PI * 2
  for (let i = 0; i < m; i++) {
    const ang = b0 + (i / m) * Math.PI * 2 + (rand() - 0.5) * 0.5
    const rad = 0.2 + rand() * 0.14
    const c = new THREE.Vector3(Math.cos(ang) * rad, 0.58 + rand() * 0.12, Math.sin(ang) * rad)
    const lb = limb(trunkTop, c, 0.014, 0.006, 4, rand)
    paint(lb, MANGROVE_BARK, 0.1, rand); parts.push(lb)
    const r = 0.17 + rand() * 0.07
    parts.push(leafMass(c.x, c.y, c.z, r, r * 0.6, r, _c.copy(MANGROVE_LEAF).lerp(LEAF_DEEP, rand() * 0.4), rand))
  }
  parts.push(leafMass(trunkTop.x, 0.72, trunkTop.z, 0.26, 0.16, 0.26, MANGROVE_LEAF, rand))
  return finish(parts, `Mangrove_${seed}${far ? '_far' : ''}`)
}

const TWIG = new THREE.Color(0x6b5a3a)
/** A dead, dried bush: a fan of bare twigs, unit height (place at 1-2 m). ~120 tris. */
export function buildDriedBush(seed: number): THREE.Group {
  const rand = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const n = 10 + Math.floor(rand() * 5)
  for (let i = 0; i < n; i++) {
    const ang = rand() * Math.PI * 2
    const spread = 0.25 + rand() * 0.35
    const top = new THREE.Vector3(Math.cos(ang) * spread, 0.55 + rand() * 0.45, Math.sin(ang) * spread)
    const tw = limb(new THREE.Vector3((rand() - 0.5) * 0.08, -0.02, (rand() - 0.5) * 0.08), top, 0.018, 0.004, 3, rand)
    paint(tw, _c.copy(TWIG).lerp(new THREE.Color(0x8a7a5a), rand() * 0.5), 0.1, rand); parts.push(tw)
    // a fork on most twigs
    if (rand() < 0.7) {
      const fork = new THREE.Vector3(top.x + (rand() - 0.5) * 0.3, top.y + 0.15 + rand() * 0.15, top.z + (rand() - 0.5) * 0.3)
      const f = limb(new THREE.Vector3(top.x * 0.7, top.y * 0.7, top.z * 0.7), fork, 0.01, 0.003, 3, rand)
      paint(f, TWIG, 0.1, rand); parts.push(f)
    }
  }
  return finish(parts, `DriedBush_${seed}`)
}

const CACTUS = new THREE.Color(0x3f7a3a)
/** A saguaro-type cactus, unit height (place at 2.5-5 m): a ribbed column and one or two arms. */
export function buildCactus(seed: number): THREE.Group {
  massDetail = 0
  const rand = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const col = limb(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(0, 0.95, 0), 0.075, 0.055, 8, rand)
  paint(col, CACTUS, 0.14, rand); parts.push(col)
  parts.push(leafMass(0, 0.95, 0, 0.06, 0.05, 0.06, CACTUS, rand)) // the cap
  const arms = 1 + Math.floor(rand() * 2)
  const a0 = rand() * Math.PI * 2
  for (let i = 0; i < arms; i++) {
    const ang = a0 + i * Math.PI * (0.8 + rand() * 0.4)
    const y0 = 0.35 + rand() * 0.25
    const elbow = new THREE.Vector3(Math.cos(ang) * 0.17, y0 + 0.02, Math.sin(ang) * 0.17)
    const tip = new THREE.Vector3(elbow.x, y0 + 0.3 + rand() * 0.15, elbow.z)
    const a1 = limb(new THREE.Vector3(0, y0, 0), elbow, 0.05, 0.045, 7, rand)
    paint(a1, CACTUS, 0.14, rand); parts.push(a1)
    const a2 = limb(elbow, tip, 0.045, 0.04, 7, rand)
    paint(a2, CACTUS, 0.14, rand); parts.push(a2)
    parts.push(leafMass(tip.x, tip.y, tip.z, 0.045, 0.04, 0.045, CACTUS, rand))
  }
  return finish(parts, `Cactus_${seed}`)
}

const REED = new THREE.Color(0x6a7a3a)
/** A clump of reeds, unit height (place at 1.5-2.6 m): tall thin blades. ~50 tris. */
export function buildReeds(seed: number): THREE.Group {
  const rand = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const n = 7 + Math.floor(rand() * 4)
  for (let i = 0; i < n; i++) {
    const ang = rand() * Math.PI * 2
    const r0 = rand() * 0.1
    const lean = 0.08 + rand() * 0.12
    const top = new THREE.Vector3(Math.cos(ang) * (r0 + lean), 0.7 + rand() * 0.3, Math.sin(ang) * (r0 + lean))
    const blade = limb(new THREE.Vector3(Math.cos(ang) * r0, -0.02, Math.sin(ang) * r0), top, 0.014, 0.002, 3, rand)
    paint(blade, _c.copy(REED).lerp(new THREE.Color(0x9a8a4a), rand() * 0.5), 0.1, rand); parts.push(blade)
  }
  return finish(parts, `Reeds_${seed}`)
}

// ---------- ground clutter + rock (mandate items 5 and 7) ----------
const STONE = new THREE.Color(0x5e5b56)
const STONE_LIT = new THREE.Color(0x8a867e)
const STONE_WARM = new THREE.Color(0x6e6254)
/** A lumpy stone, squashed; `r` in the unit prop's own scale. */
function stone(cx: number, cy: number, cz: number, r: number, rand: () => number, detail = 0): THREE.BufferGeometry {
  const save = massDetail
  massDetail = detail
  const g = leafMass(cx, cy, cz, r * (0.8 + rand() * 0.5), r * (0.45 + rand() * 0.3), r * (0.8 + rand() * 0.5), _c.copy(STONE).lerp(rand() < 0.5 ? STONE_LIT : STONE_WARM, rand() * 0.7), rand)
  massDetail = save
  return g
}

/** Pebbles: a handful of small stones in a spill, unit ~0.4 m. ~100 tris. */
export function buildPebbles(seed: number): THREE.Group {
  const rand = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const n = 4 + Math.floor(rand() * 4)
  for (let i = 0; i < n; i++) {
    const r = 0.12 + rand() * 0.18
    parts.push(stone((rand() - 0.5) * 1.6, r * 0.35, (rand() - 0.5) * 1.6, r, rand))
  }
  return finish(parts, `Pebbles_${seed}`)
}

/** Stones: two or three knee-high rocks together, unit ~1 m. ~250 tris. */
export function buildStones(seed: number): THREE.Group {
  const rand = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const n = 2 + Math.floor(rand() * 2)
  for (let i = 0; i < n; i++) {
    const r = 0.3 + rand() * 0.35
    parts.push(stone((rand() - 0.5) * 1.1, r * 0.4, (rand() - 0.5) * 1.1, r, rand, 1))
  }
  return finish(parts, `Stones_${seed}`)
}

/** Sticks: fallen branches lying on the ground, unit ~0.3 m tall. ~40 tris. */
export function buildSticks(seed: number): THREE.Group {
  const rand = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const n = 2 + Math.floor(rand() * 2)
  for (let i = 0; i < n; i++) {
    const ang = rand() * Math.PI * 2
    const len = 0.8 + rand() * 1.2
    const a = new THREE.Vector3(Math.cos(ang) * -len / 2, 0.05, Math.sin(ang) * -len / 2)
    const b = new THREE.Vector3(Math.cos(ang) * len / 2, 0.05 + rand() * 0.25, Math.sin(ang) * len / 2)
    const st = limb(a, b, 0.05 + rand() * 0.03, 0.025, 4, rand)
    paint(st, _c.copy(BARK).lerp(TWIG, rand() * 0.6), 0.12, rand); parts.push(st)
    if (rand() < 0.6) {
      const m = a.clone().lerp(b, 0.4 + rand() * 0.3)
      const tip = new THREE.Vector3(m.x + (rand() - 0.5) * 0.6, m.y + 0.1 + rand() * 0.2, m.z + (rand() - 0.5) * 0.6)
      const br = limb(m, tip, 0.025, 0.008, 3, rand)
      paint(br, TWIG, 0.1, rand); parts.push(br)
    }
  }
  return finish(parts, `Sticks_${seed}`)
}

/**
 * An outcrop: a formation of four to six boulders leaning together, unit
 * height (place at 5-14 m) — the rock the hills and cliffs were missing.
 */
export function buildOutcrop(seed: number, far = false): THREE.Group {
  const rand = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  const n = 4 + Math.floor(rand() * 3)
  for (let i = 0; i < n; i++) {
    const r = 0.28 + rand() * 0.3
    const ang = rand() * Math.PI * 2
    const rad = rand() * 0.35
    parts.push(stone(Math.cos(ang) * rad, r * 0.55 + rand() * 0.2, Math.sin(ang) * rad, r, rand, far ? 0 : 1))
  }
  parts.push(stone(0, 0.62, 0, 0.42, rand, far ? 0 : 1)) // the crown stone
  return finish(parts, `Outcrop_${seed}${far ? '_far' : ''}`)
}

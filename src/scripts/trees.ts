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
  // the ring: five or six masses around the crown's waist, each on a limb
  const n = 5 + Math.floor(rand() * 2)
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
  // the crown top: two or three sunlit masses
  const top = 2 + Math.floor(rand() * 2)
  for (let i = 0; i < top; i++) {
    const ang = rand() * Math.PI * 2
    const rad = 0.06 + rand() * 0.1
    const r = 0.13 + rand() * 0.05
    parts.push(leafMass(Math.cos(ang) * rad, 0.8 + rand() * 0.06, Math.sin(ang) * rad, r, r * 0.8, r, _c.copy(LEAF).lerp(LEAF_SUN, 0.35 + rand() * 0.4), rand))
  }
  // one low hanger — the skirt that hides the trunk from a distance
  {
    const ang = rand() * Math.PI * 2
    const r = 0.13 + rand() * 0.04
    parts.push(leafMass(Math.cos(ang) * 0.28, crownY - 0.2, Math.sin(ang) * 0.28, r, r * 0.7, r, _c.copy(LEAF).lerp(LEAF_DEEP, 0.6), rand))
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
export function buildDotTree(kind: 'canopy' | 'elder' | 'pine', seed: number): THREE.Group {
  massDetail = 0
  const rand = mulberry32(seed)
  const parts: THREE.BufferGeometry[] = []
  if (kind === 'pine') {
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

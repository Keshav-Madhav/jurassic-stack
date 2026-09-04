// World props + resource nodes, v2 (the M6a density pass).
//
// - ~15 prop types across 12 kinds, several extracted as named sub-nodes from
//   Quaternius variant packs (DeadTree_10…, Flower clumps, berry bush).
// - Placement is habitat-driven: a seeded forest-mask noise clusters trees
//   into woods with real clearings; palms take the beach band, willows the
//   riverbanks, dead trees the dry fringes, ferns/mushrooms the forest floor,
//   flowers the clearings. Uniform sprinkle is gone.
// - Every instance is still a harvestable node (hp / yields / respawn), and
//   per-instance tint + wide scale ranges break up repetition.
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { heightAt, lodFloorAt, normalAt, forestMaskAt, forestKindAt, biomeAt, shoreDist, BIOME, FOREST_KIND, SEA_LEVEL, HALF_SIZE, SPAWN, VOLCANO, worldMeta } from './heightmap'
import { buildCanopyTree, buildElderTree, buildDotTree, buildFarPine, buildMushroom } from './trees'
import { CHUNK_SIZE, CHUNKS_PER_SIDE } from './terrain'
import { addObstacle } from './obstacles'
import type { Physics } from './physics'
import type { ItemId } from './items'

export type NodeKind =
  | 'tree' | 'elder' | 'pine' | 'deadtree' | 'palm' | 'willow'
  | 'rock' | 'log' | 'bush' | 'fern' | 'flower' | 'grass' | 'mushroom'

export interface ScatterNode {
  id: number
  kind: NodeKind
  variant: number
  x: number
  y: number
  z: number
  scale: number
  rotY: number
  tint: number
  hp: number
  alive: boolean
  respawnAt: number
}

const NODE_DEFS: Record<NodeKind, { hp: number; yields: Partial<Record<ItemId, [number, number]>> }> = {
  tree: { hp: 3, yields: { wood: [2, 4], fiber: [1, 2] } },
  elder: { hp: 6, yields: { wood: [5, 9], fiber: [2, 4] } },
  pine: { hp: 3, yields: { wood: [2, 4], fiber: [1, 2] } },
  deadtree: { hp: 2, yields: { wood: [2, 3] } },
  palm: { hp: 3, yields: { wood: [2, 3], fiber: [1, 3] } },
  willow: { hp: 3, yields: { wood: [2, 4] } },
  rock: { hp: 3, yields: { stone: [2, 3], flint: [0, 2] } },
  log: { hp: 1, yields: { wood: [1, 2] } },
  bush: { hp: 2, yields: { berry: [2, 4], fiber: [1, 3] } },
  fern: { hp: 1, yields: { fiber: [1, 2] } },
  flower: { hp: 1, yields: { fiber: [1, 1] } },
  grass: { hp: 1, yields: { fiber: [1, 2] } },
  mushroom: { hp: 1, yields: { berry: [1, 1] } },
}

/** Kinds whose trunks get physics cylinders (rocks: squat cylinders too). */
const TRUNK_KINDS = new Set<NodeKind>(['tree', 'elder', 'pine', 'palm', 'deadtree', 'willow', 'rock'])
/** Single-trunk canopy kinds: wide crowns in the air, so slope under the
 *  footprint doesn't matter (the flatness guard is for merged groves). */
const CANOPY_KINDS = new Set<NodeKind>(['tree', 'elder'])

interface ModelRef {
  /** GLB in models/props/ … */
  file?: string
  /** optional named sub-node to extract (variant packs) */
  node?: string
  /** … or a tree built in code (trees.ts), deterministic per seed */
  gen?: 'canopy' | 'elder' | 'mushroom'
  seed?: number
}

const KIND_MODELS: Record<NodeKind, ModelRef[]> = {
  // broadleaf woods: built wide-canopy trees (the Quaternius round crowns
  // read as neon lollipops against them and are out of the mix)
  tree: [{ gen: 'canopy', seed: 11 }, { gen: 'canopy', seed: 12 }, { gen: 'canopy', seed: 13 }, { gen: 'canopy', seed: 14 }],
  elder: [{ gen: 'elder', seed: 21 }, { gen: 'elder', seed: 22 }],
  pine: [{ file: 'Pine1' }],
  deadtree: [
    { file: 'DeadTree', node: 'DeadTree_10' },
    { file: 'DeadTree', node: 'DeadTree_8' },
    { file: 'DeadTree', node: 'DeadTree_6' },
  ],
  palm: [{ file: 'Palm' }],
  willow: [{ file: 'Willow' }],
  rock: [{ file: 'Rock1' }, { file: 'Rock2' }],
  log: [{ file: 'MossRock' }],
  bush: [{ file: 'Bush1' }, { file: 'BerryBush', node: 'Bush' }],
  fern: [{ file: 'Fern' }],
  flower: [
    { file: 'Flower', node: 'Flower_1_Clump' },
    { file: 'Flower', node: 'Flower_3_Clump' },
    { file: 'Flower', node: 'Flower_5_Clump' },
  ],
  grass: [{ file: 'Grass1' }],
  mushroom: [{ gen: 'mushroom', seed: 31 }, { gen: 'mushroom', seed: 32 }],
}

/** cell size, base chance, scale range, cap, seed, habitat rule */
interface PlaceSpec {
  cell: number
  chance: number
  sMin: number
  sMax: number
  cap: number
  seed: number
  habitat: (h: number, ny: number, forest: number, riverD: number, fkind: number, coastD: number) => boolean
  /** forest kinds: chance also scales with wood fullness (thin at the wood line) */
  woodland?: boolean
}

// caps are for the 4 km island (4× the 2 km ones): the scan runs north→south,
// so a cap hit early starves the spawn beach of grass
const SPECS: Record<NodeKind, PlaceSpec> = {
  // THE WOODS (hand-traced in tools/hand-geometry.mjs, baked to forest.bin):
  // `forest` is fullness in [-1, 1] — -1 open country, 0 the feathered wood
  // line, +1 the deep interior. Trees pack tight (9 m cells) and thin toward
  // the line; elders stand only in the old-growth cores of broadleaf woods.
  tree: {
    cell: 9, chance: 0.82, sMin: 11, sMax: 17, cap: 80000, seed: 101, woodland: true,
    // altitude caps: broadleaf to ~130 m, pines to ~210 m; above is alpine rock
    habitat: (h, _ny, f, _rd, k) => f > -0.4 && h > 3.2 && h < 130 && (k === FOREST_KIND.BROADLEAF || k === FOREST_KIND.MIXED),
  },
  elder: {
    cell: 36, chance: 0.62, sMin: 36, sMax: 52, cap: 2400, seed: 121,
    habitat: (h, _ny, f, _rd, k) => f > 0.5 && h > 4 && h < 100 && k === FOREST_KIND.BROADLEAF,
  },
  pine: {
    cell: 7, chance: 0.78, sMin: 10, sMax: 20, cap: 64000, seed: 202, woodland: true,
    habitat: (h, _ny, f, _rd, k) => f > -0.45 && h > 6 && h < 210 && (k === FOREST_KIND.PINE || k === FOREST_KIND.MIXED),
  },
  // dead trees: the dry open country outside the wood line (and the swamp)
  deadtree: { cell: 64, chance: 0.28, sMin: 4, sMax: 8, cap: 2000, seed: 707, habitat: (h, _ny, f) => f < -0.7 && h > 4 },
  // palms: the beach band only (the spawn plain sits at 3 m for 400 m inland
  // and grew palms like a plantation) — `riverD` slot carries coast distance
  palm: { cell: 24, chance: 0.5, sMin: 5, sMax: 9, cap: 2400, seed: 808, habitat: (h, _ny, _f, _rd, _k, coastD) => h > 1.1 && h < 4.2 && coastD < 150 },
  willow: { cell: 30, chance: 0.55, sMin: 5, sMax: 8.5, cap: 1400, seed: 909, habitat: (h, _ny, _f, riverD) => riverD < 34 && riverD > 13 && h > 2 },
  rock: { cell: 40, chance: 0.4, sMin: 0.8, sMax: 2.4, cap: 6400, seed: 303, habitat: () => true },
  log: { cell: 40, chance: 0.4, sMin: 1.2, sMax: 2.2, cap: 4000, seed: 606, habitat: (h, _ny, f) => f > -0.3 && h > 3 },
  // the understory: bushes everywhere but thicker under the canopy, ferns and
  // mushrooms on the forest floor, flowers in the open and the glades
  bush: { cell: 13, chance: 0.6, sMin: 1.1, sMax: 2.9, cap: 36000, seed: 404, habitat: (h) => h > 2.2 },
  fern: { cell: 10, chance: 0.72, sMin: 0.8, sMax: 1.9, cap: 64000, seed: 505, habitat: (h, _ny, f) => f > -0.5 && h > 3 },
  flower: { cell: 18, chance: 0.5, sMin: 0.6, sMax: 1.2, cap: 10400, seed: 111, habitat: (h, _ny, f) => f < -0.6 && h > 2.4 },
  grass: { cell: 7, chance: 0.72, sMin: 0.45, sMax: 1.2, cap: 120000, seed: 555, habitat: (h) => h > 1.6 },
  mushroom: { cell: 26, chance: 0.45, sMin: 0.35, sMax: 0.8, cap: 3600, seed: 222, habitat: (h, _ny, f) => f > 0 && h > 3 },
}

const RESPAWN_MS = 240_000
/** Supercell edge (m): instances group per cell so frustum culling and the
 *  LOD bands work per cell (512 m cells quadrupled the drawn triangles: every
 *  tree in a cell whose near edge was close rendered at full detail).
 *  Distance tests use the cell's bounding box, not its centre. */
const SUPER = 256
/** Ground-cover kinds: no shadow casting, distance-culled. */
const GROUND_COVER = new Set<NodeKind>(['grass', 'fern', 'flower', 'mushroom', 'log', 'bush'])
/** Cover cells beyond this range from the player are hidden entirely. */
const COVER_DRAW_DIST = 340
/** Tree LOD bands per supercell (viewer distance to cell centre): built
 *  trees swap to 20-tri leaf masses beyond FAR, and every tree kind becomes
 *  a ~40-tri trunk-and-blob beyond DOT (a few pixels tall in the haze). */
const TREE_LOD_FAR = 180
const TREE_LOD_DOT = 900
const DOT_KINDS: Partial<Record<NodeKind, 'canopy' | 'elder' | 'pine' | 'palm' | 'bare'>> = {
  tree: 'canopy', elder: 'elder', pine: 'pine', palm: 'palm', deadtree: 'bare', willow: 'canopy',
}
/** Small solid props (boulders, logs) vanish beyond this — a 2 m rock is a
 *  pixel at 600 m, but 2,000 of them at full geometry are not free. */
const SMALL_SOLID_DRAW_DIST = 600
const SMALL_SOLID = new Set<NodeKind>(['rock'])

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}


function groupKeyOf(kind: NodeKind, variant: number, x: number, z: number): string {
  return `${kind}#${variant}#${Math.floor((x + HALF_SIZE) / SUPER)},${Math.floor((z + HALF_SIZE) / SUPER)}`
}
function parseGroupKey(key: string): { kind: NodeKind; variant: number } {
  const [kind, v] = key.split('#')
  return { kind: kind as NodeKind, variant: Number(v) }
}

function riverDistAt(x: number, z: number): number {
  const meta = worldMeta
  if (!meta) return Infinity
  let best = Infinity
  for (const path of meta.rivers) {
    for (let i = 0; i < path.length - 1; i++) {
      const ax = path[i].x
      const az = path[i].z
      const dx = path[i + 1].x - ax
      const dz = path[i + 1].z - az
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t))
      if (d < best) best = d
    }
  }
  for (const lake of meta.lakes) {
    best = Math.min(best, Math.abs(shoreDist(x, z, lake.shore)))
  }
  return best
}

/**
 * Clone a geometry with position/normal promoted to float32 — quantized
 * attributes are corrupted by applyMatrix4 writing floats into int arrays.
 */
function toFloatGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = src.clone()
  for (const name of ['position', 'normal']) {
    const attr = geo.getAttribute(name)
    if (!attr || (attr.array instanceof Float32Array && !attr.normalized)) continue
    const out = new Float32Array(attr.count * 3)
    for (let i = 0; i < attr.count; i++) {
      out[i * 3] = attr.getX(i)
      out[i * 3 + 1] = attr.getY(i)
      out[i * 3 + 2] = attr.getZ(i)
    }
    geo.setAttribute(name, new THREE.BufferAttribute(out, 3))
  }
  return geo
}

/** One prop rendered as N InstancedMeshes (one per submesh), sharing matrices. */
class InstancedProp {
  meshes: THREE.InstancedMesh[] = []
  private dummy = new THREE.Object3D()
  private castShadowFlag = true

  constructor(
    root: THREE.Object3D,
    capacity: number,
    group: THREE.Group,
    castShadow: boolean,
    private recolor?: (mat: THREE.MeshStandardMaterial) => void,
  ) {
    this.castShadowFlag = castShadow
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const s = 1 / (size.y || 1) // normalize to 1 m tall; instance scale = world height
    root.updateMatrixWorld(true)

    // pivot on the BASE of the prop (avg xz of its lowest vertices), so trunks
    // stand exactly on the node position — bbox-center pivoting shifted trunks
    // by their canopy asymmetry and broke aimed swings + trunk colliders
    let baseX = 0
    let baseZ = 0
    let baseN = 0
    const bandTop = box.min.y + size.y * 0.15
    const v = new THREE.Vector3()
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position')
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld)
        if (v.y <= bandTop) {
          baseX += v.x
          baseZ += v.z
          baseN++
        }
      }
    })
    const cx = baseN ? baseX / baseN : (box.min.x + box.max.x) / 2
    const cz = baseN ? baseZ / baseN : (box.min.z + box.max.z) / 2

    // Ground on the CENTRAL COLUMN's lowest point (the trunk), not the global
    // min: canopies that droop below the trunk base otherwise become the
    // "feet", hoisting the trunk meters into the air at large scales — the
    // giant sky-trunk bug. Drooping leaves may kiss the ground instead; right.
    const colR = Math.max(0.5, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.18)
    let centralMinY = Infinity
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const posA = (o.geometry as THREE.BufferGeometry).getAttribute('position')
      const vv = new THREE.Vector3()
      for (let i = 0; i < posA.count; i++) {
        vv.set(posA.getX(i), posA.getY(i), posA.getZ(i)).applyMatrix4(o.matrixWorld)
        if (Math.hypot(vv.x - cx, vv.z - cz) < colR && vv.y < centralMinY) centralMinY = vv.y
      }
    })
    const groundY = Number.isFinite(centralMinY) ? centralMinY : box.min.y

    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const geo = toFloatGeometry(o.geometry as THREE.BufferGeometry)
      geo.applyMatrix4(o.matrixWorld)
      geo.translate(-cx, 0, -cz)
      geo.scale(s, s, s)
      geo.translate(0, -groundY * s, 0) // trunk base at y=0
      const mat = (o.material as THREE.MeshStandardMaterial).clone()
      mat.roughness = 1
      mat.metalness = 0
      // real-leaf greens: Quaternius foliage ships bright — pull green-dominant
      // materials toward deep leaf green (user art direction: darker world)
      // green AND yellow-green foliage (the willow's leaves have high red and
      // slipped the strict test — the neon bush on the riverbank)
      if (mat.color.g > mat.color.r * 0.9 && mat.color.g > mat.color.b * 1.1 && mat.color.g > 0.25) {
        mat.color.lerp(new THREE.Color(0x14300f), 0.55)
      }
      if (this.recolor) this.recolor(mat)
      const im = new THREE.InstancedMesh(geo, mat, capacity)
      im.count = 0
      im.frustumCulled = true // per-supercell now — computeBounds() after fill
      im.matrixAutoUpdate = false // static: thousands of these, one less matrix multiply each per frame
      im.castShadow = this.castShadowFlag
      im.receiveShadow = true
      this.meshes.push(im)
      group.add(im)
    })
  }

  setInstance(i: number, x: number, y: number, z: number, scale: number, rotY: number, tint = 1): void {
    this.dummy.position.set(x, y, z)
    this.dummy.rotation.set(0, rotY, 0)
    this.dummy.scale.setScalar(scale)
    this.dummy.updateMatrix()
    const c = new THREE.Color(tint, tint, tint)
    for (const m of this.meshes) {
      m.setMatrixAt(i, this.dummy.matrix)
      m.setColorAt(i, c)
      m.count = Math.max(m.count, i + 1)
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
  }

  /** Hide by zero-scaling AT the node position (a zero matrix at the origin
   *  would balloon the instanced bounding sphere toward world 0,0,0). */
  hideInstance(i: number, x: number, y: number, z: number): void {
    this.dummy.position.set(x, y, z)
    this.dummy.rotation.set(0, 0, 0)
    this.dummy.scale.setScalar(0.0001)
    this.dummy.updateMatrix()
    for (const m of this.meshes) {
      m.setMatrixAt(i, this.dummy.matrix)
      m.instanceMatrix.needsUpdate = true
    }
  }

  /** Compute per-mesh bounding spheres from the filled instances. */
  computeBounds(): void {
    for (const m of this.meshes) m.computeBoundingSphere()
  }
}

export class Scatter {
  readonly group = new THREE.Group()
  readonly nodes: ScatterNode[] = []
  private props = new Map<string, InstancedProp>()
  /** far-LOD twins of built-tree groups, same instance slots */
  private farProps = new Map<string, InstancedProp>()
  /** distant stand-ins: ONE instanced mesh per kind for the whole island
   *  (a per-cell dot mesh was a draw call each — hundreds of 30-tri draws),
   *  instances laid out cell by cell so a cell's range flips as one block */
  private dots = new Map<NodeKind, { prop: InstancedProp; ranges: Map<string, { start: number; count: number; shown: boolean }>; slotOf: Map<number, number> }>()
  private order = new Map<string, number[]>()
  private propMeta = new Map<string, { minX: number; maxX: number; minZ: number; maxZ: number; cover: boolean; small: boolean }>()
  private treeColliders = new Map<number, RAPIER.Collider>()
  private activeChunks = new Set<number>()
  private lastChunkKey = -1
  private tmpN = new THREE.Vector3()
  private pendingColliderDrops: number[] = []

  async load(): Promise<void> {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const files = [...new Set(Object.values(KIND_MODELS).flat().map((m) => m.file).filter((f): f is string => !!f))]
    const loaded = new Map<string, THREE.Group>()
    await Promise.all(
      files.map(async (f) => {
        loaded.set(f, (await loader.loadAsync(`models/props/${f}.glb`)).scene)
      }),
    )
    // built trees (trees.ts) sit beside the loaded GLBs, keyed by gen+seed
    const built = new Map<string, THREE.Group>()
    for (const ref of Object.values(KIND_MODELS).flat()) {
      if (!ref.gen) continue
      const key = `${ref.gen}:${ref.seed}`
      if (built.has(key)) continue
      if (ref.gen === 'mushroom') {
        built.set(key, buildMushroom(ref.seed ?? 1))
        continue
      }
      const make = ref.gen === 'elder' ? buildElderTree : buildCanopyTree
      built.set(key, make(ref.seed ?? 1))
      built.set(key + ':far', make(ref.seed ?? 1, true))
    }
    const rootOf = (ref: ModelRef, far = false): THREE.Object3D => {
      if (ref.gen) return built.get(`${ref.gen}:${ref.seed}${far ? ':far' : ''}`)!
      const src = loaded.get(ref.file!)!
      return ref.node ? (src.getObjectByName(ref.node) ?? src) : src
    }
    // the pine's mid-distance twin: the GLB's colour lives in textures (base
    // colour white), so the twin is painted to match the rendered needles and
    // bark by eye against the pines-eye QA shot
    built.set('pine:far', buildFarPine(new THREE.Color(0x27521f), new THREE.Color(0x5a3c30), 7))

    // footprint aspect per kind (max over variants): wide props (merged
    // clusters, broad canopies) only place on ground that's flat across
    // their footprint — a merged pine GROVE placed on a slope hung its far
    // members in the air (the giant sky-trunk bug)
    const aspect = new Map<NodeKind, number>()
    const bb = new THREE.Box3()
    const sz = new THREE.Vector3()
    for (const kind of Object.keys(KIND_MODELS) as NodeKind[]) {
      let worst = 0
      for (const ref of KIND_MODELS[kind]) {
        const root = rootOf(ref)
        bb.setFromObject(root)
        bb.getSize(sz)
        worst = Math.max(worst, Math.max(sz.x, sz.z) / Math.max(0.01, sz.y))
      }
      aspect.set(kind, worst)
    }
    for (const kind of Object.keys(SPECS) as NodeKind[]) {
      this.place(kind, SPECS[kind], aspect.get(kind) ?? 0.5)
    }

    for (const [key, ids] of this.order) {
      const { kind, variant } = parseGroupKey(key)
      const root = rootOf(KIND_MODELS[kind][variant])
      // rocks weather to gray (the ARK reference: stone is gray, not clay)
      const recolor =
        kind === 'rock'
          ? (mat: THREE.MeshStandardMaterial) => {
              const lum = mat.color.r * 0.3 + mat.color.g * 0.6 + mat.color.b * 0.1
              mat.color.setScalar(THREE.MathUtils.clamp(lum * 0.85 + 0.12, 0.18, 0.5))
            }
          : kind === 'bush'
            ? (mat: THREE.MeshStandardMaterial) => {
                // the textured berry bush ships lime-neon and dodged the
                // green-darkening pass (its base colour is white): pull the
                // texture toward shaded leaf green
                if (mat.map) mat.color.setRGB(0.42, 0.55, 0.38)
              }
            : undefined
      const cover = GROUND_COVER.has(kind)
      const prop = new InstancedProp(root, Math.max(ids.length, 1), this.group, !cover, recolor)
      this.props.set(key, prop)
      ids.forEach((nodeId, i) => {
        const n = this.nodes[nodeId]
        prop.setInstance(i, n.x, n.y, n.z, n.scale, n.rotY, n.tint)
      })
      prop.computeBounds()
      // tree LODs: built trees get a far twin (coarse leaf masses), and every
      // tree kind a distant stand-in; visibility flips per supercell by
      // distance in updateVisibility()
      const fillTwin = (twin: InstancedProp): InstancedProp => {
        ids.forEach((nodeId, i) => {
          const n = this.nodes[nodeId]
          twin.setInstance(i, n.x, n.y, n.z, n.scale, n.rotY, n.tint)
        })
        twin.computeBounds()
        for (const m of twin.meshes) m.visible = false
        return twin
      }
      if (KIND_MODELS[kind][variant].gen && built.has(`${KIND_MODELS[kind][variant].gen}:${KIND_MODELS[kind][variant].seed}:far`)) {
        this.farProps.set(key, fillTwin(new InstancedProp(rootOf(KIND_MODELS[kind][variant], true), Math.max(ids.length, 1), this.group, true)))
      } else if (kind === 'pine') {
        this.farProps.set(key, fillTwin(new InstancedProp(built.get('pine:far')!, Math.max(ids.length, 1), this.group, true)))
      } else if (kind === 'willow') {
        // 2K-tri weeping crowns line 5 km of river; past 300 m a coarse
        // canopy stands in (the droop is under a pixel by then)
        this.farProps.set(key, fillTwin(new InstancedProp(built.get('canopy:11:far')!, Math.max(ids.length, 1), this.group, true)))
      }
      // cell bounds for distance culling
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (const nodeId of ids) {
        const n = this.nodes[nodeId]
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x)
        minZ = Math.min(minZ, n.z); maxZ = Math.max(maxZ, n.z)
      }
      this.propMeta.set(key, { minX, maxX, minZ, maxZ, cover, small: SMALL_SOLID.has(kind) })
    }

    // the dots: per kind, every node of every variant, grouped by cell
    for (const [kind, dotKind] of Object.entries(DOT_KINDS) as [NodeKind, 'canopy' | 'elder' | 'pine' | 'palm' | 'bare'][]) {
      const byCell = new Map<string, number[]>()
      for (const [key, ids] of this.order) {
        if (parseGroupKey(key).kind !== kind) continue
        const cell = key.slice(key.lastIndexOf('#') + 1)
        if (!byCell.has(cell)) byCell.set(cell, [])
        byCell.get(cell)!.push(...ids)
      }
      let total = 0
      for (const ids of byCell.values()) total += ids.length
      if (!total) continue
      const prop = new InstancedProp(buildDotTree(dotKind, 1), total, this.group, false)
      const ranges = new Map<string, { start: number; count: number; shown: boolean }>()
      const slotOf = new Map<number, number>()
      let slot = 0
      for (const [cell, ids] of byCell) {
        ranges.set(cell, { start: slot, count: ids.length, shown: false })
        for (const id of ids) {
          const n = this.nodes[id]
          slotOf.set(id, slot)
          prop.hideInstance(slot, n.x, n.y, n.z) // start hidden; bands reveal
          slot++
        }
      }
      prop.computeBounds()
      this.dots.set(kind, { prop, ranges, slotOf })
    }
  }

  /** Reveal or hide one cell's block of dots (matrix writes only on a flip). */
  private setDotRange(kind: NodeKind, cell: string, shown: boolean): void {
    const d = this.dots.get(kind)
    if (!d) return
    const r = d.ranges.get(cell)
    if (!r || r.shown === shown) return
    r.shown = shown
    for (const [id, slot] of d.slotOf) {
      if (slot < r.start || slot >= r.start + r.count) continue
      const n = this.nodes[id]
      if (shown && n.alive) d.prop.setInstance(slot, n.x, n.y, n.z, n.scale, n.rotY, n.tint)
      else d.prop.hideInstance(slot, n.x, n.y, n.z)
    }
  }

  /** Hide ground-cover cells far from the viewer (big fill/vertex win) and
   *  flip built-tree cells between full and far LOD. */
  updateVisibility(x: number, z: number): void {
    for (const [key, meta] of this.propMeta) {
      // distance to the cell's bounding box (0 inside it)
      const ddx = Math.max(meta.minX - x, 0, x - meta.maxX)
      const ddz = Math.max(meta.minZ - z, 0, z - meta.maxZ)
      const d = Math.hypot(ddx, ddz)
      if (meta.cover) {
        const visible = d < COVER_DRAW_DIST
        for (const m of this.props.get(key)!.meshes) m.visible = visible
        continue
      }
      if (meta.small) {
        const visible = d < SMALL_SOLID_DRAW_DIST
        for (const m of this.props.get(key)!.meshes) m.visible = visible
        continue
      }
      const far = this.farProps.get(key)
      const { kind } = parseGroupKey(key)
      const hasDot = this.dots.has(kind)
      if (!far && !hasDot) continue
      const band = d < TREE_LOD_FAR ? 0 : d < TREE_LOD_DOT ? 1 : 2
      // a kind without a far twin keeps its full model through band 1
      const fullVisible = band === 0 || (band === 1 && !far)
      for (const m of this.props.get(key)!.meshes) m.visible = fullVisible
      if (far) for (const m of far.meshes) m.visible = band === 1
      if (hasDot) this.setDotRange(kind, key.slice(key.lastIndexOf('#') + 1), band === 2)
    }
  }

  private place(kind: NodeKind, spec: PlaceSpec, footprintAspect = 0.5): void {
    const rand = mulberry32(spec.seed)
    let count = 0
    for (let gz = -HALF_SIZE + spec.cell; gz < HALF_SIZE - spec.cell && count < spec.cap; gz += spec.cell) {
      for (let gx = -HALF_SIZE + spec.cell; gx < HALF_SIZE - spec.cell && count < spec.cap; gx += spec.cell) {
        // roll all randomness up front so the stream is stable per cell
        const roll = rand()
        const woodRoll = rand()
        const jx = (rand() - 0.5) * spec.cell * 0.85
        const jz = (rand() - 0.5) * spec.cell * 0.85
        const variant = Math.floor(rand() * KIND_MODELS[kind].length)
        const scale = spec.sMin + rand() * (spec.sMax - spec.sMin)
        const rotY = rand() * Math.PI * 2
        // cover reads too bright (backlog #9) — darker, tighter tint band
        const tint = GROUND_COVER.has(kind) ? 0.55 + rand() * 0.3 : 0.72 + rand() * 0.42
        if (roll > spec.chance) continue
        const x = gx + jx
        const z = gz + jz
        const h = heightAt(x, z)
        if (h < SEA_LEVEL + 1.1) continue
        // never under lake water (backlog #10: trees inside lakes)
        let drowned = false
        for (const lake of worldMeta?.lakes ?? []) {
          if (shoreDist(x, z, lake.shore) < 3 && h < lake.level + 0.6) {
            drowned = true
            break
          }
        }
        if (drowned) continue
        const ny = normalAt(x, z, this.tmpN).y
        if (ny < (kind === 'rock' ? 0.55 : 0.72)) continue
        const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z)
        if (kind !== 'rock' && kind !== 'deadtree' && dv < 300) continue
        if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 14) continue
        const riverD = riverDistAt(x, z)
        if (riverD < 13 && kind !== 'willow') continue // keep channels clear
        const forestHere = forestMaskAt(x, z)
        const forestKind = forestKindAt(x, z)
        // woodland kinds thin toward the wood line: full packing deep inside,
        // a third of it where the feathered edge runs out
        if (spec.woodland && woodRoll > 0.3 + 0.7 * (forestHere + 1) * 0.5) continue
        const biome = biomeAt(x, z)
        // biome vegetation rules (the depth mandate): swamps are willow/dead-
        // tree/fern marsh; deserts are near-barren rock+deadwood; plains are
        // open bush-and-grass seas with the odd lone tree
        if (biome === BIOME.SWAMP) {
          if (kind === 'tree' || kind === 'elder' || kind === 'pine' || kind === 'palm' || kind === 'flower') continue
          if (kind === 'willow' && rand() > 0.9) { /* willows thrive: bypass river rule below */ }
        } else if (biome === BIOME.DESERT) {
          if (!(kind === 'rock' || kind === 'deadtree' || (kind === 'grass' && rand() < 0.15) || (kind === 'bush' && rand() < 0.08))) continue
        } else if (biome === BIOME.PLAINS) {
          if (kind === 'tree' || kind === 'pine' || kind === 'elder') { if (rand() > 0.06) continue }
          if (kind === 'fern' || kind === 'mushroom') continue
        }
        // swamp fauna bypass their usual habitat rules (willows off-river,
        // ferns outside forest, dead trees anywhere wet)
        const swampFlora = biome === BIOME.SWAMP && (kind === 'willow' || kind === 'deadtree' || kind === 'fern' || kind === 'grass' || kind === 'bush' || kind === 'mushroom')
        const coastD = kind === 'palm' && worldMeta?.coast ? Math.abs(shoreDist(x, z, worldMeta.coast)) : Infinity
        if (!swampFlora && !spec.habitat(h, ny, forestHere, riverD, forestKind, coastD)) continue
        // plains mega-bushes (the depth mandate); giants are their own kind now
        let scaleMul = 1
        if (kind === 'bush' && biome === BIOME.PLAINS) scaleMul = 1.3
        if (footprintAspect > 0.8 && !CANOPY_KINDS.has(kind)) {
          // wide prop: its footprint must sit on near-level ground
          const r = scale * footprintAspect * 0.35
          const hs = [heightAt(x + r, z), heightAt(x - r, z), heightAt(x, z + r), heightAt(x, z - r)]
          if (Math.max(...hs) - Math.min(...hs) > 2.2) continue
        }
        const id = this.nodes.length
        this.nodes.push({
          id, kind, variant, x,
          // embed = micro-ground allowance + this spot's worst-case LOD error
          // (coarse chunks render below truth on convex ground; sink past it
          // so no draw distance can float a prop). NOTE: the original fixed
          // sink was lost in the M6a rewrite — props had ZERO embed since.
          y: h - (kind === 'rock' ? 0.05 * scale + 0.04 : GROUND_COVER.has(kind) ? 0.06 : 0.14)
            - Math.min(2.5, Math.max(0, h - lodFloorAt(x, z))),
          z, scale: scale * scaleMul, rotY, tint,
          hp: NODE_DEFS[kind].hp,
          alive: true,
          respawnAt: 0,
        })
        const key = groupKeyOf(kind, variant, x, z)
        if (!this.order.has(key)) this.order.set(key, [])
        this.order.get(key)!.push(id)
        if (TRUNK_KINDS.has(kind)) addObstacle(x, z, kind === 'rock' ? scale * 0.42 : kind === 'elder' ? scale * 0.05 : 0.4)
        count++
      }
    }
  }

  raycast(raycaster: THREE.Raycaster, playerFeet: THREE.Vector3, reach: number): ScatterNode | null {
    // solid targets (trees, rocks…) win over ground cover — otherwise the
    // 30K grass tufts soak up every swing aimed at a trunk behind them
    const GROUND_COVER = new Set<NodeKind>(['grass', 'fern', 'flower', 'mushroom'])
    let bestSolid: { node: ScatterNode; dist: number } | null = null
    let bestCover: { node: ScatterNode; dist: number } | null = null
    for (const [key, prop] of this.props) {
      const hits = raycaster.intersectObjects(prop.meshes, false)
      for (const h of hits) {
        if (h.instanceId == null) continue
        const ids = this.order.get(key)!
        const node = this.nodes[ids[h.instanceId]]
        if (!node?.alive) continue
        const d = Math.hypot(node.x - playerFeet.x, node.z - playerFeet.z)
        if (d > reach) continue
        const slot = GROUND_COVER.has(node.kind) ? 'cover' : 'solid'
        if (slot === 'solid') {
          if (!bestSolid || h.distance < bestSolid.dist) bestSolid = { node, dist: h.distance }
        } else if (!bestCover || h.distance < bestCover.dist) {
          bestCover = { node, dist: h.distance }
        }
      }
    }
    return bestSolid?.node ?? bestCover?.node ?? null
  }

  hit(node: ScatterNode): Partial<Record<ItemId, number>> | null {
    if (!node.alive) return null
    node.hp -= 1
    if (node.hp > 0) return {}
    node.alive = false
    node.respawnAt = Date.now() + RESPAWN_MS
    this.setNodeVisible(node, false)
    this.pendingColliderDrops.push(node.id)
    const out: Partial<Record<ItemId, number>> = {}
    for (const [item, [lo, hi]] of Object.entries(NODE_DEFS[node.kind].yields)) {
      out[item as ItemId] = lo + Math.floor(Math.random() * (hi - lo + 1))
    }
    return out
  }

  flushColliderDrops(physics: Physics): void {
    for (const id of this.pendingColliderDrops) {
      const col = this.treeColliders.get(id)
      if (col) {
        physics.world.removeCollider(col, false)
        this.treeColliders.delete(id)
      }
    }
    this.pendingColliderDrops.length = 0
  }

  tickRespawns(physics: Physics): void {
    const now = Date.now()
    for (const n of this.nodes) {
      if (n.alive || n.respawnAt > now) continue
      n.alive = true
      n.hp = NODE_DEFS[n.kind].hp
      this.setNodeVisible(n, true)
      this.ensureCollidersAround(Number.NaN, Number.NaN, physics, true)
    }
  }

  private setNodeVisible(node: ScatterNode, visible: boolean): void {
    const key = groupKeyOf(node.kind, node.variant, node.x, node.z)
    const prop = this.props.get(key)!
    const idx = this.order.get(key)!.indexOf(node.id)
    const twins = [prop, this.farProps.get(key)]
    for (const p of twins) {
      if (!p) continue
      if (visible) p.setInstance(idx, node.x, node.y, node.z, node.scale, node.rotY, node.tint)
      else p.hideInstance(idx, node.x, node.y, node.z)
    }
    const d = this.dots.get(node.kind)
    if (d) {
      const slot = d.slotOf.get(node.id)
      const shown = d.ranges.get(key.slice(key.lastIndexOf('#') + 1))?.shown ?? false
      if (slot !== undefined) {
        if (visible && shown) d.prop.setInstance(slot, node.x, node.y, node.z, node.scale, node.rotY, node.tint)
        else d.prop.hideInstance(slot, node.x, node.y, node.z)
      }
    }
  }

  ensureCollidersAround(x: number, z: number, physics: Physics, force = false): void {
    if (!Number.isNaN(x)) {
      const cx = Math.floor((x + HALF_SIZE) / CHUNK_SIZE)
      const cz = Math.floor((z + HALF_SIZE) / CHUNK_SIZE)
      const key = cz * CHUNKS_PER_SIDE + cx
      if (key === this.lastChunkKey && !force) return
      this.lastChunkKey = key
      this.activeChunks.clear()
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          this.activeChunks.add((cz + dz) * CHUNKS_PER_SIDE + (cx + dx))
        }
      }
    }
    for (const [id, col] of this.treeColliders) {
      const n = this.nodes[id]
      if (!n.alive || !this.activeChunks.has(this.chunkKeyOf(n))) {
        physics.world.removeCollider(col, false)
        this.treeColliders.delete(id)
      }
    }
    for (const n of this.nodes) {
      if (!TRUNK_KINDS.has(n.kind) || !n.alive) continue
      if (!this.activeChunks.has(this.chunkKeyOf(n)) || this.treeColliders.has(n.id)) continue
      const rock = n.kind === 'rock'
      const half = rock ? n.scale * 0.32 : n.scale * 0.5
      const radius = rock ? n.scale * 0.42 : n.kind === 'elder' ? n.scale * 0.05 : Math.max(0.3, n.scale * 0.045)
      const col = physics.world.createCollider(
        RAPIER.ColliderDesc.cylinder(half, radius).setTranslation(n.x, n.y + half, n.z),
      )
      this.treeColliders.set(n.id, col)
    }
  }

  private chunkKeyOf(n: ScatterNode): number {
    const cx = Math.floor((n.x + HALF_SIZE) / CHUNK_SIZE)
    const cz = Math.floor((n.z + HALF_SIZE) / CHUNK_SIZE)
    return cz * CHUNKS_PER_SIDE + cx
  }

  /** Identify which prop group a raycast-hit mesh belongs to. */
  identify(mesh: THREE.Object3D, instanceId: number): { key: string; node: ScatterNode } | null {
    for (const [key, prop] of this.props) {
      if (prop.meshes.includes(mesh as THREE.InstancedMesh)) {
        const ids = this.order.get(key)!
        return { key, node: this.nodes[ids[instanceId]] }
      }
    }
    return null
  }

  /** QA: instances whose rendered base sits far off the exact ground. */
  floaters(threshold = 1.2): { key: string; x: number; z: number; baseY: number; ground: number }[] {
    const out: { key: string; x: number; z: number; baseY: number; ground: number }[] = []
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const sc = new THREE.Vector3()
    for (const [key, prop] of this.props) {
      const mesh = prop.meshes[0]
      if (!mesh) continue
      const ids = this.order.get(key)!
      for (let i = 0; i < ids.length; i++) {
        mesh.getMatrixAt(i, m)
        m.decompose(pos, q, sc)
        if (sc.x < 0.01) continue // hidden
        const ground = heightAt(pos.x, pos.z)
        if (Math.abs(pos.y - ground) > threshold && out.length < 20) {
          out.push({ key, x: +pos.x.toFixed(0), z: +pos.z.toFixed(0), baseY: +pos.y.toFixed(1), ground: +ground.toFixed(1) })
        }
      }
    }
    return out
  }

  trunkColliderCount(): number {
    return this.treeColliders.size
  }

  debugSummary(): { key: string; nodes: number; submeshes: number; drawn: number; tris: number; visible: boolean }[] {
    const out: { key: string; nodes: number; submeshes: number; drawn: number; tris: number; visible: boolean }[] = []
    const trisOf = (p: InstancedProp): number => {
      let t = 0
      for (const m of p.meshes) {
        if (!m.visible) continue
        const g = m.geometry
        t += ((g.index ? g.index.count : g.getAttribute('position').count) / 3) * m.count
      }
      return t
    }
    for (const [key, prop] of this.props) {
      const far = this.farProps.get(key)
      out.push({
        key,
        nodes: this.order.get(key)?.length ?? 0,
        submeshes: prop.meshes.length,
        drawn: prop.meshes[0]?.count ?? 0,
        // triangles this group submits (visible LOD only; frustum culling
        // then drops whole supercells)
        tris: trisOf(prop) + (far ? trisOf(far) : 0),
        visible: [prop, far].some((p) => p?.meshes.some((m) => m.visible)),
      })
    }
    for (const [kind, d] of this.dots) {
      // the island-wide dot mesh per kind (hidden slots are zero-scale)
      let shown = 0
      for (const r of d.ranges.values()) if (r.shown) shown += r.count
      const g = d.prop.meshes[0]?.geometry
      const tri = g ? (g.index ? g.index.count : g.getAttribute('position').count) / 3 : 0
      out.push({ key: `${kind}#dots`, nodes: d.slotOf.size, submeshes: d.prop.meshes.length, drawn: shown, tris: tri * shown, visible: shown > 0 })
    }
    return out
  }

  serialize(): { id: number; respawnAt: number }[] {
    return this.nodes.filter((n) => !n.alive).map((n) => ({ id: n.id, respawnAt: n.respawnAt }))
  }

  restore(dead: { id: number; respawnAt: number }[]): void {
    for (const d of dead) {
      const n = this.nodes[d.id]
      if (!n) continue
      n.alive = false
      n.hp = 0
      n.respawnAt = d.respawnAt
      this.setNodeVisible(n, false)
    }
  }
}

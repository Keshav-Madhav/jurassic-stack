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
import { heightAt, normalAt, forestMaskAt, SEA_LEVEL, HALF_SIZE, SPAWN, VOLCANO, worldMeta } from './heightmap'
import { CHUNK_SIZE, CHUNKS_PER_SIDE } from './terrain'
import { addObstacle } from './obstacles'
import type { Physics } from './physics'
import type { ItemId } from './items'

export type NodeKind =
  | 'tree' | 'pine' | 'deadtree' | 'palm' | 'willow'
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
const TRUNK_KINDS = new Set<NodeKind>(['tree', 'pine', 'palm', 'deadtree', 'willow', 'rock'])

interface ModelRef {
  file: string
  /** optional named sub-node to extract (variant packs) */
  node?: string
}

const KIND_MODELS: Record<NodeKind, ModelRef[]> = {
  tree: [{ file: 'Tree1' }, { file: 'Tree2' }, { file: 'Tree3' }],
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
  mushroom: [{ file: 'Mushroom', node: 'Mushroom' }],
}

/** cell size, base chance, scale range, cap, seed, habitat rule */
interface PlaceSpec {
  cell: number
  chance: number
  sMin: number
  sMax: number
  cap: number
  seed: number
  habitat: (h: number, ny: number, forest: number, riverD: number, r: number) => boolean
}

const SPECS: Record<NodeKind, PlaceSpec> = {
  // woods: dense inside the forest mask, gone in clearings. Tall — the ARK
  // reference forest is trunk-dominant with canopy far overhead.
  tree: { cell: 15, chance: 0.62, sMin: 7, sMax: 16, cap: 6500, seed: 101, habitat: (h, _ny, f) => f > 0.12 && h > 3.2 },
  pine: { cell: 16, chance: 0.6, sMin: 8, sMax: 19, cap: 5200, seed: 202, habitat: (h, _ny, f) => f > 0.05 && h > 6 },
  deadtree: { cell: 34, chance: 0.4, sMin: 4, sMax: 8, cap: 700, seed: 707, habitat: (h, _ny, f) => f > -0.34 && f < -0.13 && h > 4 },
  palm: { cell: 24, chance: 0.5, sMin: 5, sMax: 9, cap: 600, seed: 808, habitat: (h) => h > 1.1 && h < 4.2 },
  willow: { cell: 30, chance: 0.55, sMin: 5, sMax: 8.5, cap: 350, seed: 909, habitat: (h, _ny, _f, riverD) => riverD < 34 && riverD > 13 && h > 2 },
  rock: { cell: 40, chance: 0.4, sMin: 0.8, sMax: 2.4, cap: 1600, seed: 303, habitat: () => true },
  log: { cell: 44, chance: 0.4, sMin: 1.2, sMax: 2.2, cap: 800, seed: 606, habitat: (h, _ny, f) => f > 0.1 && h > 3 },
  bush: { cell: 16, chance: 0.62, sMin: 1.1, sMax: 2.9, cap: 5600, seed: 404, habitat: (h) => h > 2.2 },
  fern: { cell: 10, chance: 0.7, sMin: 0.8, sMax: 1.9, cap: 10000, seed: 505, habitat: (h, _ny, f) => f > 0.1 && h > 3 },
  flower: { cell: 18, chance: 0.5, sMin: 0.6, sMax: 1.2, cap: 2600, seed: 111, habitat: (h, _ny, f) => f < 0.05 && h > 2.4 },
  grass: { cell: 7, chance: 0.72, sMin: 0.45, sMax: 1.2, cap: 30000, seed: 555, habitat: (h) => h > 1.6 },
  mushroom: { cell: 30, chance: 0.45, sMin: 0.35, sMax: 0.8, cap: 650, seed: 222, habitat: (h, _ny, f) => f > 0.2 && h > 3 },
}

const RESPAWN_MS = 240_000
/** Supercell edge (m): instances group per cell so frustum culling works. */
const SUPER = 256
/** Ground-cover kinds: no shadow casting, distance-culled. */
const GROUND_COVER = new Set<NodeKind>(['grass', 'fern', 'flower', 'mushroom', 'log', 'bush'])
/** Cover cells beyond this range from the player are hidden entirely. */
const COVER_DRAW_DIST = 420

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
    best = Math.min(best, Math.abs(Math.hypot(x - lake.x, z - lake.z) - lake.r))
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

    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const geo = toFloatGeometry(o.geometry as THREE.BufferGeometry)
      geo.applyMatrix4(o.matrixWorld)
      geo.translate(-cx, 0, -cz)
      geo.scale(s, s, s)
      geo.translate(0, -box.min.y * s, 0) // feet at y=0
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
  private order = new Map<string, number[]>()
  private propMeta = new Map<string, { cx: number; cz: number; cover: boolean }>()
  private treeColliders = new Map<number, RAPIER.Collider>()
  private activeChunks = new Set<number>()
  private lastChunkKey = -1
  private tmpN = new THREE.Vector3()
  private pendingColliderDrops: number[] = []

  async load(): Promise<void> {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const files = [...new Set(Object.values(KIND_MODELS).flat().map((m) => m.file))]
    const loaded = new Map<string, THREE.Group>()
    await Promise.all(
      files.map(async (f) => {
        loaded.set(f, (await loader.loadAsync(`models/props/${f}.glb`)).scene)
      }),
    )

    for (const kind of Object.keys(SPECS) as NodeKind[]) {
      this.place(kind, SPECS[kind])
    }

    for (const [key, ids] of this.order) {
      const { kind, variant } = parseGroupKey(key)
      const ref = KIND_MODELS[kind][variant]
      const src = loaded.get(ref.file)!
      const root = ref.node ? (src.getObjectByName(ref.node) ?? src) : src
      // rocks weather to gray (the ARK reference: stone is gray, not clay)
      const recolor =
        kind === 'rock'
          ? (mat: THREE.MeshStandardMaterial) => {
              const lum = mat.color.r * 0.3 + mat.color.g * 0.6 + mat.color.b * 0.1
              mat.color.setScalar(THREE.MathUtils.clamp(lum * 0.85 + 0.12, 0.18, 0.5))
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
      // cell center for distance culling
      let cx = 0
      let cz = 0
      for (const nodeId of ids) {
        cx += this.nodes[nodeId].x
        cz += this.nodes[nodeId].z
      }
      this.propMeta.set(key, { cx: cx / ids.length, cz: cz / ids.length, cover })
    }
  }

  /** Hide ground-cover cells far from the player (big fill/vertex win). */
  updateVisibility(x: number, z: number): void {
    for (const [key, meta] of this.propMeta) {
      if (!meta.cover) continue
      const visible = Math.hypot(meta.cx - x, meta.cz - z) < COVER_DRAW_DIST
      const prop = this.props.get(key)!
      for (const m of prop.meshes) m.visible = visible
    }
  }

  private place(kind: NodeKind, spec: PlaceSpec): void {
    const rand = mulberry32(spec.seed)
    let count = 0
    for (let gz = -HALF_SIZE + spec.cell; gz < HALF_SIZE - spec.cell && count < spec.cap; gz += spec.cell) {
      for (let gx = -HALF_SIZE + spec.cell; gx < HALF_SIZE - spec.cell && count < spec.cap; gx += spec.cell) {
        // roll all randomness up front so the stream is stable per cell
        const roll = rand()
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
          if (Math.hypot(x - lake.x, z - lake.z) < lake.r * 1.2 && h < lake.level + 0.6) {
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
        if (!spec.habitat(h, ny, forestMaskAt(x, z), riverD, Math.hypot(x, z))) continue
        const id = this.nodes.length
        this.nodes.push({
          id, kind, variant, x, y: h, z, scale, rotY, tint,
          hp: NODE_DEFS[kind].hp,
          alive: true,
          respawnAt: 0,
        })
        const key = groupKeyOf(kind, variant, x, z)
        if (!this.order.has(key)) this.order.set(key, [])
        this.order.get(key)!.push(id)
        if (TRUNK_KINDS.has(kind)) addObstacle(x, z, kind === 'rock' ? scale * 0.42 : 0.4)
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
    if (visible) prop.setInstance(idx, node.x, node.y, node.z, node.scale, node.rotY, node.tint)
    else prop.hideInstance(idx, node.x, node.y, node.z)
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
      const radius = rock ? n.scale * 0.42 : Math.max(0.3, n.scale * 0.045)
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

  trunkColliderCount(): number {
    return this.treeColliders.size
  }

  debugSummary(): { key: string; nodes: number; submeshes: number; drawn: number }[] {
    const out: { key: string; nodes: number; submeshes: number; drawn: number }[] = []
    for (const [key, prop] of this.props) {
      out.push({
        key,
        nodes: this.order.get(key)?.length ?? 0,
        submeshes: prop.meshes.length,
        drawn: prop.meshes[0]?.count ?? 0,
      })
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

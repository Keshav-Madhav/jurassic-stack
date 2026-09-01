// World props + resource nodes. Deterministic seeded placement of trees,
// rocks, and berry bushes across the island (grid-jitter, constraints from
// the shared height function), rendered as InstancedMesh per GLB submesh.
// Every placement is also a harvestable NODE: swing at it → resources, hp
// hits 0 → instance hidden + respawn timer. Trees near the player get
// physics cylinders, streamed with the same 3×3 chunk logic as terrain.
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { heightAt, normalAt, SEA_LEVEL, HALF_SIZE, SPAWN, VOLCANO } from './heightmap'
import { CHUNK_SIZE, CHUNKS_PER_SIDE } from './terrain'
import type { Physics } from './physics'
import type { ItemId } from './items'

export type NodeKind = 'tree' | 'pine' | 'rock' | 'bush' | 'grass'

export interface ScatterNode {
  id: number
  kind: NodeKind
  /** which model variant of the kind this instance uses */
  variant: number
  x: number
  y: number
  z: number
  scale: number
  rotY: number
  /** per-instance tint jitter (multiplies material color) */
  tint: number
  hp: number
  alive: boolean
  /** epoch ms when a harvested node respawns */
  respawnAt: number
}

const NODE_DEFS: Record<NodeKind, { hp: number; yields: Partial<Record<ItemId, [number, number]>> }> = {
  tree: { hp: 3, yields: { wood: [2, 4], fiber: [1, 2] } },
  pine: { hp: 3, yields: { wood: [2, 4], fiber: [1, 2] } },
  rock: { hp: 3, yields: { stone: [2, 3], flint: [0, 2] } },
  bush: { hp: 2, yields: { berry: [2, 4], fiber: [1, 3] } },
  grass: { hp: 1, yields: { fiber: [1, 2] } },
}

/** Model files per kind — a node picks one variant deterministically. */
const KIND_MODELS: Record<NodeKind, string[]> = {
  tree: ['Tree1', 'Tree2', 'Tree3'],
  pine: ['Pine1'],
  rock: ['Rock1', 'Rock2'],
  bush: ['Bush1'],
  grass: ['Grass1'],
}

const RESPAWN_MS = 240_000
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Clone a geometry with position/normal promoted to float32. Quantized
 * (normalized-int) attributes from meshopt/KHR_mesh_quantization would be
 * silently corrupted by applyMatrix4 writing floats back into int arrays.
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

/** One GLB rendered as N InstancedMeshes (one per submesh), sharing matrices. */
class InstancedProp {
  meshes: THREE.InstancedMesh[] = []
  private dummy = new THREE.Object3D()

  constructor(gltf: THREE.Group, capacity: number, group: THREE.Group, normalizeH: number) {
    // normalize the source so instances share a consistent base height
    const box = new THREE.Box3().setFromObject(gltf)
    const size = box.getSize(new THREE.Vector3())
    const s = normalizeH / (size.y || 1)
    gltf.updateMatrixWorld(true)
    gltf.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const geo = toFloatGeometry(o.geometry as THREE.BufferGeometry)
      geo.applyMatrix4(o.matrixWorld)
      geo.scale(s, s, s)
      geo.translate(0, -box.min.y * s, 0) // feet at y=0
      const mat = (o.material as THREE.MeshStandardMaterial).clone()
      mat.roughness = 1
      mat.metalness = 0
      const im = new THREE.InstancedMesh(geo, mat, capacity)
      im.count = 0
      im.frustumCulled = false // instances span the island; per-chunk culling is M6's job
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

  hideInstance(i: number): void {
    for (const m of this.meshes) {
      m.setMatrixAt(i, ZERO_MATRIX)
      m.instanceMatrix.needsUpdate = true
    }
  }
}

export class Scatter {
  readonly group = new THREE.Group()
  readonly nodes: ScatterNode[] = []
  /** props + placement order keyed by `${kind}#${variant}` */
  private props = new Map<string, InstancedProp>()
  private order = new Map<string, number[]>()
  private treeColliders = new Map<number, RAPIER.Collider>() // node id → collider
  private activeChunks = new Set<number>()
  private lastChunkKey = -1
  private tmpN = new THREE.Vector3()

  async load(): Promise<void> {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const models = new Map<string, THREE.Group>()
    const names = [...new Set(Object.values(KIND_MODELS).flat())]
    await Promise.all(
      names.map(async (n) => {
        models.set(n, (await loader.loadAsync(`models/props/${n}.glb`)).scene)
      }),
    )

    this.place('tree', 26, 0.55, 5, 8, 3200, mulberry32(101))
    this.place('pine', 30, 0.5, 6, 10, 2400, mulberry32(202))
    this.place('rock', 42, 0.35, 0.9, 2.0, 1400, mulberry32(303))
    this.place('bush', 34, 0.6, 1.0, 1.7, 1600, mulberry32(404))
    this.place('grass', 13, 0.5, 0.5, 1.0, 5000, mulberry32(505))

    for (const kind of Object.keys(KIND_MODELS) as NodeKind[]) {
      for (let v = 0; v < KIND_MODELS[kind].length; v++) {
        const key = `${kind}#${v}`
        const ids = this.order.get(key) ?? []
        const prop = new InstancedProp(models.get(KIND_MODELS[kind][v])!, Math.max(ids.length, 1), this.group, 1)
        this.props.set(key, prop)
        ids.forEach((nodeId, i) => {
          const n = this.nodes[nodeId]
          prop.setInstance(i, n.x, n.y, n.z, n.scale, n.rotY, n.tint)
        })
      }
    }
  }

  /** Grid-jitter placement with terrain constraints. */
  private place(
    kind: NodeKind,
    cell: number,
    chance: number,
    sMin: number,
    sMax: number,
    cap: number,
    rand: () => number,
  ): void {
    const ids: number[] = []
    for (let gz = -HALF_SIZE + cell; gz < HALF_SIZE - cell && ids.length < cap; gz += cell) {
      for (let gx = -HALF_SIZE + cell; gx < HALF_SIZE - cell && ids.length < cap; gx += cell) {
        if (rand() > chance) continue
        const x = gx + (rand() - 0.5) * cell * 0.8
        const z = gz + (rand() - 0.5) * cell * 0.8
        const y = heightAt(x, z)
        if (y < SEA_LEVEL + 1.2) continue // not in the water
        if (normalAt(x, z, this.tmpN).y < (kind === 'rock' ? 0.55 : 0.74)) continue // slope limit
        const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z)
        if (kind !== 'rock' && dv < 300) continue // barren volcano flanks
        const ds = Math.hypot(x - SPAWN.x, z - SPAWN.z)
        if (ds < 14) continue // keep the spawn point itself clear
        const id = this.nodes.length
        const variant = Math.floor(rand() * KIND_MODELS[kind].length)
        this.nodes.push({
          id, kind, variant, x, y, z,
          scale: sMin + rand() * (sMax - sMin),
          rotY: rand() * Math.PI * 2,
          tint: 0.82 + rand() * 0.3,
          hp: NODE_DEFS[kind].hp,
          alive: true,
          respawnAt: 0,
        })
        const key = `${kind}#${variant}`
        if (!this.order.has(key)) this.order.set(key, [])
        this.order.get(key)!.push(id)
        ids.push(id)
      }
    }
  }

  /** Which node the aim ray hits, within `reach` meters OF THE PLAYER (not the
   *  camera — the camera sits on a 5 m boom, so ray distance lies about reach). */
  raycast(raycaster: THREE.Raycaster, playerFeet: THREE.Vector3, reach: number): ScatterNode | null {
    let best: { node: ScatterNode; dist: number } | null = null
    for (const [key, prop] of this.props) {
      const hits = raycaster.intersectObjects(prop.meshes, false)
      for (const h of hits) {
        if (h.instanceId == null) continue
        const ids = this.order.get(key)!
        const node = this.nodes[ids[h.instanceId]]
        if (!node?.alive) continue
        const d = Math.hypot(node.x - playerFeet.x, node.z - playerFeet.z)
        if (d > reach) continue
        if (!best || h.distance < best.dist) best = { node, dist: h.distance }
      }
    }
    return best?.node ?? null
  }

  /** Apply one hit; returns yielded items when the node breaks, else null. */
  hit(node: ScatterNode): Partial<Record<ItemId, number>> | null {
    if (!node.alive) return null
    node.hp -= 1
    if (node.hp > 0) return {}
    node.alive = false
    node.respawnAt = Date.now() + RESPAWN_MS
    this.setNodeVisible(node, false)
    this.dropColliderFor(node.id)
    const out: Partial<Record<ItemId, number>> = {}
    for (const [item, [lo, hi]] of Object.entries(NODE_DEFS[node.kind].yields)) {
      out[item as ItemId] = lo + Math.floor(Math.random() * (hi - lo + 1))
    }
    return out
  }

  /** Respawn expired nodes (called once a second is plenty). */
  tickRespawns(physics: Physics): void {
    const now = Date.now()
    for (const n of this.nodes) {
      if (n.alive || n.respawnAt > now) continue
      n.alive = true
      n.hp = NODE_DEFS[n.kind].hp
      this.setNodeVisible(n, true)
      // re-add collider if it's inside the active ring
      this.ensureCollidersAround(Number.NaN, Number.NaN, physics, true)
    }
  }

  private setNodeVisible(node: ScatterNode, visible: boolean): void {
    const key = `${node.kind}#${node.variant}`
    const prop = this.props.get(key)!
    const idx = this.order.get(key)!.indexOf(node.id)
    if (visible) prop.setInstance(idx, node.x, node.y, node.z, node.scale, node.rotY, node.tint)
    else prop.hideInstance(idx)
  }

  /** Stream tree/pine trunk colliders for the 3×3 chunks around the player. */
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
    // drop colliders that left the ring or whose node died
    for (const [id, col] of this.treeColliders) {
      const n = this.nodes[id]
      if (!n.alive || !this.activeChunks.has(this.chunkKeyOf(n))) {
        physics.world.removeCollider(col, false)
        this.treeColliders.delete(id)
      }
    }
    // add colliders for living trees inside the ring
    for (const n of this.nodes) {
      if ((n.kind !== 'tree' && n.kind !== 'pine') || !n.alive) continue
      if (!this.activeChunks.has(this.chunkKeyOf(n)) || this.treeColliders.has(n.id)) continue
      const half = n.scale * 0.5
      const col = physics.world.createCollider(
        RAPIER.ColliderDesc.cylinder(half, 0.35).setTranslation(n.x, n.y + half, n.z),
      )
      this.treeColliders.set(n.id, col)
    }
  }

  private pendingColliderDrops: number[] = []

  /** Mark a node's collider for removal on the next collider-stream pass. */
  private dropColliderFor(id: number): void {
    this.pendingColliderDrops.push(id)
  }

  /** Remove any colliders queued by harvests (needs the physics handle). */
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

  private chunkKeyOf(n: ScatterNode): number {
    const cx = Math.floor((n.x + HALF_SIZE) / CHUNK_SIZE)
    const cz = Math.floor((n.z + HALF_SIZE) / CHUNK_SIZE)
    return cz * CHUNKS_PER_SIDE + cx
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

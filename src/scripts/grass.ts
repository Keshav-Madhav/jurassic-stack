// The grass field: the floor LITTERED with grass — a streamed carpet of
// painted grass cards around the viewer, generated per 48 m tile from a
// hash of the tile (no storage, no nodes, not harvestable — fibre comes from
// bushes, ferns and reeds), one tile built per frame as you move. Six
// triangles a tuft, ~25K tufts in view, one instanced draw per tile.
import * as THREE from 'three'
import { heightAt, normalAt, biomeAt, forestMaskAt, BIOME, worldMeta } from './heightmap'
import { buildGrassCard } from './trees'

const TILE = 48
const RADIUS = 3 // tiles each way → 7×7 = 49 tiles, ~170 m of grass around you
const SPACING = 1.55
const PER_TILE = Math.ceil(TILE / SPACING) ** 2

function hash2(x: number, z: number): () => number {
  let a = (Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263)) >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class GrassField {
  readonly group = new THREE.Group()
  private geometry: THREE.BufferGeometry
  private material: THREE.Material
  private tiles = new Map<string, THREE.InstancedMesh>()
  private pool: THREE.InstancedMesh[] = []
  private wanted: { tx: number; tz: number }[] = []
  private dummy = new THREE.Object3D()
  private n = new THREE.Vector3()
  private color = new THREE.Color()
  private lastTx = NaN
  private lastTz = NaN

  constructor() {
    const card = buildGrassCard(7)
    const mesh = card.children[0] as THREE.Mesh
    this.geometry = mesh.geometry
    this.material = mesh.material as THREE.Material
  }

  /** Call every frame with the viewer position: keeps the 7×7 tiles around it built. */
  update(x: number, z: number): void {
    const tx = Math.floor(x / TILE)
    const tz = Math.floor(z / TILE)
    if (tx !== this.lastTx || tz !== this.lastTz) {
      this.lastTx = tx
      this.lastTz = tz
      // drop tiles out of range (recycle their meshes), queue the missing ones nearest-first
      for (const [key, mesh] of this.tiles) {
        const [kx, kz] = key.split(',').map(Number)
        if (Math.abs(kx - tx) > RADIUS || Math.abs(kz - tz) > RADIUS) {
          this.tiles.delete(key)
          mesh.visible = false
          this.pool.push(mesh)
        }
      }
      this.wanted.length = 0
      for (let dz = -RADIUS; dz <= RADIUS; dz++) {
        for (let dx = -RADIUS; dx <= RADIUS; dx++) {
          if (!this.tiles.has(`${tx + dx},${tz + dz}`)) this.wanted.push({ tx: tx + dx, tz: tz + dz })
        }
      }
      this.wanted.sort((a, b) => Math.hypot(a.tx - tx, a.tz - tz) - Math.hypot(b.tx - tx, b.tz - tz))
    }
    // one tile a frame: ~900 height lookups, no hitch
    const next = this.wanted.shift()
    if (next) this.build(next.tx, next.tz)
  }

  private build(tx: number, tz: number): void {
    const key = `${tx},${tz}`
    if (this.tiles.has(key)) return
    let mesh = this.pool.pop()
    if (!mesh) {
      mesh = new THREE.InstancedMesh(this.geometry, this.material, PER_TILE)
      mesh.castShadow = false
      mesh.receiveShadow = true
      mesh.matrixAutoUpdate = false
      mesh.frustumCulled = true
      this.group.add(mesh)
    }
    const rand = hash2(tx, tz)
    const meta = worldMeta
    // a tile near a river or lake checks each tuft against the water; others skip it
    const cx = tx * TILE + TILE / 2, cz = tz * TILE + TILE / 2
    let nearWater = false
    if (meta) {
      for (const lake of meta.lakes) {
        const xs = lake.shore.map((p) => p[0]), zs = lake.shore.map((p) => p[1])
        if (cx > Math.min(...xs) - 60 && cx < Math.max(...xs) + 60 && cz > Math.min(...zs) - 60 && cz < Math.max(...zs) + 60) nearWater = true
      }
      if (!nearWater) {
        for (const path of meta.rivers) {
          for (let i = 0; i < path.length - 1 && !nearWater; i++) {
            const ax = path[i].x, az = path[i].z, dx = path[i + 1].x - ax, dz = path[i + 1].z - az
            const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / (dx * dx + dz * dz)))
            if (Math.hypot(cx - (ax + dx * t), cz - (az + dz * t)) < TILE) nearWater = true
          }
        }
      }
    }
    let count = 0
    const side = Math.ceil(TILE / SPACING)
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        const r0 = rand(), r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand()
        const x = tx * TILE + (i + r0) * SPACING
        const z = tz * TILE + (j + r1) * SPACING
        const h = heightAt(x, z)
        if (h < 1.9 || h > 190) continue
        const biome = biomeAt(x, z)
        if (biome === BIOME.DESERT && r2 > 0.12) continue // a few dry tufts in the dunes
        if (biome === BIOME.SWAMP && r2 > 0.55) continue
        if (biome === BIOME.ALPINE && r2 > 0.3) continue
        // thinner under a closed canopy (the floor is dirt and litter there)
        const f = forestMaskAt(x, z)
        if (f > 0.2 && r3 > 0.45) continue
        if (normalAt(x, z, this.n).y < 0.7) continue
        if (nearWater && this.underWater(x, z, h)) continue
        const scale = 0.55 + r4 * 0.6
        this.dummy.position.set(x, h - 0.04, z)
        this.dummy.rotation.set(0, r2 * Math.PI, 0)
        this.dummy.scale.set(scale, scale * (0.8 + r1 * 0.5), scale)
        this.dummy.updateMatrix()
        mesh.setMatrixAt(count, this.dummy.matrix)
        // plains lighter and yellower, woods darker
        const k = biome === BIOME.PLAINS ? 0.85 + r4 * 0.25 : 0.55 + r4 * 0.35
        this.color.setRGB(k * (biome === BIOME.PLAINS ? 1.05 : 0.95), k, k * 0.85)
        mesh.setColorAt(count, this.color)
        count++
      }
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.visible = count > 0
    this.tiles.set(key, mesh)
  }

  private underWater(x: number, z: number, h: number): boolean {
    const meta = worldMeta
    if (!meta) return false
    for (const lake of meta.lakes) if (h < lake.level + 0.3) {
      // cheap: inside the lake's bbox and below its level counts as wet
      const xs = lake.shore.map((p) => p[0]), zs = lake.shore.map((p) => p[1])
      if (x > Math.min(...xs) - 6 && x < Math.max(...xs) + 6 && z > Math.min(...zs) - 6 && z < Math.max(...zs) + 6) return true
    }
    for (const path of meta.rivers) {
      for (let i = 0; i < path.length - 1; i++) {
        const ax = path[i].x, az = path[i].z, dx = path[i + 1].x - ax, dz = path[i + 1].z - az
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
        if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < 16) return true
      }
    }
    return false
  }

  tileCount(): number {
    return this.tiles.size
  }
}

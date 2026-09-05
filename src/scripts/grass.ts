// The grass field: the floor LITTERED with grass — a streamed carpet of
// painted grass cards around the viewer, generated per 48 m tile from a hash
// of the tile (no storage, no nodes, not harvestable — fibre comes from
// bushes, ferns and reeds). Tiles are built in the terrain worker
// (grass-gen.ts) and arrive as matrices; the main thread only uploads.
// Dense underfoot, thinning by ring: six triangles a tuft, ~40K in view.
import * as THREE from 'three'
import { buildGrassCard } from './trees'
import { buildGrassTile, GRASS_TILE as TILE } from './grass-gen'
import { sharedBuilder } from './terrain'

const RADIUS = 4 // tiles each way → 9×9 = 81 tiles (64 m), ~290 m of grass around you
/** tuft spacing by tile ring: dense underfoot, thinning with distance — on
 *  foot the grass is busy, and the far field costs a fraction (user) */
const SPACING_BY_RING = [1.0, 1.0, 1.7, 2.6, 2.6]
const PER_TILE = Math.ceil(TILE / SPACING_BY_RING[0]) ** 2

export class GrassField {
  readonly group = new THREE.Group()
  private geometry: THREE.BufferGeometry
  private material: THREE.Material
  private tiles = new Map<string, THREE.InstancedMesh>()
  /** the spacing each built tile was built at (a ring change rebuilds it) */
  private builtSpacing = new Map<string, number>()
  private pending = new Set<string>()
  private pool: THREE.InstancedMesh[] = []
  private wanted: { tx: number; tz: number; ring: number }[] = []
  private lastTx = NaN
  private lastTz = NaN

  constructor() {
    const card = buildGrassCard(7)
    const mesh = card.children[0] as THREE.Mesh
    this.geometry = mesh.geometry
    this.material = mesh.material as THREE.Material
  }

  /** Call every frame with the viewer position: keeps the tiles around it built. */
  update(x: number, z: number): void {
    const tx = Math.floor(x / TILE)
    const tz = Math.floor(z / TILE)
    if (tx !== this.lastTx || tz !== this.lastTz) {
      this.lastTx = tx
      this.lastTz = tz
      for (const [key, mesh] of this.tiles) {
        const [kx, kz] = key.split(',').map(Number)
        if (Math.abs(kx - tx) > RADIUS || Math.abs(kz - tz) > RADIUS) {
          this.tiles.delete(key)
          this.builtSpacing.delete(key)
          mesh.visible = false
          this.pool.push(mesh)
        }
      }
      this.wanted.length = 0
      for (let dz = -RADIUS; dz <= RADIUS; dz++) {
        for (let dx = -RADIUS; dx <= RADIUS; dx++) {
          const key = `${tx + dx},${tz + dz}`
          const ring = Math.max(Math.abs(dx), Math.abs(dz))
          // missing, or built for another ring's density → (re)build
          if (!this.tiles.has(key) || this.builtSpacing.get(key) !== SPACING_BY_RING[ring]) this.wanted.push({ tx: tx + dx, tz: tz + dz, ring })
        }
      }
      this.wanted.sort((a, b) => a.ring - b.ring)
    }
    // hand a few tiles a frame to the worker; keep the queue short so what
    // comes back is still wanted
    const builder = sharedBuilder
    let budget = builder?.available ? 3 : 1
    while (budget-- > 0 && this.wanted.length) {
      const next = this.wanted.shift()!
      const key = `${next.tx},${next.tz}`
      if (this.pending.has(key)) continue
      const spacing = SPACING_BY_RING[Math.min(next.ring, SPACING_BY_RING.length - 1)]
      if (builder?.available) {
        if (builder.grassInFlight >= 8) { this.wanted.unshift(next); break }
        this.pending.add(key)
        builder.requestGrass(next.tx, next.tz, spacing, (g) => {
          this.pending.delete(key)
          this.apply(key, spacing, g)
        })
      } else {
        this.apply(key, spacing, buildGrassTile(next.tx, next.tz, spacing))
      }
    }
  }

  private apply(key: string, spacing: number, g: { matrices: Float32Array; colors: Float32Array; count: number }): void {
    // still in range? (the viewer may have moved on while the worker built it)
    const [kx, kz] = key.split(',').map(Number)
    if (Math.abs(kx - this.lastTx) > RADIUS || Math.abs(kz - this.lastTz) > RADIUS) return
    let mesh = this.tiles.get(key) ?? this.pool.pop()
    if (!mesh) {
      mesh = new THREE.InstancedMesh(this.geometry, this.material, PER_TILE)
      mesh.castShadow = false
      mesh.receiveShadow = true
      mesh.matrixAutoUpdate = false
      mesh.frustumCulled = true
      this.group.add(mesh)
    }
    const count = Math.min(g.count, PER_TILE)
    ;(mesh.instanceMatrix.array as Float32Array).set(g.matrices.subarray(0, count * 16))
    if (!mesh.instanceColor) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PER_TILE * 3), 3)
    ;(mesh.instanceColor.array as Float32Array).set(g.colors.subarray(0, count * 3))
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.visible = count > 0
    this.tiles.set(key, mesh)
    this.builtSpacing.set(key, spacing)
  }

  tileCount(): number {
    return this.tiles.size
  }
}

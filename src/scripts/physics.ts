// Rapier world + streaming terrain colliders.
//
// Collision terrain is per-chunk static trimeshes built from the SAME LOD0
// grid the renderer uses (terrain.ts::chunkGridData) — what you see is what
// you collide with, and there are no heightfield-orientation footguns. Only
// the 3×3 chunks around the player carry colliders; crossing a chunk border
// streams them in/out. This is deliberately the same shape streaming will
// take at M5/M6.
import RAPIER from '@dimforge/rapier3d-compat'
import { chunkGridData, CHUNKS_PER_SIDE, CHUNK_SIZE } from './terrain'
import { HALF_SIZE } from './heightmap'

export const FIXED_DT = 1 / 60

export class Physics {
  world!: RAPIER.World
  private terrainColliders = new Map<number, RAPIER.Collider>()
  private lastChunkX = Number.NaN
  private lastChunkZ = Number.NaN

  async init(): Promise<void> {
    await RAPIER.init()
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    this.world.timestep = FIXED_DT
  }

  step(): void {
    this.world.step()
  }

  /** Ensure terrain colliders exist for the 3×3 chunks around (x, z). */
  ensureTerrainAround(x: number, z: number): void {
    const cx = Math.floor((x + HALF_SIZE) / CHUNK_SIZE)
    const cz = Math.floor((z + HALF_SIZE) / CHUNK_SIZE)
    if (cx === this.lastChunkX && cz === this.lastChunkZ) return
    this.lastChunkX = cx
    this.lastChunkZ = cz

    const wanted = new Set<number>()
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx
        const nz = cz + dz
        if (nx < 0 || nz < 0 || nx >= CHUNKS_PER_SIDE || nz >= CHUNKS_PER_SIDE) continue
        wanted.add(nz * CHUNKS_PER_SIDE + nx)
      }
    }
    for (const [key, collider] of this.terrainColliders) {
      if (!wanted.has(key)) {
        this.world.removeCollider(collider, false)
        this.terrainColliders.delete(key)
      }
    }
    for (const key of wanted) {
      if (this.terrainColliders.has(key)) continue
      const { vertices, indices } = chunkGridData(key % CHUNKS_PER_SIDE, Math.floor(key / CHUNKS_PER_SIDE))
      const collider = this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices))
      this.terrainColliders.set(key, collider)
    }
  }
}

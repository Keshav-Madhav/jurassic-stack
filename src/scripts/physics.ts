// Rapier world + streaming terrain colliders.
//
// Collision terrain is per-chunk static trimeshes built from the SAME LOD0
// grid the renderer uses (terrain.ts::chunkGridData) — what you see is what
// you collide with, and there are no heightfield-orientation footguns. Only
// the 3×3 chunks around the player carry colliders; crossing a chunk border
// streams them in/out. This is deliberately the same shape streaming will
// take at M5/M6.
import RAPIER from '@dimforge/rapier3d-compat'
import { CHUNKS_PER_SIDE, CHUNK_SIZE } from './terrain'
import { HALF_SIZE, heightAt } from './heightmap'

/** LOD0 vertex grid of one chunk as a Rapier heightfield: 64×64 cells, 2 m
 *  apart, heights column-major (rows along z, columns along x). Creating a
 *  heightfield is O(n); the trimesh it replaces built a BVH over 8K
 *  triangles every time you crossed a chunk border — three at once, one
 *  hitch. Same 2 m grid, same heights, so what you see is what you stand on. */
const HF_CELLS = 64
function chunkHeightfield(cx: number, cz: number): RAPIER.ColliderDesc {
  const originX = -HALF_SIZE + cx * CHUNK_SIZE
  const originZ = -HALF_SIZE + cz * CHUNK_SIZE
  const n = HF_CELLS + 1
  const heights = new Float32Array(n * n)
  const step = CHUNK_SIZE / HF_CELLS
  for (let j = 0; j < n; j++) { // column: x
    for (let i = 0; i < n; i++) { // row: z
      heights[j * n + i] = heightAt(originX + j * step, originZ + i * step)
    }
  }
  return RAPIER.ColliderDesc.heightfield(HF_CELLS, HF_CELLS, heights, { x: CHUNK_SIZE, y: 1, z: CHUNK_SIZE })
    .setTranslation(originX + CHUNK_SIZE / 2, 0, originZ + CHUNK_SIZE / 2)
}

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
      const collider = this.world.createCollider(chunkHeightfield(key % CHUNKS_PER_SIDE, Math.floor(key / CHUNKS_PER_SIDE)))
      this.terrainColliders.set(key, collider)
    }
  }
}

// The wild population: ~1500 dinos on the island at all times, placed by
// habitat (packs in the woods, herds on the open ground, apexes in the
// north), deterministic per seed. The Dino class keeps them cheap — beyond
// ~650 m a wild dino goes dormant (no AI, no animation, no draw) and wakes
// as the player comes back into range — so 1500 live on the map while a few
// dozen are ever simulated.
import { heightAt, normalAt, forestMaskAt, biomeAt, shoreDist, BIOME, SPAWN, VOLCANO, worldMeta } from './heightmap'
import * as THREE from 'three'

export interface WildSpawn { species: string; x: number; z: number }

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const _n = new THREE.Vector3()

/** Dry, gentle, out of the water, off the cone, clear of the spawn beach. */
function standable(x: number, z: number, minSpawnDist: number): boolean {
  if (Math.abs(x) > 1900 || Math.abs(z) > 1900) return false
  const h = heightAt(x, z)
  if (h < 3.5) return false
  if (normalAt(x, z, _n).y < 0.72) return false
  if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < 620) return false
  if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < minSpawnDist) return false
  const meta = worldMeta
  if (meta) {
    for (const lake of meta.lakes) if (shoreDist(x, z, lake.shore) < 8) return false
    for (const path of meta.rivers) {
      for (let i = 0; i < path.length - 1; i++) {
        const ax = path[i].x, az = path[i].z
        const dx = path[i + 1].x - ax, dz = path[i + 1].z - az
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
        if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < 24) return false
      }
    }
  }
  return true
}

interface Habitat {
  species: string
  groups: number
  size: [number, number]
  /** is this spot the kind of country this species lives in? */
  likes: (x: number, z: number, forest: number, biome: number) => boolean
  minSpawnDist: number
}

const HABITATS: Habitat[] = [
  // carnivores
  { species: 'raptor', groups: 84, size: [3, 4], minSpawnDist: 220, likes: (_x, _z, f, b) => f > -0.5 && b !== BIOME.DESERT },
  { species: 'carno', groups: 40, size: [1, 2], minSpawnDist: 500, likes: (_x, _z, f, b) => f < 0.4 && b !== BIOME.SWAMP },
  { species: 'allo', groups: 34, size: [1, 1], minSpawnDist: 800, likes: (_x, z, f) => z < -100 && f < 0.5 },
  { species: 'trex', groups: 40, size: [1, 1], minSpawnDist: 900, likes: (_x, z, f) => z < -200 && f < 0.3 },
  { species: 'terrorbird', groups: 36, size: [3, 4], minSpawnDist: 380, likes: (_x, _z, f, b) => f < -0.2 && b !== BIOME.SWAMP },
  // herbivores
  { species: 'trike', groups: 48, size: [3, 5], minSpawnDist: 160, likes: (_x, _z, f, b) => f < 0.2 && b !== BIOME.SWAMP },
  { species: 'stego', groups: 60, size: [2, 2], minSpawnDist: 160, likes: (_x, _z, f) => f < 0.5 },
  { species: 'pachy', groups: 50, size: [2, 4], minSpawnDist: 200, likes: (_x, _z, f, b) => f < 0.6 && b !== BIOME.DESERT },
  { species: 'parasaur', groups: 40, size: [4, 6], minSpawnDist: 150, likes: (_x, _z, f, b) => f < 0 && b !== BIOME.DESERT && b !== BIOME.SWAMP },
  { species: 'apato', groups: 28, size: [1, 2], minSpawnDist: 400, likes: (_x, _z, f, b) => f < -0.2 && b !== BIOME.DESERT },
  { species: 'mammoth', groups: 28, size: [2, 3], minSpawnDist: 700, likes: (x, z, f, b) => (z < -400 || heightAt(x, z) > 60) && f < 0.6 && b !== BIOME.DESERT },
]

/**
 * Lay out the wild roster. `extra` are hand-placed spawns added first (the
 * spawn-beach raptor pack the taming loop relies on, the herd on the plain).
 */
export function wildPopulation(seed = 20260904, target = 1500): WildSpawn[] {
  const rand = mulberry32(seed)
  const out: WildSpawn[] = []
  // the spawn-beach raptors: three, but spread out — a tight pack all
  // aggroed at once and killed the new player (and the taming gate)
  for (const [dx, dz] of [[60, -90], [-170, -140], [230, -170]]) out.push({ species: 'raptor', x: SPAWN.x + dx, z: SPAWN.z + dz })
  // a herd on the south plain, and a few stegos at the Southwood's edge
  for (const [dx, dz] of [[-220, -560], [-232, -548], [-208, -572], [-244, -566], [-216, -540]]) out.push({ species: 'trike', x: SPAWN.x + dx, z: SPAWN.z + dz })
  for (const [dx, dz] of [[260, -160], [268, -172], [-380, -240], [-392, -228], [120, -420], [132, -412]]) out.push({ species: 'stego', x: SPAWN.x + dx, z: SPAWN.z + dz })
  // a parasaur herd grazing the south plain — the first easy ride
  for (const [dx, dz] of [[-300, -620], [-312, -608], [-288, -632], [-322, -628], [-296, -600]]) out.push({ species: 'parasaur', x: SPAWN.x + dx, z: SPAWN.z + dz })
  for (const [x, z] of [[300, -900], [-500, -800], [900, -400], [-900, -600]]) out.push({ species: 'trex', x, z })

  for (const hab of HABITATS) {
    let placed = 0
    let tries = 0
    while (placed < hab.groups && tries < 4000) {
      tries++
      const x = (rand() - 0.5) * 3600
      const z = (rand() - 0.5) * 3600
      if (!standable(x, z, hab.minSpawnDist)) continue
      if (!hab.likes(x, z, forestMaskAt(x, z), biomeAt(x, z))) continue
      const n = hab.size[0] + Math.floor(rand() * (hab.size[1] - hab.size[0] + 1))
      for (let i = 0; i < n; i++) {
        const ox = (rand() - 0.5) * 22
        const oz = (rand() - 0.5) * 22
        out.push({ species: hab.species, x: x + ox, z: z + oz })
      }
      placed++
    }
  }
  // top up (or trim) to the target with raptors in the woods
  while (out.length > target) out.pop()
  let guard = 0
  while (out.length < target && guard++ < 4000) {
    const x = (rand() - 0.5) * 3600
    const z = (rand() - 0.5) * 3600
    if (standable(x, z, 220) && forestMaskAt(x, z) > -0.5) out.push({ species: 'raptor', x, z })
  }
  return out
}

// Terrain paint: the ground palette, splat weights and chunk geometry
// ARRAYS. Pure functions over the baked grids — imported by terrain.ts (the
// meshes) and by terrain-worker.ts (which builds LOD upgrades off the main
// thread so a gallop across chunk borders never hitches the frame).
import * as THREE from 'three'
import { heightAt, normalAt, forestMaskAt, forestKindAt, FOREST_KIND, biomeAt, biomeBlendAt, shoreDist, BIOME, VOLCANO, worldMeta, HALF_SIZE, SEA_LEVEL, ambientAt } from './heightmap'

export const CHUNK_SIZE = 128
export const CHUNKS_PER_SIDE = (HALF_SIZE * 2) / CHUNK_SIZE // 32
export const LOD_QUADS = [64, 32, 16, 8]
/** Skirt depth grows with LOD coarseness — 4m skirts couldn't cover mesa
 *  walls where a coarse chunk borders a fine one (backlog #8: LOD holes). */
// (deepened M18: on the ranges' 60° flanks a coarse neighbour's edge sat more
// than 29 m off the fine one and the sky showed through as white slivers)
export const skirtDepthForStep = (step: number) => 8 + step * 4 // 2 m step → 16 m … 16 m step → 72 m

const C_DEEP = new THREE.Color(0x24312a) // underwater
const C_SAND = new THREE.Color(0xa08753)
// PALETTE NOTE (M28): these hexes are sRGB; `new Color(0x1f3d18)` is 0.014/
// 0.047/0.009 LINEAR — a lawn at 4% albedo. Real grass is 10–15%, soil 8–12%.
// The sun (2.9) was tuned to lift this, which is why every true-albedo prop
// (rocks, ruins, the kit) blew out beside it. Lifted toward real albedos;
// the shader's ×2.2 texture recentre stays.
const C_GRASS_LUSH = new THREE.Color(0x2f5a22) // rich green (lum ~0.08)
const C_GRASS_LIGHT = new THREE.Color(0x4c7a2c)
const C_GRASS_DRY = new THREE.Color(0x767a38) // olive dry patches
const C_ROCK = new THREE.Color(0x6b6762) // weathered gray (lifted: the ranges read as coal heaps at noon — M18)
const C_ROCK_STEEP = new THREE.Color(0x504c47)
const C_ALPINE = new THREE.Color(0x6a6350) // high scree and thin turf between the rock and the snow
// (lifted M22: the forest floor and the banks read as coal-black in every
// eye-level shot — a floor of litter is brown, and 2× brighter than this was)
const C_FLOOR = new THREE.Color(0x6a5438) // forest floor: dirt + leaf litter
const C_FLOOR_LIT = new THREE.Color(0x8a7048)
// needle litter (M73): redder and duller than leaf litter, and it wins over
// the grass underneath much harder — nothing much grows in a pine wood
const C_NEEDLE = new THREE.Color(0x5c4028)
const C_NEEDLE_LIT = new THREE.Color(0x7d5c36)
const C_MUD = new THREE.Color(0x76624a) // wet banks
const C_SHORE_SAND = new THREE.Color(0x8f7a52)
const C_SWAMP = new THREE.Color(0x46502e) // murky marsh ground
const C_SWAMP_WET = new THREE.Color(0x3a4530)
const C_DESERT = new THREE.Color(0x9a8054) // dry flats
const C_DESERT_DARK = new THREE.Color(0x7a6543)
const C_PLAINS = new THREE.Color(0x6a8a36) // open grassland, lighter

/** Distance to the nearest river centerline or lake ring (for wet banks). */
// Distance to the nearest water edge, from an 8 m field computed once
// (the exact version walked every river segment and lake polygon for every
// vertex of every chunk — the single biggest cost of a chunk build, and
// chunk builds are the hitch you feel crossing a chunk border at speed).
let waterField: Float32Array | null = null
const WF_STEP = 8
const WF_N = Math.floor((HALF_SIZE * 2) / WF_STEP) + 1
function waterEdgeDist(x: number, z: number): number {
  if (!waterField) {
    waterField = new Float32Array(WF_N * WF_N)
    for (let j = 0; j < WF_N; j++) for (let i = 0; i < WF_N; i++) waterField[j * WF_N + i] = waterEdgeDistExact(-HALF_SIZE + i * WF_STEP, -HALF_SIZE + j * WF_STEP)
  }
  const fx = Math.max(0, Math.min(WF_N - 1.001, (x + HALF_SIZE) / WF_STEP))
  const fz = Math.max(0, Math.min(WF_N - 1.001, (z + HALF_SIZE) / WF_STEP))
  const i = Math.floor(fx), j = Math.floor(fz)
  const u = fx - i, v = fz - j
  return waterField[j * WF_N + i] * (1 - u) * (1 - v) + waterField[j * WF_N + i + 1] * u * (1 - v) + waterField[(j + 1) * WF_N + i] * (1 - u) * v + waterField[(j + 1) * WF_N + i + 1] * u * v
}
function waterEdgeDistExact(x: number, z: number): number {
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
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)) - 12)
    }
  }
  for (const lake of meta.lakes) {
    best = Math.min(best, Math.abs(shoreDist(x, z, lake.shore)))
  }
  return best
}
const C_BASALT = new THREE.Color(0x4a423b) // volcano flanks
const C_CINDER = new THREE.Color(0x3a332e) // summit
const C_SNOW = new THREE.Color(0xe6ebef) // mountain caps

const _c = new THREE.Color()
const _c2 = new THREE.Color()

/** Splat weights (grass, dirt, rock, sand) matching groundColorAt's zones. */
function splatAt(x: number, z: number, h: number, ny: number, out: THREE.Vector4): THREE.Vector4 {
  let grass = 0
  let dirt = 0
  let rock = 0
  let sand = 0
  const biome = biomeAt(x, z)
  if (biome === BIOME.SWAMP) return out.set(0.15, 0.85, 0, 0)
  if (biome === BIOME.DESERT) {
    const rocky = ny < 0.82 ? Math.min(1, (0.82 - ny) / 0.2) : 0
    return out.set(0, 0.1, rocky, 0.9 - rocky)
  }
  if (h < 2.4) {
    sand = 1
  } else {
    grass = 1
    if (h < 3.6) {
      sand = ((3.6 - h) / 1.2) * 0.6
      grass = 1 - sand
    }
    // forest floor turns to dirt from the feathered wood line inward
    const forest = forestMaskAt(x, z)
    if (forest > -0.35) {
      dirt = Math.min(1, ((forest + 0.35) / 0.6)) * 0.85
      grass *= 1 - dirt
    }
    const wd = waterEdgeDist(x, z)
    if (wd < 14) {
      const t = Math.min(1, Math.max(0, 1 - wd / 14)) * 0.8
      const sandy = Math.min(1, Math.max(0, 1 - wd / 5)) * 0.6
      dirt = dirt * (1 - t) + t * (1 - sandy)
      sand = sand * (1 - t) + t * sandy
      grass *= 1 - t
    }
    if (h > 110) {
      // alpine: turf gives way to scree (rock texture) with height
      const t = Math.min(1, (h - 110) / 60)
      rock += t
      grass *= 1 - t
      dirt *= 1 - t
    }
  }
  if (ny < 0.82) {
    const t = Math.min(1, (0.82 - ny) / 0.2)
    rock = rock * (1 - t) + t
    grass *= 1 - t
    dirt *= 1 - t
    sand *= 1 - t
  }
  // snow: the sand texture is the smoothest of the four — a snowfield's surface
  if (h > 170 && Math.hypot(x - VOLCANO.x, z - VOLCANO.z) > 560) {
    const line = Math.min(1, Math.max(0, (h - 185 - varTFor(x, z) * 22) / 30))
    const hold = Math.min(1, Math.max(0, (ny - 0.38) / 0.3))
    const t = line * hold * 0.94
    sand = sand * (1 - t) + t
    rock *= 1 - t
    grass *= 1 - t
    dirt *= 1 - t
  }
  return out.set(grass, dirt, rock, sand)
}

function varTFor(x: number, z: number): number {
  const n1 = Math.sin(x * 0.021 + Math.sin(z * 0.017) * 2.1) * Math.cos(z * 0.019 - Math.sin(x * 0.023))
  const n2 = Math.sin(x * 0.11 + z * 0.09) * Math.cos(x * 0.07 - z * 0.13)
  return n1 * 0.5 + n2 * 0.28
}

/** Ground color by height/slope + two-frequency variation noise. */
/** QA (gate-m8): the ground colour the mesh is actually painted with, at a
 *  point. Exported so a gate can compare two woods' floors through the same
 *  function the terrain uses, rather than re-deriving the rule and testing
 *  its own copy of it. */
export function groundColorProbe(x: number, z: number): [number, number, number] {
  const c = groundColorAt(x, z, heightAt(x, z), normalAt(x, z, new THREE.Vector3()).y, new THREE.Color())
  return [c.r, c.g, c.b]
}

function groundColorAt(x: number, z: number, h: number, ny: number, out: THREE.Color): THREE.Color {
  // cheap deterministic variation (hash-free trig noise is fine for color)
  const n1 = Math.sin(x * 0.021 + Math.sin(z * 0.017) * 2.1) * Math.cos(z * 0.019 - Math.sin(x * 0.023))
  const n2 = Math.sin(x * 0.11 + z * 0.09) * Math.cos(x * 0.07 - z * 0.13)
  const varT = n1 * 0.5 + n2 * 0.28 // ~[-0.78, 0.78]

  // biome overrides first
  // BIOMES FADE, THEY DO NOT SWITCH (M79). These two used to `return` their
  // colour outright the moment `biomeAt` said so, and `biomeAt` is a hard
  // yes/no across a traced polygon — so the desert met the plain along a
  // line you could pick out from the air. `biomeBlendAt` ramps 0 to 1 over
  // the biome's own `edge` (120-160 m), and the override now mixes in over
  // that distance. Inside the biome proper the blend is 1 and the colour is
  // exactly what it always was.
  const biome = biomeAt(x, z)
  const bBlend = biomeBlendAt(x, z)
  if (biome === BIOME.SWAMP || biome === BIOME.DESERT) {
    if (biome === BIOME.SWAMP) {
      const wet = worldMeta?.swamp && h < worldMeta.swamp.level + 0.4
      _c.copy(wet ? C_SWAMP_WET : C_SWAMP).offsetHSL(0, 0, varTFor(x, z) * 0.03)
    } else {
      _c.copy(C_DESERT).lerp(C_DESERT_DARK, THREE.MathUtils.clamp(0.5 + varTFor(x, z) * 0.9, 0, 1))
      if (ny < 0.82) _c.lerp(C_ROCK, THREE.MathUtils.clamp((0.82 - ny) / 0.2, 0, 1))
    }
    if (bBlend > 0.995) return out.copy(_c)
    // ...otherwise fall through and paint the ordinary ground, then mix the
    // biome's own colour in by however deep into it this point is
    groundBase(x, z, h, ny, out, varT, n1, biome, bBlend)
    return out.lerp(_c, bBlend)
  }
  return groundBase(x, z, h, ny, out, varT, n1, biome, bBlend)
}

/** The ordinary ground — everything that is not a wholesale biome override.
 *  Split out of `groundColorAt` (M79) so the swamp and the desert can be
 *  MIXED over it across their edge instead of replacing it at a hard line. */
function groundBase(
  x: number, z: number, h: number, ny: number, out: THREE.Color,
  varT: number, n1: number, biome: number, bBlend: number,
): THREE.Color {
  // under a lake's fill level → bed color, never lawn
  for (const lake of worldMeta?.lakes ?? []) {
    if (shoreDist(x, z, lake.shore) < 2 && h < lake.level - 0.2) {
      return out.copy(C_DEEP).lerp(C_MUD, THREE.MathUtils.clamp((h - (lake.level - 5)) / 5, 0, 1) * 0.6)
    }
  }
  if (h < SEA_LEVEL - 0.4) {
    out.copy(C_DEEP).lerp(C_SAND, THREE.MathUtils.clamp((h + 8) / 8, 0, 1) * 0.5)
  } else if (h < 2.4) {
    out.copy(C_SAND).offsetHSL(0, 0, varT * 0.03)
  } else {
    // grass field: lush ↔ light by variation, dry olive patches where n1 peaks
    out.copy(C_GRASS_LUSH).lerp(C_GRASS_LIGHT, THREE.MathUtils.clamp(0.5 + varT * 0.9, 0, 1))
    if (biome === BIOME.PLAINS) out.lerp(C_PLAINS, 0.55 * bBlend)
    if (n1 > 0.22) out.lerp(C_GRASS_DRY, THREE.MathUtils.clamp((n1 - 0.22) * 2.0, 0, 0.9))
    // under the woods the ground is dirt and leaf litter, not lawn (the ARK
    // reference: forest floors are brown, greens live in the understory)
    const forest = forestMaskAt(x, z)
    if (forest > -0.35) {
      // (0.85 → 0.7: some green survives under the canopy — a wood is not a
      // dirt lot, and the mid-band tree twins over black ground looked dead)
      // A PINE FLOOR IS NOT A BROADLEAF FLOOR (M73). Standing in the north
      // pines and standing in the Southwood looked identical from the knees
      // down: the same litter, the same surviving green. Needles acidify the
      // soil and smother the undergrowth, so a pine floor is rust-brown,
      // drier, and much LESS green than a leaf floor — and the difference is
      // most of what tells you which wood you are in.
      const pine = forestKindAt(x, z) === FOREST_KIND.PINE
      const t = THREE.MathUtils.clamp((forest + 0.35) / 0.6, 0, 1) * (pine ? 0.92 : 0.7)
      const floor = pine
        ? _c.copy(C_NEEDLE).lerp(C_NEEDLE_LIT, 0.5 + varT * 0.5)
        : _c.copy(C_FLOOR).lerp(C_FLOOR_LIT, 0.5 + varT * 0.5)
      out.lerp(floor, t)
    }
    // wet banks: mud then a sand lip against rivers and lakes (backlog #1)
    const wd = waterEdgeDist(x, z)
    if (wd < 14) {
      const t = THREE.MathUtils.clamp(1 - wd / 14, 0, 1)
      out.lerp(_c.copy(C_MUD).lerp(C_SHORE_SAND, THREE.MathUtils.clamp(1 - wd / 5, 0, 1) * 0.6), t * 0.8)
    }
    // gray rocky patches where the low-frequency noise bottoms out
    if (n1 < -0.45) {
      out.lerp(C_ROCK, THREE.MathUtils.clamp((-0.45 - n1) * 2.2, 0, 0.7))
    }
    // beach→grass blend band
    if (h < 3.6) out.lerp(_c2.copy(C_SAND), (3.6 - h) / 1.2 * 0.6)
    // altitude on the RANGES: turf thins to alpine scree above ~110 m. (An
    // older rule faded everything above 55 m to basalt and above 130 m to
    // near-black cinder — meant for the v1 volcano, it painted both ranges as
    // coal heaps and the snow rule below never survived the slope rule — M18)
    if (h > 110) out.lerp(_c.copy(C_ALPINE).offsetHSL(0, 0, varT * 0.03), THREE.MathUtils.clamp((h - 110) / 60, 0, 1))
  }
  // the volcano's cone is its own rock: basalt flanks, cinder toward the rim
  const dvv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z)
  if (dvv < 560 && h > 30) {
    const cone = THREE.MathUtils.clamp((560 - dvv) / 160, 0, 1) * THREE.MathUtils.clamp((h - 30) / 40, 0, 1)
    out.lerp(C_BASALT, cone)
    if (h > 150) out.lerp(C_CINDER, cone * THREE.MathUtils.clamp((h - 150) / 80, 0, 1))
  }
  // slope: rock faces override
  if (ny < 0.82) {
    const t = THREE.MathUtils.clamp((0.82 - ny) / 0.2, 0, 1)
    out.lerp(_c.copy(ny < 0.62 ? C_ROCK_STEEP : C_ROCK).offsetHSL(0, 0, varT * 0.025), t)
  }
  // snow on the ranges above ~200 m (PLAN), a dithered snowline, holding on
  // any slope a snowfield holds (ny > 0.55) and thinning off the cliffs; the
  // volcano stays bare — hot rock
  if (h > 170 && dvv > 560) {
    const line = THREE.MathUtils.clamp((h - 185 - varT * 22) / 30, 0, 1)
    const hold = THREE.MathUtils.clamp((ny - 0.38) / 0.3, 0, 1)
    out.lerp(C_SNOW, line * hold * 0.94)
  }
  return out
}

export interface ChunkArrays { pos: Float32Array; nor: Float32Array; col: Float32Array; spl: Float32Array; indices: Uint32Array }

/**
 * Every array of one chunk's geometry — pure data, no THREE objects, so the
 * same function runs on the main thread (first frame) and in the terrain
 * worker (every LOD upgrade after that). Exact heights at every LOD.
 */
export function buildChunkArrays(originX: number, originZ: number, quads: number, size = CHUNK_SIZE): ChunkArrays {
  const step = size / quads
  const side = quads + 1
  const gridCount = side * side
  const skirtCount = side * 4
  const total = gridCount + skirtCount

  const pos = new Float32Array(total * 3)
  const nor = new Float32Array(total * 3)
  const col = new Float32Array(total * 3)
  const spl = new Float32Array(total * 4)
  const n = new THREE.Vector3()
  const c = new THREE.Color()
  const s4 = new THREE.Vector4()

  for (let iz = 0; iz < side; iz++) {
    for (let ix = 0; ix < side; ix++) {
      const x = originX + ix * step
      const z = originZ + iz * step
      const o = (iz * side + ix) * 3
      // exact heights at every LOD — an upward max-bias variant raised coarse
      // chunks above their fine neighbors and cracked the volcano silhouette
      const h = heightAt(x, z)
      pos[o] = x
      pos[o + 1] = h
      pos[o + 2] = z
      normalAt(x, z, n)
      nor[o] = n.x; nor[o + 1] = n.y; nor[o + 2] = n.z
      groundColorAt(x, z, h, n.y, c)
      // the island's baked ambient occlusion, folded straight into the vertex
      // colour — a gorge is always a gorge, so it costs nothing at runtime (M47)
      c.multiplyScalar(ambientAt(x, z))
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b
      splatAt(x, z, h, n.y, s4)
      const o4 = (iz * side + ix) * 4
      spl[o4] = s4.x; spl[o4 + 1] = s4.y; spl[o4 + 2] = s4.z; spl[o4 + 3] = s4.w
    }
  }

  // Skirts: one duplicated ring of edge vertices pushed straight down. The wall
  // they form hides the sliver gaps where a neighbor renders at a coarser LOD.
  // Normals copy the edge vertex's normal so the wall shades like the ground.
  const edgeIndex = (edge: number, i: number): number => {
    switch (edge) {
      case 0: return i                        // north row  (iz = 0)
      case 1: return (side - 1) * side + i    // south row  (iz = side-1)
      case 2: return i * side                 // west col   (ix = 0)
      default: return i * side + (side - 1)   // east col   (ix = side-1)
    }
  }
  for (let edge = 0; edge < 4; edge++) {
    for (let i = 0; i < side; i++) {
      const src = edgeIndex(edge, i) * 3
      const dst = (gridCount + edge * side + i) * 3
      pos[dst] = pos[src]
      pos[dst + 1] = pos[src + 1] - skirtDepthForStep(step)
      pos[dst + 2] = pos[src + 2]
      nor[dst] = nor[src]; nor[dst + 1] = nor[src + 1]; nor[dst + 2] = nor[src + 2]
      col[dst] = col[src]; col[dst + 1] = col[src + 1]; col[dst + 2] = col[src + 2]
      const s4src = edgeIndex(edge, i) * 4
      const s4dst = (gridCount + edge * side + i) * 4
      spl[s4dst] = spl[s4src]; spl[s4dst + 1] = spl[s4src + 1]; spl[s4dst + 2] = spl[s4src + 2]; spl[s4dst + 3] = spl[s4src + 3]
    }
  }

  const indices = new Uint32Array(quads * quads * 6 + quads * 4 * 6)
  let w = 0
  for (let iz = 0; iz < quads; iz++) {
    for (let ix = 0; ix < quads; ix++) {
      const a = iz * side + ix
      const b = a + 1
      const c = a + side
      const d = c + 1
      indices[w++] = a; indices[w++] = c; indices[w++] = b
      indices[w++] = b; indices[w++] = c; indices[w++] = d
    }
  }
  // skirt quads: edge vertex i, i+1 and their dropped copies. Winding flips per
  // edge so the wall always faces outward.
  for (let edge = 0; edge < 4; edge++) {
    const flip = edge === 0 || edge === 3
    for (let i = 0; i < quads; i++) {
      const top0 = edgeIndex(edge, i)
      const top1 = edgeIndex(edge, i + 1)
      const bot0 = gridCount + edge * side + i
      const bot1 = bot0 + 1
      if (flip) {
        indices[w++] = top0; indices[w++] = bot0; indices[w++] = top1
        indices[w++] = top1; indices[w++] = bot0; indices[w++] = bot1
      } else {
        indices[w++] = top0; indices[w++] = top1; indices[w++] = bot0
        indices[w++] = bot0; indices[w++] = top1; indices[w++] = bot1
      }
    }
  }
  return { pos, nor, col, spl, indices }
}

/** The ground's painted colour at a point — footstep dust takes its colour
 *  from the actual ground so a beach puffs sand and a wood puffs leaf litter
 *  (M49). Same function the terrain's vertex colours come from. */
const dustScratch = new THREE.Color()
export function groundHexAt(x: number, z: number): number {
  const h = heightAt(x, z)
  const ny = normalAt(x, z).y
  groundColorAt(x, z, h, ny, dustScratch)
  // lift it: dust in the air is brighter than the ground it came off
  return dustScratch.clone().multiplyScalar(1.9).getHex()
}

/** What you are standing on, for the footstep sampler (sfx.ts). Reads the same
 *  splat rules the ground is painted with, so the sound always matches the
 *  picture — walk from the meadow into the wood and the step goes soft. */
export type GroundKind = 'grass' | 'dirt' | 'sand' | 'rock' | 'snow'
const groundScratch = new THREE.Vector4()
export function groundKindAt(x: number, z: number): GroundKind {
  const h = heightAt(x, z)
  const ny = normalAt(x, z).y
  if (h > 195 && ny > 0.55) return 'snow'
  const s = splatAt(x, z, h, ny, groundScratch)
  const m = Math.max(s.x, s.y, s.z, s.w)
  return m === s.x ? 'grass' : m === s.y ? 'dirt' : m === s.z ? 'rock' : 'sand'
}

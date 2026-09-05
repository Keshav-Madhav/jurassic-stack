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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { heightAt, lodFloorAt, normalAt, forestMaskAt, forestKindAt, biomeAt, shoreDist, BIOME, FOREST_KIND, SEA_LEVEL, HALF_SIZE, SPAWN, VOLCANO, worldMeta } from './heightmap'
import { buildCanopyTree, buildElderTree, buildMushroom, buildRedwood, buildMangrove, buildDriedBush, buildCactus, buildReeds, buildPebbles, buildStones, buildSticks, buildOutcrop, buildGrassCard, buildFarPine } from './trees'
import { captureImpostor } from './impostor'
import { CHUNK_SIZE, CHUNKS_PER_SIDE } from './terrain'
import { addObstacle } from './obstacles'
import type { Physics } from './physics'
import type { ItemId } from './items'

export type NodeKind =
  | 'tree' | 'elder' | 'redwood' | 'pine' | 'deadtree' | 'palm' | 'willow' | 'mangrove'
  | 'rock' | 'log' | 'bush' | 'fern' | 'flower' | 'grass' | 'mushroom'
  | 'driedbush' | 'cactus' | 'reeds'
  | 'pebbles' | 'stones' | 'sticks' | 'boulder' | 'outcrop'

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
  redwood: { hp: 8, yields: { wood: [7, 12], fiber: [1, 3] } },
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
  mangrove: { hp: 3, yields: { wood: [2, 3], fiber: [1, 2] } },
  driedbush: { hp: 1, yields: { wood: [1, 1], fiber: [1, 2] } },
  cactus: { hp: 2, yields: { fiber: [1, 2], berry: [0, 1] } },
  reeds: { hp: 1, yields: { fiber: [2, 3] } },
  pebbles: { hp: 1, yields: { stone: [1, 2], flint: [0, 1] } },
  stones: { hp: 2, yields: { stone: [2, 3], flint: [0, 1] } },
  sticks: { hp: 1, yields: { wood: [1, 2] } },
  boulder: { hp: 5, yields: { stone: [4, 7], flint: [1, 2] } },
  outcrop: { hp: 8, yields: { stone: [6, 10], flint: [1, 3] } },
}

/** Kinds whose trunks get physics cylinders (rocks: squat cylinders too). */
const TRUNK_KINDS = new Set<NodeKind>(['tree', 'elder', 'redwood', 'pine', 'palm', 'deadtree', 'willow', 'rock', 'mangrove', 'cactus', 'boulder', 'outcrop'])
/** Single-trunk canopy kinds: wide crowns in the air, so slope under the
 *  footprint doesn't matter (the flatness guard is for merged groves). */
const CANOPY_KINDS = new Set<NodeKind>(['tree', 'elder', 'redwood', 'mangrove'])

interface ModelRef {
  /** GLB in models/props/ … */
  file?: string
  /** optional named sub-node to extract (variant packs) */
  node?: string
  /** … or a tree built in code (trees.ts), deterministic per seed */
  gen?: 'canopy' | 'elder' | 'mushroom' | 'redwood' | 'mangrove' | 'driedbush' | 'cactus' | 'reeds' | 'pebbles' | 'stones' | 'sticks' | 'outcrop' | 'grasscard'
  seed?: number
}

const KIND_MODELS: Record<NodeKind, ModelRef[]> = {
  // broadleaf woods: built wide-canopy trees (the Quaternius round crowns
  // read as neon lollipops against them and are out of the mix)
  tree: [{ gen: 'canopy', seed: 11 }, { gen: 'canopy', seed: 12 }, { gen: 'canopy', seed: 13 }, { gen: 'canopy', seed: 14 }],
  elder: [{ gen: 'elder', seed: 21 }, { gen: 'elder', seed: 22 }],
  redwood: [{ gen: 'redwood', seed: 41 }, { gen: 'redwood', seed: 42 }, { gen: 'redwood', seed: 43 }],
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
  // the floor is LITTERED: painted grass cards (6 tris) by the hundred thousand
  grass: [{ gen: 'grasscard', seed: 1 }, { gen: 'grasscard', seed: 2 }],
  mushroom: [{ gen: 'mushroom', seed: 31 }, { gen: 'mushroom', seed: 32 }],
  mangrove: [{ gen: 'mangrove', seed: 51 }, { gen: 'mangrove', seed: 52 }],
  driedbush: [{ gen: 'driedbush', seed: 61 }, { gen: 'driedbush', seed: 62 }],
  cactus: [{ gen: 'cactus', seed: 71 }, { gen: 'cactus', seed: 72 }],
  reeds: [{ gen: 'reeds', seed: 81 }],
  // the ground: what a real forest floor and hillside are littered with
  pebbles: [{ gen: 'pebbles', seed: 91 }, { gen: 'pebbles', seed: 92 }],
  stones: [{ gen: 'stones', seed: 93 }, { gen: 'stones', seed: 94 }],
  sticks: [{ gen: 'sticks', seed: 95 }, { gen: 'sticks', seed: 96 }],
  // the rock: boulders (the Quaternius rocks, big) and built outcrops
  boulder: [{ file: 'Rock1' }, { file: 'Rock2' }],
  outcrop: [{ gen: 'outcrop', seed: 97 }, { gen: 'outcrop', seed: 98 }],
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
  // REDWOODS: the Holm only (forest kind 3) — 55-80 m columns, tight-packed
  redwood: {
    cell: 15, chance: 0.75, sMin: 55, sMax: 80, cap: 3000, seed: 141, woodland: true,
    habitat: (h, _ny, f, _rd, k) => f > -0.6 && h > 4 && k === FOREST_KIND.REDWOOD,
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
  // (the visual carpet is grass.ts — these are the harvestable tufts)
  grass: { cell: 9, chance: 0.6, sMin: 0.7, sMax: 1.2, cap: 80000, seed: 555, habitat: (h) => h > 1.6 },
  mushroom: { cell: 26, chance: 0.45, sMin: 0.35, sMax: 0.8, cap: 3600, seed: 222, habitat: (h, _ny, f) => f > 0 && h > 3 },
  // THE SWAMP: mangroves on the wet ground, reeds at the water's edge, dried
  // bushes on the drier hummocks (biome gates below decide where these go)
  mangrove: { cell: 11, chance: 0.7, sMin: 7, sMax: 12, cap: 6000, seed: 333, habitat: (h) => h > 3.2 },
  reeds: { cell: 6, chance: 0.6, sMin: 1.5, sMax: 2.6, cap: 12000, seed: 444, habitat: (h) => h > 2.6 },
  // THE DESERT: cacti and dried bushes over the dune flats
  driedbush: { cell: 10, chance: 0.55, sMin: 1, sMax: 2, cap: 12000, seed: 666, habitat: (h) => h > 3 },
  cactus: { cell: 18, chance: 0.5, sMin: 2.5, sMax: 5, cap: 3000, seed: 777, habitat: (h) => h > 4 },
  // GROUND CLUTTER (mandate item 5): pebbles everywhere, sticks under trees,
  // stones on open and rising ground — all cover, culled close
  pebbles: { cell: 9, chance: 0.5, sMin: 0.3, sMax: 0.6, cap: 60000, seed: 888, habitat: (h) => h > 2 },
  sticks: { cell: 11, chance: 0.55, sMin: 0.25, sMax: 0.45, cap: 40000, seed: 999, habitat: (h, _ny, f) => f > -0.4 && h > 3 },
  stones: { cell: 20, chance: 0.45, sMin: 0.7, sMax: 1.4, cap: 16000, seed: 1010, habitat: (h) => h > 3 },
  // ROCK (mandate item 7): boulders on slopes and hills, outcrops where the
  // ground rises hard — cliffs, foothill crests, the ranges' feet
  boulder: { cell: 34, chance: 0.45, sMin: 3, sMax: 8, cap: 6000, seed: 1111, habitat: (h, ny) => h > 6 && (ny < 0.94 || h > 40) },
  outcrop: { cell: 58, chance: 0.5, sMin: 5, sMax: 14, cap: 2400, seed: 1212, habitat: (h, ny) => h > 12 && ny < 0.9 },
}

const RESPAWN_MS = 240_000
/** Supercell edge (m): instances group per cell so frustum culling and the
 *  LOD bands work per cell (512 m cells quadrupled the drawn triangles: every
 *  tree in a cell whose near edge was close rendered at full detail).
 *  Distance tests use the cell's bounding box, not its centre. */
const SUPER = 256
/** Ground-cover kinds: no shadow casting, distance-culled. */
const GROUND_COVER = new Set<NodeKind>(['grass', 'fern', 'flower', 'mushroom', 'log', 'bush', 'driedbush', 'reeds', 'pebbles', 'sticks', 'stones'])
/** small clutter vanishes sooner than bushes — a pebble is nothing at 100 m */
const COVER_DIST_OVERRIDE: Partial<Record<NodeKind, number>> = { pebbles: 110, sticks: 120, stones: 200, mushroom: 150, flower: 200, grass: 140 }
/** Cover cells beyond this range from the player are hidden entirely. */
let COVER_DRAW_DIST = 290
/** Tree LOD bands (viewer → cell box): the full model inside FAR; the built
 *  kinds' coarse twin (20-tri leaf masses) to MID; beyond that the IMPOSTOR —
 *  three textured cards carrying the real model's side and top views,
 *  captured at load (impostor.ts). Kinds without a coarse twin go straight
 *  to cards at FAR. (User: "trees become billboards too soon" — the bands
 *  were 180 m → cards.) */
let TREE_LOD_FAR = 240
let TREE_LOD_MID = 480
/** QA/tuning: move the LOD bands at runtime (call scatter.updateVisibility after) */
export function setLodBands(bands: { far?: number; mid?: number; cover?: number }): { far: number; mid: number; cover: number } {
  if (bands.far !== undefined) TREE_LOD_FAR = bands.far
  if (bands.mid !== undefined) TREE_LOD_MID = bands.mid
  if (bands.cover !== undefined) COVER_DRAW_DIST = bands.cover
  return { far: TREE_LOD_FAR, mid: TREE_LOD_MID, cover: COVER_DRAW_DIST }
}
/** kinds that get impostors (everything tall enough to matter at a distance) */
const IMPOSTOR_KINDS = new Set<NodeKind>(['tree', 'elder', 'redwood', 'pine', 'palm', 'deadtree', 'willow', 'mangrove', 'outcrop'])
/** Small solid props (boulders, logs) vanish beyond this — a 2 m rock is a
 *  pixel at 600 m, but 2,000 of them at full geometry are not free. */
// (rocks to 600 m and boulders to 1000 m cost 124 draw calls at the wood line
// for ~800 stones nobody could see — M18 draw audit)
const SMALL_SOLID_DRAW_DIST = 420
const SMALL_SOLID = new Set<NodeKind>(['rock', 'boulder', 'outcrop'])
const SMALL_SOLID_DIST: Partial<Record<NodeKind, number>> = { rock: 220, boulder: 420, outcrop: 480 }
/** outcrops keep their far twin (coarse stones) to the horizon */

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

    let parts: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }[] = []
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
      // CUTOUT, never blended: a blended leaf (Quaternius pine needles, palm
      // fronds, the berry bush ship alphaMode BLEND) writes no depth and sorts
      // by renderOrder — the water sheets (renderOrder 1–4) drew straight over
      // every bush and tree between you and the sea (user screenshot 19)
      if (mat.transparent) {
        mat.transparent = false
        mat.depthWrite = true
        mat.alphaTest = Math.max(mat.alphaTest, 0.45)
        mat.needsUpdate = true
      }
      // real-leaf greens: Quaternius foliage ships bright — pull green-dominant
      // materials toward deep leaf green (user art direction: darker world)
      // green AND yellow-green foliage (the willow's leaves have high red and
      // slipped the strict test — the neon bush on the riverbank)
      if (mat.color.g > mat.color.r * 0.9 && mat.color.g > mat.color.b * 1.1 && mat.color.g > 0.25) {
        mat.color.lerp(new THREE.Color(0x14300f), 0.55)
      }
      if (this.recolor) this.recolor(mat)
      parts.push({ geo, mat })
    })
    // UNTEXTURED submeshes fold into one vertex-coloured geometry: a prop's
    // draw calls are per submesh per cell, and the mossy log GLB's five flat
    // materials were 25 draw calls for 49 logs at the wood line (M18 audit)
    const plain = parts.filter((p) => !p.mat.map && !p.mat.alphaMap && !p.mat.vertexColors)
    if (plain.length >= 2) {
      const merged: THREE.BufferGeometry[] = []
      for (const p of plain) {
        const g = p.geo
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
        const n = g.getAttribute('position').count
        const col = new Float32Array(n * 3)
        for (let i = 0; i < n; i++) { col[i * 3] = p.mat.color.r; col[i * 3 + 1] = p.mat.color.g; col[i * 3 + 2] = p.mat.color.b }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3))
        if (!g.getAttribute('normal')) g.computeVertexNormals()
        merged.push(g.index ? g.toNonIndexed() : g)
      }
      const one = mergeGeometries(merged, false)
      if (one) {
        const mat = plain[0].mat.clone()
        mat.color.set(0xffffff)
        mat.vertexColors = true
        mat.map = null
        mat.needsUpdate = true
        parts = parts.filter((p) => !plain.includes(p))
        parts.push({ geo: one, mat })
      }
    }
    for (const { geo, mat } of parts) {
      const im = new THREE.InstancedMesh(geo, mat, capacity)
      im.count = 0
      im.frustumCulled = true // per-supercell now — computeBounds() after fill
      im.matrixAutoUpdate = false // static: thousands of these, one less matrix multiply each per frame
      im.castShadow = this.castShadowFlag
      im.receiveShadow = true
      this.meshes.push(im)
      group.add(im)
    }
  }

  /** During the fill everything is written, so whole-buffer uploads are
   *  right; after `sealed` (computeBounds) every write is a partial upload
   *  (addUpdateRange) — flipping one cell's dot range on an island-wide
   *  40K-instance mesh re-uploaded 2.5 MB per band change, a hitch at speed. */
  private sealed = false
  private markInstance(m: THREE.InstancedMesh, i: number, color: boolean): void {
    if (this.sealed) {
      m.instanceMatrix.addUpdateRange(i * 16, 16)
      if (color && m.instanceColor) m.instanceColor.addUpdateRange(i * 3, 3)
    }
    m.instanceMatrix.needsUpdate = true
    if (color && m.instanceColor) m.instanceColor.needsUpdate = true
  }

  setInstance(i: number, x: number, y: number, z: number, scale: number, rotY: number, tint = 1, mark = true): void {
    this.dummy.position.set(x, y, z)
    this.dummy.rotation.set(0, rotY, 0)
    this.dummy.scale.setScalar(scale)
    this.dummy.updateMatrix()
    const c = new THREE.Color(tint, tint, tint)
    for (const m of this.meshes) {
      m.setMatrixAt(i, this.dummy.matrix)
      m.setColorAt(i, c)
      m.count = Math.max(m.count, i + 1)
      if (mark) this.markInstance(m, i, true)
    }
  }

  /** One upload for a contiguous block written with mark=false. */
  markRange(start: number, count: number): void {
    for (const m of this.meshes) {
      if (this.sealed) {
        m.instanceMatrix.addUpdateRange(start * 16, count * 16)
        if (m.instanceColor) m.instanceColor.addUpdateRange(start * 3, count * 3)
      }
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
  }

  /** Hide by zero-scaling AT the node position (a zero matrix at the origin
   *  would balloon the instanced bounding sphere toward world 0,0,0). */
  hideInstance(i: number, x: number, y: number, z: number, mark = true): void {
    this.dummy.position.set(x, y, z)
    this.dummy.rotation.set(0, 0, 0)
    this.dummy.scale.setScalar(0.0001)
    this.dummy.updateMatrix()
    for (const m of this.meshes) {
      m.setMatrixAt(i, this.dummy.matrix)
      if (mark) this.markInstance(m, i, false)
    }
  }

  /** Compute per-mesh bounding spheres from the filled instances; from here
   *  on, writes upload only their own slots. */
  computeBounds(): void {
    for (const m of this.meshes) m.computeBoundingSphere()
    this.sealed = true
  }
}

/**
 * One island-wide instanced mesh for a kind+variant's LOD band (the coarse
 * mid model or the impostor cards). Slots are grouped by supercell so a
 * cell's block shows/hides as one contiguous upload; hidden slots are
 * zero-scale.
 */
class SlotSet {
  readonly mesh: THREE.InstancedMesh
  readonly total: number
  shown = 0
  private ranges = new Map<string, { start: number; ids: number[]; shown: boolean }>()
  private slotOf = new Map<number, number>()
  private dummy = new THREE.Object3D()

  /** the impostor cards for a prop (captured from its normalized meshes) */
  static impostor(renderer: THREE.WebGLRenderer, sample: InstancedProp, cells: { cell: string; ids: number[] }[], nodes: ScatterNode[], group: THREE.Group): SlotSet {
    const root = new THREE.Group()
    for (const m of sample.meshes) root.add(new THREE.Mesh(m.geometry, m.material))
    const bb = new THREE.Box3().setFromObject(root)
    const size = bb.getSize(new THREE.Vector3())
    const imp = captureImpostor(renderer, root, bb.min.y, size.y, Math.max(size.x, size.z))
    return new SlotSet(imp.geometry, [imp.sideMaterial, imp.topMaterial], cells, nodes, group, false)
  }

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], cells: { cell: string; ids: number[] }[], private nodes: ScatterNode[], group: THREE.Group, castShadow: boolean) {
    let total = 0
    for (const c of cells) total += c.ids.length
    this.total = total
    this.mesh = new THREE.InstancedMesh(geometry, material, total)
    this.mesh.frustumCulled = false // island-wide
    this.mesh.matrixAutoUpdate = false
    this.mesh.castShadow = castShadow
    this.mesh.receiveShadow = false
    let slot = 0
    for (const c of cells) {
      this.ranges.set(c.cell, { start: slot, ids: c.ids, shown: false })
      for (const id of c.ids) {
        this.slotOf.set(id, slot)
        this.write(slot, this.nodes[id], false)
        slot++
      }
    }
    this.mesh.count = total
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.computeBoundingSphere()
    group.add(this.mesh)
  }

  private write(slot: number, n: ScatterNode, show: boolean): void {
    this.dummy.position.set(n.x, n.y, n.z)
    this.dummy.rotation.set(0, show ? n.rotY : 0, 0)
    this.dummy.scale.setScalar(show ? n.scale : 0.0001)
    this.dummy.updateMatrix()
    this.mesh.setMatrixAt(slot, this.dummy.matrix)
  }

  /** flip a whole cell's block (one upload) */
  setCell(cell: string, show: boolean): void {
    const r = this.ranges.get(cell)
    if (!r || r.shown === show) return
    r.shown = show
    for (const id of r.ids) this.write(this.slotOf.get(id)!, this.nodes[id], show && this.nodes[id].alive)
    this.shown += show ? r.ids.length : -r.ids.length
    this.mesh.instanceMatrix.addUpdateRange(r.start * 16, r.ids.length * 16)
    this.mesh.instanceMatrix.needsUpdate = true
  }

  /** a single node harvested/respawned */
  setNode(n: ScatterNode, alive: boolean): void {
    const slot = this.slotOf.get(n.id)
    if (slot === undefined) return
    let shown = false
    for (const r of this.ranges.values()) if (slot >= r.start && slot < r.start + r.ids.length) { shown = r.shown; break }
    this.write(slot, n, alive && shown)
    this.mesh.instanceMatrix.addUpdateRange(slot * 16, 16)
    this.mesh.instanceMatrix.needsUpdate = true
  }
}

export class Scatter {
  readonly group = new THREE.Group()
  readonly nodes: ScatterNode[] = []
  private props = new Map<string, InstancedProp>()
  /** impostors: ONE instanced cross-card mesh per kind+variant for the whole
   *  island (two draw calls each: side cards, crown card), instances laid out
   *  cell by cell so a cell's block flips as one contiguous upload */
  private impostors = new Map<string, SlotSet>()
  /** the mid band: the built kinds' coarse twins, PER CELL (frustum-culled
   *  like the full props — an island-wide slot set would submit every coarse
   *  tree's triangles each frame, 11M of them, zero-scaled or not) */
  private mids = new Map<string, InstancedProp>()
  private order = new Map<string, number[]>()
  /** per mid twin (`kind#cell`): node id → instance slot */
  private midIndex = new Map<string, Map<number, number>>()
  private propMeta = new Map<string, { minX: number; maxX: number; minZ: number; maxZ: number; cover: boolean; small: boolean }>()
  private treeColliders = new Map<number, RAPIER.Collider>()
  private activeChunks = new Set<number>()
  /** solid (collider-bearing) node ids per terrain chunk — the collider
   *  stream walks 9 chunks' worth, not all 300K nodes */
  private solidByChunk = new Map<number, number[]>()
  /** harvested nodes waiting to respawn — the respawn tick walks only these */
  private dead = new Set<number>()
  private lastChunkKey = -1
  private tmpN = new THREE.Vector3()
  private pendingColliderDrops: number[] = []

  async load(renderer: THREE.WebGLRenderer): Promise<void> {
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
      if (ref.gen === 'mushroom' || ref.gen === 'driedbush' || ref.gen === 'cactus' || ref.gen === 'reeds' || ref.gen === 'pebbles' || ref.gen === 'stones' || ref.gen === 'sticks' || ref.gen === 'grasscard') {
        const small = { mushroom: buildMushroom, driedbush: buildDriedBush, cactus: buildCactus, reeds: buildReeds, pebbles: buildPebbles, stones: buildStones, sticks: buildSticks, grasscard: buildGrassCard }[ref.gen]
        built.set(key, small(ref.seed ?? 1))
        continue
      }
      const make = ref.gen === 'elder' ? buildElderTree : ref.gen === 'redwood' ? buildRedwood : ref.gen === 'mangrove' ? buildMangrove : ref.gen === 'outcrop' ? buildOutcrop : buildCanopyTree
      built.set(key, make(ref.seed ?? 1))
    }
    const rootOf = (ref: ModelRef): THREE.Object3D => {
      if (ref.gen) return built.get(`${ref.gen}:${ref.seed}`)!
      const src = loaded.get(ref.file!)!
      return ref.node ? (src.getObjectByName(ref.node) ?? src) : src
    }
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
        kind === 'rock' || kind === 'boulder'
          ? (mat: THREE.MeshStandardMaterial) => {
              // stone is gray: drop the clay-orange texture Rock2 ships with
              // and cap the lightness (Rock1 read as white chalk in the sun)
              if (mat.map) { mat.map = null; mat.color.setScalar(0.4); mat.needsUpdate = true }
              const lum = mat.color.r * 0.3 + mat.color.g * 0.6 + mat.color.b * 0.1
              mat.color.setRGB(1, 1.0, 1.02).multiplyScalar(THREE.MathUtils.clamp(lum * 0.6 + 0.08, 0.13, 0.27)) // weathered stone, not chalk
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
      // cell bounds for distance culling
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (const nodeId of ids) {
        const n = this.nodes[nodeId]
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x)
        minZ = Math.min(minZ, n.z); maxZ = Math.max(maxZ, n.z)
      }
      this.propMeta.set(key, { minX, maxX, minZ, maxZ, cover, small: SMALL_SOLID.has(kind) })
    }

    // the impostors: per kind+variant, one island-wide cross-card mesh whose
    // slots are laid out cell by cell; captured from the normalized prop so
    // the cards sit exactly where the model does
    for (const kind of IMPOSTOR_KINDS) {
      for (let variant = 0; variant < KIND_MODELS[kind].length; variant++) {
        const cells: { cell: string; ids: number[] }[] = []
        let sample: InstancedProp | null = null
        for (const [key, ids] of this.order) {
          const pk = parseGroupKey(key)
          if (pk.kind !== kind || pk.variant !== variant) continue
          cells.push({ cell: key.slice(key.lastIndexOf('#') + 1), ids })
          sample ??= this.props.get(key)!
        }
        if (!sample || !cells.length) continue
        this.impostors.set(`${kind}#${variant}`, SlotSet.impostor(renderer, sample, cells, this.nodes, this.group))
      }
      // the mid band: ONE coarse twin per kind (the 20-tri masses don't need
      // the variants' differences), one instanced mesh per cell holding every
      // variant's nodes, hidden until its band comes. Per kind+variant it was
      // ~90 draw calls of leaf blobs in the 240–480 m ring (M18 draw audit)
      const ref = KIND_MODELS[kind][0]
      let farRoot: THREE.Object3D | null = null
      if (ref.gen === 'canopy') farRoot = buildCanopyTree(ref.seed ?? 1, true)
      else if (ref.gen === 'elder') farRoot = buildElderTree(ref.seed ?? 1, true)
      else if (ref.gen === 'redwood') farRoot = buildRedwood(ref.seed ?? 1, true)
      else if (ref.gen === 'mangrove') farRoot = buildMangrove(ref.seed ?? 1, true)
      else if (ref.gen === 'outcrop') farRoot = buildOutcrop(ref.seed ?? 1, true)
      else if (kind === 'pine') farRoot = buildFarPine(new THREE.Color(0x27521f), new THREE.Color(0x5a3c30), 7)
      if (!farRoot) continue
      const byCell = new Map<string, number[]>()
      for (const [key, ids] of this.order) {
        if (parseGroupKey(key).kind !== kind) continue
        const cell = key.slice(key.lastIndexOf('#') + 1)
        const list = byCell.get(cell) ?? []
        for (const id of ids) list.push(id)
        byCell.set(cell, list)
      }
      for (const [cell, ids] of byCell) {
        const twin = new InstancedProp(farRoot, Math.max(ids.length, 1), this.group, true)
        const index = new Map<number, number>()
        ids.forEach((nodeId, i) => {
          const n = this.nodes[nodeId]
          twin.setInstance(i, n.x, n.y, n.z, n.scale, n.rotY, n.tint)
          index.set(nodeId, i)
        })
        twin.computeBounds()
        for (const m of twin.meshes) m.visible = false
        this.mids.set(`${kind}#${cell}`, twin)
        this.midIndex.set(`${kind}#${cell}`, index)
      }
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
        const visible = d < (COVER_DIST_OVERRIDE[parseGroupKey(key).kind] ?? COVER_DRAW_DIST)
        for (const m of this.props.get(key)!.meshes) m.visible = visible
        continue
      }
      if (meta.small) {
        const visible = d < (SMALL_SOLID_DIST[parseGroupKey(key).kind] ?? SMALL_SOLID_DRAW_DIST)
        for (const m of this.props.get(key)!.meshes) m.visible = visible
        continue
      }
      const { kind, variant } = parseGroupKey(key)
      const set = this.impostors.get(`${kind}#${variant}`)
      if (!set) {
        // no cards for this kind (cacti, dead trees, palms, willows, mangroves):
        // it simply ends at the mid band — it drew island-wide before
        for (const m of this.props.get(key)!.meshes) m.visible = d < TREE_LOD_MID
        continue
      }
      const cell = key.slice(key.lastIndexOf('#') + 1)
      const mid = this.mids.get(`${kind}#${cell}`)
      const band = d < TREE_LOD_FAR ? 0 : mid && d < TREE_LOD_MID ? 1 : 2
      for (const m of this.props.get(key)!.meshes) m.visible = band === 0
      if (mid) for (const m of mid.meshes) m.visible = band === 1
      set.setCell(cell, band === 2)
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
        if (ny < (kind === 'rock' || kind === 'boulder' || kind === 'outcrop' ? 0.5 : 0.72)) continue
        const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z)
        if (kind !== 'rock' && kind !== 'boulder' && kind !== 'outcrop' && kind !== 'deadtree' && dv < 300) continue
        if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 14) continue
        const riverD = riverDistAt(x, z)
        if (riverD < 13 && kind !== 'willow') continue // keep channels clear
        const forestHere = forestMaskAt(x, z)
        const forestKind = forestKindAt(x, z)
        // woodland kinds thin toward the wood line: full packing deep inside,
        // a third of it where the feathered edge runs out — and a few lone
        // trees stand in the open beyond it (the habitat's f > -0.4 floor is
        // lifted for 4% of open cells), so no wood ends at a line
        if (spec.woodland && woodRoll > 0.3 + 0.7 * (forestHere + 1) * 0.5) continue
        const loneTree = spec.woodland && (kind === 'tree' || kind === 'pine') && forestHere <= -0.4 && forestHere > -0.98 && woodRoll < 0.04 * (forestHere + 1)
        const biome = biomeAt(x, z)
        // biome vegetation rules (the depth mandate): swamps are willow/dead-
        // tree/fern marsh; deserts are near-barren rock+deadwood; plains are
        // open bush-and-grass seas with the odd lone tree
        if (biome === BIOME.SWAMP) {
          if (kind === 'tree' || kind === 'elder' || kind === 'redwood' || kind === 'pine' || kind === 'palm' || kind === 'flower' || kind === 'cactus') continue
          if (kind === 'willow' && rand() > 0.9) { /* willows thrive: bypass river rule below */ }
          // the wet floor: mangroves where the table is near, reeds right at it,
          // dried bushes only on the drier hummocks
          const table = worldMeta?.swamp?.level ?? 4.2
          if (kind === 'mangrove' && h > table + 2.2) continue
          if (kind === 'reeds' && (h > table + 0.5 || h < table - 0.4)) continue
          if (kind === 'driedbush' && h < table + 1.2) continue
        } else if (biome === BIOME.DESERT) {
          if (!(kind === 'rock' || kind === 'boulder' || kind === 'outcrop' || kind === 'pebbles' || kind === 'stones' || kind === 'deadtree' || kind === 'cactus' || kind === 'driedbush' || (kind === 'grass' && rand() < 0.15) || (kind === 'bush' && rand() < 0.08))) continue
        } else {
          // swamp and desert flora stay in their biomes (reeds may line any lake shore)
          if (kind === 'mangrove' || kind === 'cactus' || kind === 'driedbush') continue
          if (kind === 'reeds') {
            let lakeEdge = false
            for (const lake of worldMeta?.lakes ?? []) {
              const sd = shoreDist(x, z, lake.shore)
              if (sd > -2 && sd < 10 && h < lake.level + 0.6) { lakeEdge = true; break }
            }
            if (!lakeEdge) continue
          }
        }
        if (biome === BIOME.PLAINS) {
          if (kind === 'tree' || kind === 'pine' || kind === 'elder' || kind === 'redwood') { if (rand() > 0.06) continue }
          if (kind === 'fern' || kind === 'mushroom') continue
        }
        // swamp fauna bypass their usual habitat rules (willows off-river,
        // ferns outside forest, dead trees anywhere wet)
        const swampFlora = biome === BIOME.SWAMP && (kind === 'willow' || kind === 'deadtree' || kind === 'fern' || kind === 'grass' || kind === 'bush' || kind === 'mushroom' || kind === 'mangrove' || kind === 'reeds' || kind === 'driedbush')
        const coastD = kind === 'palm' && worldMeta?.coast ? Math.abs(shoreDist(x, z, worldMeta.coast)) : Infinity
        if (!swampFlora && !loneTree && !spec.habitat(h, ny, forestHere, riverD, forestKind, coastD)) continue
        if (loneTree && (h < 3.2 || h > (kind === 'pine' ? 210 : 130) || (kind === 'pine' && z > -300))) continue
        // plains mega-bushes (the depth mandate); giants are their own kind now
        let scaleMul = 1
        if (kind === 'bush' && biome === BIOME.PLAINS) scaleMul = 1.3
        // (rock sits on any slope — that's where rock is)
        if (footprintAspect > 0.8 && !CANOPY_KINDS.has(kind) && kind !== 'boulder' && kind !== 'outcrop' && kind !== 'stones') {
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
        if (TRUNK_KINDS.has(kind)) {
          addObstacle(x, z, kind === 'rock' || kind === 'boulder' ? scale * 0.42 : kind === 'outcrop' ? scale * 0.3 : kind === 'elder' ? scale * 0.05 : kind === 'redwood' ? scale * 0.04 : 0.4)
          const ck = this.chunkKeyOf(this.nodes[id])
          if (!this.solidByChunk.has(ck)) this.solidByChunk.set(ck, [])
          this.solidByChunk.get(ck)!.push(id)
        }
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
    this.dead.add(node.id)
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
    for (const id of this.dead) {
      const n = this.nodes[id]
      if (n.alive || n.respawnAt > now) continue
      n.alive = true
      n.hp = NODE_DEFS[n.kind].hp
      this.dead.delete(id)
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
    this.impostors.get(`${node.kind}#${node.variant}`)?.setNode(node, visible)
    const midKey = `${node.kind}#${key.slice(key.lastIndexOf('#') + 1)}`
    const mid = this.mids.get(midKey)
    const mi = this.midIndex.get(midKey)?.get(node.id)
    if (mid && mi !== undefined) {
      if (visible) mid.setInstance(mi, node.x, node.y, node.z, node.scale, node.rotY, node.tint)
      else mid.hideInstance(mi, node.x, node.y, node.z)
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
    for (const ck of this.activeChunks) {
      const ids = this.solidByChunk.get(ck)
      if (!ids) continue
      for (const id of ids) {
      const n = this.nodes[id]
      if (!n.alive || this.treeColliders.has(n.id)) continue
      const rock = n.kind === 'rock' || n.kind === 'boulder' || n.kind === 'outcrop'
      if (rock) {
        // rock gets the shape you see: a convex hull of the prop's own
        // vertices, scaled and turned like the instance (a cylinder stood you
        // in mid-air beside a boulder and on a flat invisible lid on top)
        const desc = this.hullFor(n)
        if (desc) {
          this.treeColliders.set(n.id, physics.world.createCollider(desc))
          continue
        }
      }
      const half = rock ? n.scale * 0.32 : n.scale * 0.5
      const radius = n.kind === 'outcrop' ? n.scale * 0.3 : rock ? n.scale * 0.42 : n.kind === 'elder' ? n.scale * 0.05 : n.kind === 'redwood' ? n.scale * 0.04 : Math.max(0.3, n.scale * 0.045)
      const col = physics.world.createCollider(
        RAPIER.ColliderDesc.cylinder(half, radius).setTranslation(n.x, n.y + half, n.z),
      )
      this.treeColliders.set(n.id, col)
      }
    }
  }

  /** hull points per kind+variant, in the normalized prop's space (cached) */
  private hullPoints = new Map<string, Float32Array>()
  private hullFor(n: ScatterNode): RAPIER.ColliderDesc | null {
    const kv = `${n.kind}#${n.variant}`
    let base = this.hullPoints.get(kv)
    if (!base) {
      const key = groupKeyOf(n.kind, n.variant, n.x, n.z)
      const geo = this.props.get(key)?.meshes[0]?.geometry
      if (!geo) return null
      const pos = geo.getAttribute('position')
      // every ~3rd vertex is plenty for a hull; rocks are lumpy, not spiky
      const stride = Math.max(1, Math.floor(pos.count / 160))
      const pts: number[] = []
      for (let i = 0; i < pos.count; i += stride) pts.push(pos.getX(i), pos.getY(i), pos.getZ(i))
      base = new Float32Array(pts)
      this.hullPoints.set(kv, base)
    }
    const c = Math.cos(n.rotY), s = Math.sin(n.rotY)
    const out = new Float32Array(base.length)
    for (let i = 0; i < base.length; i += 3) {
      const x = base[i] * n.scale, y = base[i + 1] * n.scale, z = base[i + 2] * n.scale
      out[i] = x * c + z * s
      out[i + 1] = y
      out[i + 2] = -x * s + z * c
    }
    return RAPIER.ColliderDesc.convexHull(out)?.setTranslation(n.x, n.y, n.z) ?? null
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

  /** QA: alive nodes within r of (x,z), by kind */
  nodesNear(x: number, z: number, r: number): Record<string, number> {
    const out: Record<string, number> = {}
    for (const n of this.nodes) {
      if (!n.alive || Math.hypot(n.x - x, n.z - z) > r) continue
      out[n.kind] = (out[n.kind] ?? 0) + 1
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
      out.push({
        key,
        nodes: this.order.get(key)?.length ?? 0,
        submeshes: prop.meshes.length,
        drawn: prop.meshes[0]?.count ?? 0,
        // triangles this group submits (visible LOD only; frustum culling
        // then drops whole supercells)
        tris: trisOf(prop),
        visible: prop.meshes.some((m) => m.visible),
      })
    }
    for (const [kv, set] of this.impostors) {
      out.push({ key: `${kv.split('#')[0]}#impostor`, nodes: set.total, submeshes: 1, drawn: set.shown, tris: set.shown * 6, visible: set.shown > 0 })
    }
    for (const [k, mid] of this.mids) {
      if (!mid.meshes.some((m) => m.visible)) continue
      out.push({ key: `${k.split('#')[0]}#mid`, nodes: mid.meshes[0]?.count ?? 0, submeshes: mid.meshes.length, drawn: mid.meshes[0]?.count ?? 0, tris: trisOf(mid), visible: true })
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
      this.dead.add(n.id)
      this.setNodeVisible(n, false)
    }
  }
}

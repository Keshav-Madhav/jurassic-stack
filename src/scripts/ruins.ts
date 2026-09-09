// Ruins: hand-designed prefab arrangements at the six baked ruin sites
// (world-meta.json places them on the spawn→summit gradient). The first
// visible layer of the arc — "someone tried to live here first" — and the
// beach stag statue is the tutorial: it faces the volcano.
//
// Few dozen meshes total, so plain clones (no instancing). Standing pieces
// get physics; toppled pieces and arch spans stay walkable.
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { heightAt, VOLCANO, worldMeta } from './heightmap'
import { makeStone } from './stone-material'
import { ENGRAMS } from './engrams'
import { ITEMS } from './items'
import type { Physics } from './physics'
import { registerWarmRoot } from './uploads'
import { addObstacle } from './obstacles'

type RuinModel = 'Column' | 'Arch' | 'Statue'

interface PiecePlan {
  model: RuinModel
  dx: number
  dz: number
  rotY?: number
  /** world height in meters */
  h: number
  /** lying on its side (no collider) */
  toppled?: boolean
}

/** Per-site prefab layouts, in local offsets around the baked site center. */
const LAYOUTS: Record<string, PiecePlan[]> = {
  'beach-statue': [
    { model: 'Statue', dx: 0, dz: 0, h: 4.2 }, // rotY set to face the volcano at build time
    { model: 'Column', dx: -3.2, dz: 1.8, h: 2.6 },
    { model: 'Column', dx: 3.4, dz: 1.4, h: 1.8, toppled: true },
  ],
  'coast-shrine': [
    { model: 'Column', dx: -4, dz: -4, h: 4 },
    { model: 'Column', dx: 4, dz: -4, h: 4 },
    { model: 'Column', dx: -4, dz: 4, h: 4 },
    { model: 'Column', dx: 4, dz: 4, h: 3, toppled: true },
    { model: 'Arch', dx: 0, dz: -7, h: 6, rotY: 0 },
  ],
  'forest-temple': [
    { model: 'Arch', dx: 0, dz: 8, h: 6.5, rotY: 0 },
    { model: 'Column', dx: -5, dz: 4, h: 4.5 },
    { model: 'Column', dx: 5, dz: 4, h: 4.5 },
    { model: 'Column', dx: -5, dz: -2, h: 4.5 },
    { model: 'Column', dx: 5, dz: -2, h: 3.2, toppled: true },
    { model: 'Column', dx: 0, dz: -8, h: 4.8 },
    { model: 'Statue', dx: 0, dz: -12, h: 3.4, rotY: 0 },
  ],
  'highland-arch': [
    { model: 'Arch', dx: 0, dz: 0, h: 7.5, rotY: 0.6 },
    { model: 'Column', dx: -6, dz: 3, h: 4 },
    { model: 'Column', dx: 6, dz: -3, h: 2.6, toppled: true },
  ],
  'foothill-vault': [
    { model: 'Arch', dx: 0, dz: 0, h: 5.5, rotY: 0.3 },
    { model: 'Column', dx: -7, dz: 5, h: 4.2 },
    { model: 'Column', dx: 7, dz: 5, h: 3, toppled: true },
  ],
  // THE CALDERA GATE — monumental: a 15 m arch (the door the keystones
  // unseal, M8) at the head of a 70 m causeway of columns, two guardian
  // statues facing the approach — readable from the far end of the corridor
  'caldera-gate': [
    { model: 'Arch', dx: 0, dz: -36, h: 15, rotY: 0 }, // IN the Ravine's mouth, where the rock face rises (M19: it stood 14 m out on the apron and you walked round it)
    { model: 'Column', dx: -12, dz: -22, h: 9 },
    { model: 'Column', dx: 12, dz: -22, h: 9 },
    { model: 'Statue', dx: -7, dz: 4, h: 7, rotY: Math.PI },
    { model: 'Statue', dx: 7, dz: 4, h: 7, rotY: Math.PI },
    { model: 'Column', dx: -9, dz: 18, h: 7 }, { model: 'Column', dx: 9, dz: 18, h: 7 },
    { model: 'Column', dx: -9, dz: 32, h: 7 }, { model: 'Column', dx: 9, dz: 32, h: 5, toppled: true },
    { model: 'Column', dx: -9, dz: 46, h: 6.5, toppled: true }, { model: 'Column', dx: 9, dz: 46, h: 7 },
    { model: 'Column', dx: -9, dz: 60, h: 7 }, { model: 'Column', dx: 9, dz: 60, h: 7 },
  ],
}

/** Minor-ruin layouts by kind (hand-geometry gives each site a `layout`). */
const LAYOUTS_BY_KIND: Record<string, PiecePlan[]> = {
  columns: [
    { model: 'Column', dx: -6, dz: 0, h: 4.6 }, { model: 'Column', dx: -2, dz: 0, h: 4.2 },
    { model: 'Column', dx: 2, dz: 0, h: 3.2, toppled: true }, { model: 'Column', dx: 6, dz: 0, h: 4.8 },
  ],
  arch: [
    { model: 'Arch', dx: 0, dz: 0, h: 6.5, rotY: 0.4 },
    { model: 'Column', dx: -6, dz: 3, h: 4 }, { model: 'Column', dx: 6, dz: -2, h: 2.8, toppled: true },
  ],
  shrine: [
    { model: 'Column', dx: -4, dz: -4, h: 3.8 }, { model: 'Column', dx: 4, dz: -4, h: 3.8 },
    { model: 'Column', dx: -4, dz: 4, h: 3.8 }, { model: 'Column', dx: 4, dz: 4, h: 2.6, toppled: true },
    { model: 'Statue', dx: 0, dz: 0, h: 3.6 },
  ],
  circle: [
    { model: 'Column', dx: 6, dz: 0, h: 4.2 }, { model: 'Column', dx: 3, dz: 5.2, h: 4.2 },
    { model: 'Column', dx: -3, dz: 5.2, h: 3, toppled: true }, { model: 'Column', dx: -6, dz: 0, h: 4.2 },
    { model: 'Column', dx: -3, dz: -5.2, h: 4.2 }, { model: 'Column', dx: 3, dz: -5.2, h: 4.2 },
  ],
  obelisk: [
    { model: 'Column', dx: 0, dz: 0, h: 9.5 },
    { model: 'Column', dx: 5, dz: 3, h: 3.4, toppled: true }, { model: 'Column', dx: -4, dz: -5, h: 3, toppled: true },
  ],
  statue: [
    { model: 'Statue', dx: 0, dz: 0, h: 4.2 },
    { model: 'Column', dx: 3.5, dz: 2, h: 2.8, toppled: true },
  ],
  watch: [
    { model: 'Column', dx: -3, dz: 0, h: 7.5 }, { model: 'Column', dx: 3, dz: 0, h: 7.5 },
    { model: 'Arch', dx: 0, dz: -5, h: 5.5, rotY: 0 }, { model: 'Column', dx: 0, dz: 6, h: 3, toppled: true },
  ],
  // THE BEACON's court (the brazier itself is beacon.ts): a ring of eight
  // 9 m columns, two guardians facing the Ravine's mouth to the south
  beacon: [
    { model: 'Column', dx: 16, dz: 0, h: 9 }, { model: 'Column', dx: 11.3, dz: 11.3, h: 9 },
    { model: 'Column', dx: 0, dz: 16, h: 6, toppled: true }, { model: 'Column', dx: -11.3, dz: 11.3, h: 9 },
    { model: 'Column', dx: -16, dz: 0, h: 9 }, { model: 'Column', dx: -11.3, dz: -11.3, h: 9 },
    { model: 'Column', dx: 0, dz: -16, h: 9 }, { model: 'Column', dx: 11.3, dz: -11.3, h: 9 },
    { model: 'Statue', dx: -6, dz: 24, h: 7, rotY: Math.PI }, { model: 'Statue', dx: 6, dz: 24, h: 7, rotY: Math.PI },
    { model: 'Arch', dx: 0, dz: 34, h: 11, rotY: 0 },
  ],
}

export class Ruins {
  readonly group = new THREE.Group()
  /** one holder per site: attached to the group only while the site is within
   *  RUIN_DRAW of the viewer (three walks every object in the graph every
   *  frame; the 23 sites' 367 nodes were all in it at all times — M24) */
  private sites: { x: number; z: number; holder: THREE.Group }[] = []
  private lastX = Infinity
  private lastZ = Infinity

  async build(physics: Physics): Promise<void> {
    const meta = worldMeta!
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const models = new Map<RuinModel, THREE.Group>()
    await Promise.all(
      (['Column', 'Arch', 'Statue'] as RuinModel[]).map(async (m) => {
        const root = (await loader.loadAsync(`models/props/${m}.glb`)).scene
        registerWarmRoot(root)
        models.set(m, root)
      }),
    )

    // THE TABLET (M68): a leaning slab at every ruin that teaches a recipe.
    // Built, not downloaded — it is a box with a chamfer, and the point of it
    // is the ENGRAVED FACE, which is a canvas texture rather than geometry so
    // each one can carry its own mark. Emissive so it catches the eye across
    // a glade the way the keystones do, but far dimmer: a keystone is a prize
    // and a tablet is a signpost.
    const tabletFor = (tag: string): THREE.Object3D | null => {
      const e = ENGRAMS.find((x) => x.site === tag)
      if (!e) return null
      const g = new THREE.Group()
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(1.15, 1.7, 0.22),
        new THREE.MeshStandardMaterial({ color: 0xd8c8a4, roughness: 0.85, metalness: 0 }),
      )
      // gain 2.4: makeStone MULTIPLIES by the rock albedo (~0.45), so a slab
      // left at its face value renders near-black beside the sand (M68)
      makeStone(slab.material as THREE.MeshStandardMaterial, { metresPerTile: 1.1, gain: 2.4 })
      slab.castShadow = true
      slab.receiveShadow = true
      g.add(slab)
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(0.92, 1.4),
        new THREE.MeshStandardMaterial({
          map: engravingTexture(e.recipe),
          transparent: true,
          roughness: 0.9,
          emissive: new THREE.Color(0x6fd0e0),
          emissiveIntensity: 0.22,
        }),
      )
      face.position.z = 0.115
      g.add(face)
      g.rotation.x = -0.13 // leaning back, as a slab set in the ground does
      return g
    }

    for (const site of meta.ruinSites) {
      const layout = LAYOUTS[site.tag] ?? (site.layout ? LAYOUTS_BY_KIND[site.layout] : undefined)
      if (!layout) continue
      const holder = new THREE.Group()
      holder.matrixAutoUpdate = false
      this.sites.push({ x: site.x, z: site.z, holder })
      const tablet = tabletFor(site.tag)
      if (tablet) {
        // 3.5 m south of the site's heart: clear of the columns, and the first
        // thing you face walking in from the open ground
        const tx = site.x, tz = site.z + 3.5
        tablet.position.set(tx, heightAt(tx, tz) + 0.72, tz)
        tablet.rotation.y = Math.sin(site.x * 0.7) * 0.5
        holder.add(tablet)
      }
      for (const plan of layout) {
        const src = models.get(plan.model)!
        const piece = src.clone(true)

        // normalize: world height = plan.h, feet at ground
        const box = new THREE.Box3().setFromObject(piece)
        const size = box.getSize(new THREE.Vector3())
        const s = plan.h / (size.y || 1)
        piece.scale.setScalar(s)

        const x = site.x + plan.dx
        const z = site.z + plan.dz
        const ground = heightAt(x, z)
        let rotY = plan.rotY ?? (Math.abs(Math.sin(x * 12.9 + z * 7.7)) * Math.PI * 2)
        if (site.tag === 'beach-statue' && plan.model === 'Statue') {
          rotY = Math.atan2(VOLCANO.x - x, VOLCANO.z - z) // the tutorial: it faces the volcano
        }
        piece.position.set(x, ground, z)
        piece.rotation.y = rotY
        if (plan.toppled) {
          piece.rotation.z = Math.PI / 2 - 0.08
          piece.position.y = ground + 0.35
        }
        // sink slightly + slight lean: ruins settle
        piece.position.y -= 0.15
        if (!plan.toppled) piece.rotation.x = Math.sin(x * 3.1) * 0.04

        piece.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true
            o.receiveShadow = true
            const mat = o.material as THREE.MeshStandardMaterial
            if (mat) {
              o.material = mat.clone()
              const m = o.material as THREE.MeshStandardMaterial
              m.roughness = 1
              m.metalness = 0
              // the Quaternius ruin pieces ship near-white and flat: under the
              // island's sun any flat grey goes to plaster. World-space stone
              // texture (stone-material.ts), tinted warm limestone (M27)
              m.color.setRGB(0.55, 0.52, 0.46)
              makeStone(m, { metresPerTile: 1.6 })
            }
          }
        })
        holder.add(piece)

        // physics: standing columns/statues get cylinders; arch spans and
        // toppled pieces stay walkable
        if (!plan.toppled && (plan.model === 'Column' || plan.model === 'Statue')) {
          const r = Math.max(0.35, size.x * s * 0.3)
          physics.world.createCollider(
            RAPIER.ColliderDesc.cylinder(plan.h / 2, r).setTranslation(x, ground + plan.h / 2, z),
          )
          // ...and tell the ANIMALS, which do not use physics at all — they
          // steer around obstacles.ts, whose own comment has said "tree
          // trunks, rocks, ruin columns" since M25 while ruins never actually
          // registered. Dinos walked through every column on the island (M65,
          // the same hole as the player's fences).
          addObstacle(x, z, r + 0.3)
        }
      }
    }
    this.update(0, 0, true)
  }

  /** attach the sites within reach of the viewer, detach the rest (on a 40 m move) */
  update(x: number, z: number, force = false): void {
    if (!force && Math.hypot(x - this.lastX, z - this.lastZ) < 40) return
    this.lastX = x
    this.lastZ = z
    for (const s of this.sites) {
      const near = Math.hypot(s.x - x, s.z - z) < RUIN_DRAW
      if (near) { if (!s.holder.parent) this.group.add(s.holder) }
      else if (s.holder.parent) this.group.remove(s.holder)
    }
  }

  /** warm-up: attach everything once */
  showAll(): () => void {
    const was = this.sites.filter((s) => !s.holder.parent)
    for (const s of was) this.group.add(s.holder)
    return () => { for (const s of was) this.group.remove(s.holder) }
  }
}

/** ruins draw within this of the viewer (the fog ends at 1500; a 15 m arch at 900 m is a pixel) */
const RUIN_DRAW = 900


/**
 * The mark on a tablet: the recipe's own icon, cut into the stone. Drawn to a
 * canvas rather than modelled — an engraving is a picture, and this way each
 * of the seven reads differently at a glance without seven new meshes.
 */
const engravings = new Map<string, THREE.CanvasTexture>()
function engravingTexture(recipe: string): THREE.CanvasTexture {
  const had = engravings.get(recipe)
  if (had) return had
  const S = 256
  const c = document.createElement('canvas')
  c.width = S; c.height = Math.round(S * 1.5)
  const g = c.getContext('2d')!
  g.clearRect(0, 0, c.width, c.height)
  // a chiselled border
  g.strokeStyle = 'rgba(40, 32, 22, 0.55)'
  g.lineWidth = 6
  g.strokeRect(16, 16, c.width - 32, c.height - 32)
  // the icon, big, in cut-shadow and highlight so it reads as carved
  const icon = (ITEMS as Record<string, { icon: string }>)[recipe]?.icon ?? '◆'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `${Math.round(S * 0.62)}px system-ui, "Apple Color Emoji", sans-serif`
  // the shadow of the cut, offset down-right
  g.globalAlpha = 0.3
  g.fillStyle = '#120d05'
  g.fillText(icon, c.width / 2, c.height * 0.42 + 5)
  g.globalAlpha = 1
  g.fillText(icon, c.width / 2, c.height * 0.42)
  // FLATTEN IT TO STONE. The item icons are colour emoji, and left as they
  // come they read as a sticker slapped on a rock rather than something cut
  // into it. Painting over the glyph's own alpha keeps its shape and throws
  // away its colour (M68).
  g.globalCompositeOperation = 'source-atop'
  g.globalAlpha = 0.82
  g.fillStyle = '#3a2f1d'
  g.fillRect(0, 0, c.width, c.height)
  g.globalCompositeOperation = 'source-over'
  // three rules beneath: the "writing" nobody has to read
  g.globalAlpha = 0.4
  g.strokeStyle = '#2a2115'
  g.lineWidth = 5
  for (let i = 0; i < 3; i++) {
    const y = c.height * 0.74 + i * 26
    const w = c.width * (0.5 - i * 0.08)
    g.beginPath(); g.moveTo((c.width - w) / 2, y); g.lineTo((c.width + w) / 2, y); g.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  engravings.set(recipe, tex)
  return tex
}

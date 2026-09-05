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
import type { Physics } from './physics'

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
    { model: 'Arch', dx: 0, dz: -19, h: 15, rotY: 0 }, // set against the rock face behind the apron
    { model: 'Column', dx: -12, dz: -14, h: 9 },
    { model: 'Column', dx: 12, dz: -14, h: 9 },
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
}

export class Ruins {
  readonly group = new THREE.Group()

  async build(physics: Physics): Promise<void> {
    const meta = worldMeta!
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const models = new Map<RuinModel, THREE.Group>()
    await Promise.all(
      (['Column', 'Arch', 'Statue'] as RuinModel[]).map(async (m) => {
        models.set(m, (await loader.loadAsync(`models/props/${m}.glb`)).scene)
      }),
    )

    for (const site of meta.ruinSites) {
      const layout = LAYOUTS[site.tag] ?? (site.layout ? LAYOUTS_BY_KIND[site.layout] : undefined)
      if (!layout) continue
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
              ;(o.material as THREE.MeshStandardMaterial).roughness = 1
              ;(o.material as THREE.MeshStandardMaterial).metalness = 0
            }
          }
        })
        this.group.add(piece)

        // physics: standing columns/statues get cylinders; arch spans and
        // toppled pieces stay walkable
        if (!plan.toppled && (plan.model === 'Column' || plan.model === 'Statue')) {
          physics.world.createCollider(
            RAPIER.ColliderDesc.cylinder(plan.h / 2, Math.max(0.35, size.x * s * 0.3)).setTranslation(x, ground + plan.h / 2, z),
          )
        }
      }
    }
  }
}

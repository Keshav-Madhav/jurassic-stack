// The world border: the island sits in a 4 km canvas and the sea runs to its
// edge. Four invisible walls stop anyone (a swimmer, a flier) at 1.96 km from
// the centre, and a faint veil — a hex-grid shimmer — fades in over the last
// 120 m so the edge reads as a barrier, not a bug (ARK's map-edge walls).
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type { Physics } from './physics'

export const BORDER = 1960
const VEIL_HEIGHT = 700
const VEIL_FADE = 120

function hexTexture(): THREE.CanvasTexture {
  const S = 256
  const c = document.createElement('canvas')
  c.width = S; c.height = S
  const g = c.getContext('2d')!
  g.clearRect(0, 0, S, S)
  g.strokeStyle = 'rgba(140, 200, 255, 0.9)'
  g.lineWidth = 3
  const r = 30
  const w = Math.sqrt(3) * r
  for (let row = -1; row < S / (1.5 * r) + 2; row++) {
    for (let col = -1; col < S / w + 2; col++) {
      const cx = col * w + (row % 2 ? w / 2 : 0)
      const cy = row * 1.5 * r
      g.beginPath()
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r
        k ? g.lineTo(px, py) : g.moveTo(px, py)
      }
      g.closePath()
      g.stroke()
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

export class WorldBorder {
  readonly group = new THREE.Group()
  private veils: THREE.Mesh[] = []
  private mat: THREE.MeshBasicMaterial
  private t = 0

  constructor(physics: Physics) {
    // the walls: thick, tall, just outside the veil
    for (const [x, z, sx, sz] of [[BORDER + 2, 0, 2, BORDER + 40], [-BORDER - 2, 0, 2, BORDER + 40], [0, BORDER + 2, BORDER + 40, 2], [0, -BORDER - 2, BORDER + 40, 2]]) {
      physics.world.createCollider(RAPIER.ColliderDesc.cuboid(sx, VEIL_HEIGHT, sz).setTranslation(x, 0, z))
    }
    this.mat = new THREE.MeshBasicMaterial({ map: hexTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending })
    this.mat.map!.repeat.set(BORDER * 2 / 60, VEIL_HEIGHT / 60)
    const geo = new THREE.PlaneGeometry(BORDER * 2, VEIL_HEIGHT)
    for (const [x, z, rotY] of [[BORDER, 0, -Math.PI / 2], [-BORDER, 0, Math.PI / 2], [0, BORDER, Math.PI], [0, -BORDER, 0]]) {
      const m = new THREE.Mesh(geo, this.mat)
      m.position.set(x, VEIL_HEIGHT / 2 - 60, z)
      m.rotation.y = rotY
      m.frustumCulled = false
      m.visible = false
      m.renderOrder = 8
      this.veils.push(m)
      this.group.add(m)
    }
  }

  /** the veil shows only near the edge; returns the position clamped inside (for the flier) */
  update(dt: number, pos: THREE.Vector3): void {
    this.t += dt
    const edge = Math.max(Math.abs(pos.x), Math.abs(pos.z))
    const near = THREE.MathUtils.clamp((edge - (BORDER - VEIL_FADE)) / VEIL_FADE, 0, 1)
    const show = near > 0.01
    for (const v of this.veils) v.visible = show
    if (!show) return
    this.mat.opacity = near * (0.32 + 0.08 * Math.sin(this.t * 2.2))
    this.mat.map!.offset.set(this.t * 0.01, this.t * 0.006)
  }

  static clamp(pos: THREE.Vector3): boolean {
    const lim = BORDER - 1
    const cx = THREE.MathUtils.clamp(pos.x, -lim, lim)
    const cz = THREE.MathUtils.clamp(pos.z, -lim, lim)
    if (cx === pos.x && cz === pos.z) return false
    pos.x = cx
    pos.z = cz
    return true
  }
}

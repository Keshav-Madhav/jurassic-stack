// Hit feedback: a spray of blood at every landed blow, and a burst of CHIPS
// when you strike wood or stone (M48b) — the debris pool below is the same
// machinery as the blood, tinted per material and thrown flatter, because a
// chip flies off a trunk sideways where blood sprays up.
//
// Original note: a spray of blood at every landed blow — the player's swing on
// a dino, a dino's bite on the player or on its prey. A small pool of Points
// bursts (dark red, gravity, 0.7 s), plus a few drops that stay on the ground
// as flat dark decals for half a minute. Cheap, and the difference between
// "did that connect?" and a fight you can read (user, M19).
import * as THREE from 'three'
import { heightAt } from './heightmap'

const BURSTS = 12
const PER_BURST = 26
const LIFE = 0.7
const DECALS = 40
/** chips: their own pool, so a felling blow cannot starve the blood */
const CHIP_BURSTS = 8
const PER_CHIP = 14
const CHIP_LIFE = 0.9

/** what each material throws off, and what colour it is */
export const CHIP_LOOK = {
  wood: { color: 0x7a5326, size: 0.14 },
  stone: { color: 0x8d8880, size: 0.12 },
  leaf: { color: 0x3f6a24, size: 0.16 },
  // footstep dust: the ground's own colour is set per burst, so this is only
  // the fallback and the size (M49)
  dust: { color: 0x9a8054, size: 0.1 },
} as const
export type ChipKind = keyof typeof CHIP_LOOK

interface Burst { points: THREE.Points; vel: Float32Array; t: number; alive: boolean }

function dropTexture(): THREE.CanvasTexture {
  const S = 32
  const c = document.createElement('canvas')
  c.width = S; c.height = S
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.6, 'rgba(255,255,255,0.9)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, S, S)
  return new THREE.CanvasTexture(c)
}

export class HitFx {
  readonly group = new THREE.Group()
  private bursts: Burst[] = []
  private decals: THREE.Mesh[] = []
  private decalNext = 0
  // a soft round drop sprite — an untextured point is a hard square, and a
  // burst right in front of the camera read as big red blocks over the far bank
  private mat = new THREE.PointsMaterial({ color: 0x8c1016, size: 0.16, map: dropTexture(), alphaTest: 0.2, transparent: true, opacity: 1, depthWrite: false, sizeAttenuation: true })
  private decalMat = new THREE.MeshBasicMaterial({ color: 0x4a0a0c, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })

  private chips: (Burst & { kind: ChipKind })[] = []

  constructor() {
    for (let i = 0; i < CHIP_BURSTS; i++) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PER_CHIP * 3), 3))
      // a soft round sprite — an untextured point is a hard SQUARE, which is
      // fine at splinter size and looked like flying cardboard boxes the
      // moment footstep dust made them big (M49, and the same lesson the blood
      // learned in M19)
      const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x7a5326, size: 0.14, map: dropTexture(), alphaTest: 0.12, transparent: true, opacity: 1, depthWrite: false, sizeAttenuation: true }))
      points.visible = false
      points.frustumCulled = false
      this.group.add(points)
      this.chips.push({ points, vel: new Float32Array(PER_CHIP * 3), t: 0, alive: false, kind: 'wood' })
    }
    for (let i = 0; i < BURSTS; i++) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PER_BURST * 3), 3))
      const points = new THREE.Points(geo, this.mat.clone())
      points.visible = false
      points.frustumCulled = false
      this.group.add(points)
      this.bursts.push({ points, vel: new Float32Array(PER_BURST * 3), t: 0, alive: false })
    }
    const disc = new THREE.CircleGeometry(0.5, 10).rotateX(-Math.PI / 2)
    for (let i = 0; i < DECALS; i++) {
      const m = new THREE.Mesh(disc, this.decalMat)
      m.visible = false
      m.renderOrder = 1
      this.group.add(m)
      this.decals.push(m)
    }
  }

  /** @param heavy a big bite: more, faster, wider */
  burst(x: number, y: number, z: number, heavy = false): void {
    let b = this.bursts.find((q) => !q.alive)
    if (!b) { b = this.bursts.reduce((p, q) => (q.t > p.t ? q : p)) }
    const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const n = heavy ? PER_BURST : Math.round(PER_BURST * 0.6)
    for (let i = 0; i < PER_BURST; i++) {
      const on = i < n
      arr[i * 3] = x; arr[i * 3 + 1] = on ? y : -999; arr[i * 3 + 2] = z
      const a = Math.random() * Math.PI * 2
      const up = 1.5 + Math.random() * (heavy ? 4 : 2.5)
      const out = (0.8 + Math.random() * 2.2) * (heavy ? 1.6 : 1)
      b.vel[i * 3] = Math.cos(a) * out
      b.vel[i * 3 + 1] = up
      b.vel[i * 3 + 2] = Math.sin(a) * out
    }
    pos.needsUpdate = true
    ;(b.points.material as THREE.PointsMaterial).opacity = 1
    ;(b.points.material as THREE.PointsMaterial).size = heavy ? 0.24 : 0.16
    b.points.visible = true
    b.t = 0
    b.alive = true
    // a couple of drops on the ground
    for (let k = 0; k < (heavy ? 3 : 1); k++) {
      const d = this.decals[this.decalNext++ % DECALS]
      const dx = x + (Math.random() - 0.5) * 1.6, dz = z + (Math.random() - 0.5) * 1.6
      d.position.set(dx, heightAt(dx, dz) + 0.03, dz)
      d.scale.setScalar(0.3 + Math.random() * (heavy ? 0.5 : 0.3)) // (the first pools were 4 m across under a carno)
      d.rotation.y = Math.random() * Math.PI
      d.visible = true
      d.userData.t = 0
    }
  }

  /** A small puff at a footfall — the chip pool again, slower and sparser, in
   *  whatever colour the ground under the foot is painted (M49). */
  dust(x: number, y: number, z: number, color: number, strong = false): void {
    let b = this.chips.find((q) => !q.alive)
    if (!b) return // never steal a live chip burst for a footstep
    const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const n = strong ? 10 : 6
    for (let i = 0; i < PER_CHIP; i++) {
      const on = i < n
      arr[i * 3] = x + (Math.random() - 0.5) * 0.3
      arr[i * 3 + 1] = on ? y : -999
      arr[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3
      const a = Math.random() * Math.PI * 2
      const out = 0.4 + Math.random() * (strong ? 1.3 : 0.7)
      b.vel[i * 3] = Math.cos(a) * out
      b.vel[i * 3 + 1] = 0.7 + Math.random() * (strong ? 1.4 : 0.8)
      b.vel[i * 3 + 2] = Math.sin(a) * out
    }
    pos.needsUpdate = true
    const mat = b.points.material as THREE.PointsMaterial
    mat.color.setHex(color)
    // bigger and brighter than the first cut: at 0.1 m and a third opacity it
    // was invisible against the sand it came off (M49)
    mat.size = strong ? 0.3 : 0.22
    mat.opacity = strong ? 0.85 : 0.6
    b.points.visible = true
    b.t = 0
    b.alive = true
  }

  /** A burst of chips off whatever was struck. `dirX/dirZ` is the direction
   *  the blow came FROM, so the debris flies back at the swinger — which is
   *  what makes it read as coming off the trunk rather than out of the ground.
   *  @param heavy a felling blow: twice the chips, thrown harder */
  chip(kind: ChipKind, x: number, y: number, z: number, dirX = 0, dirZ = 0, heavy = false, color?: number): void {
    let b = this.chips.find((q) => !q.alive)
    if (!b) b = this.chips.reduce((p, q) => (q.t > p.t ? q : p))
    b.kind = kind
    const look = CHIP_LOOK[kind]
    const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const n = heavy ? PER_CHIP : Math.round(PER_CHIP * 0.65)
    const len = Math.hypot(dirX, dirZ) || 1
    const bx = dirX / len, bz = dirZ / len
    for (let i = 0; i < PER_CHIP; i++) {
      const on = i < n
      arr[i * 3] = x; arr[i * 3 + 1] = on ? y : -999; arr[i * 3 + 2] = z
      // a cone back along the blow, flatter than blood and a little upward
      const spread = 0.9
      const a = (Math.random() - 0.5) * spread
      const ca = Math.cos(a), sa = Math.sin(a)
      const ox = bx * ca - bz * sa, oz = bx * sa + bz * ca
      const speed = (2.2 + Math.random() * 3.4) * (heavy ? 1.5 : 1)
      b.vel[i * 3] = ox * speed
      b.vel[i * 3 + 1] = 1.2 + Math.random() * (heavy ? 3.4 : 2.2)
      b.vel[i * 3 + 2] = oz * speed
    }
    pos.needsUpdate = true
    const mat = b.points.material as THREE.PointsMaterial
    mat.color.setHex(color ?? look.color)
    mat.size = look.size * (heavy ? 1.35 : 1)
    mat.opacity = 1
    b.points.visible = true
    b.t = 0
    b.alive = true
  }

  update(dt: number): void {
    for (const b of this.chips) {
      if (!b.alive) continue
      b.t += dt
      if (b.t > CHIP_LIFE) { b.alive = false; b.points.visible = false; continue }
      const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = pos.array as Float32Array
      const dusty = b.kind === 'dust'
      for (let i = 0; i < PER_CHIP; i++) {
        if (arr[i * 3 + 1] < -900) continue
        // dust hangs and drifts; a chip falls like a chip
        b.vel[i * 3 + 1] -= (dusty ? 1.4 : 16) * dt
        if (dusty) { b.vel[i * 3] *= 1 - dt * 1.6; b.vel[i * 3 + 2] *= 1 - dt * 1.6 }
        arr[i * 3] += b.vel[i * 3] * dt
        arr[i * 3 + 1] += b.vel[i * 3 + 1] * dt
        arr[i * 3 + 2] += b.vel[i * 3 + 2] * dt
        const gy = heightAt(arr[i * 3], arr[i * 3 + 2]) + 0.04
        if (arr[i * 3 + 1] < gy) {
          // chips bounce once, then lie there — stone especially
          if (b.vel[i * 3 + 1] < -2.2) {
            arr[i * 3 + 1] = gy
            b.vel[i * 3 + 1] *= -0.28
            b.vel[i * 3] *= 0.5
            b.vel[i * 3 + 2] *= 0.5
          } else {
            arr[i * 3 + 1] = gy
            b.vel[i * 3] = 0; b.vel[i * 3 + 1] = 0; b.vel[i * 3 + 2] = 0
          }
        }
      }
      pos.needsUpdate = true
      ;(b.points.material as THREE.PointsMaterial).opacity = 1 - Math.pow(b.t / CHIP_LIFE, 3)
    }
    for (const b of this.bursts) {
      if (!b.alive) continue
      b.t += dt
      if (b.t > LIFE) { b.alive = false; b.points.visible = false; continue }
      const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = pos.array as Float32Array
      for (let i = 0; i < PER_BURST; i++) {
        if (arr[i * 3 + 1] < -900) continue
        b.vel[i * 3 + 1] -= 14 * dt
        arr[i * 3] += b.vel[i * 3] * dt
        arr[i * 3 + 1] += b.vel[i * 3 + 1] * dt
        arr[i * 3 + 2] += b.vel[i * 3 + 2] * dt
        // drops land: stop on the ground instead of hanging in the grass or sinking
        const gy = heightAt(arr[i * 3], arr[i * 3 + 2]) + 0.05
        if (arr[i * 3 + 1] < gy) { arr[i * 3 + 1] = gy; b.vel[i * 3] = 0; b.vel[i * 3 + 1] = 0; b.vel[i * 3 + 2] = 0 }
      }
      pos.needsUpdate = true
      ;(b.points.material as THREE.PointsMaterial).opacity = 1 - Math.pow(b.t / LIFE, 2)
    }
    for (const d of this.decals) {
      if (!d.visible) continue
      d.userData.t = (d.userData.t as number) + dt
      if (d.userData.t > 40) d.visible = false
    }
  }
}

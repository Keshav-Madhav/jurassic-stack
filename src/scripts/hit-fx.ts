// Hit feedback: a spray of blood at every landed blow — the player's swing on
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

  constructor() {
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
      d.scale.setScalar(0.5 + Math.random() * (heavy ? 1.2 : 0.6))
      d.rotation.y = Math.random() * Math.PI
      d.visible = true
      d.userData.t = 0
    }
  }

  update(dt: number): void {
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

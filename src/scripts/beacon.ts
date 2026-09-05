// The Beacon: the arc's last room. A basalt plinth and brazier on the crater
// bench at the top of the Ravine, cold until the player who carried all five
// keystones through the caldera door lights it — then a column of fire,
// embers, and a light the whole crater reads by. Procedural (no asset), like
// the keystones: the fire is three billboarded flame cards + a point light,
// the embers a Points cloud that rises and wraps.
import * as THREE from 'three'

const EMBERS = 160

function flameTexture(): THREE.CanvasTexture {
  const S = 128
  const c = document.createElement('canvas')
  c.width = S; c.height = S * 2
  const g = c.getContext('2d')!
  // a teardrop: white-hot core at the base, orange body, fading to nothing at
  // the tip — a radial gradient squeezed to 42% width so the card's edges are
  // truly clear (the first cut painted a visible orange rectangle)
  g.translate(S / 2, 0)
  g.scale(0.42, 1)
  g.translate(-S / 2, 0)
  const grad = g.createRadialGradient(S / 2, S * 1.45, 4, S / 2, S * 1.1, S * 0.95)
  grad.addColorStop(0, 'rgba(255,245,200,1)')
  grad.addColorStop(0.25, 'rgba(255,170,60,0.95)')
  grad.addColorStop(0.55, 'rgba(240,80,20,0.55)')
  grad.addColorStop(1, 'rgba(120,20,0,0)')
  g.fillStyle = grad
  g.fillRect(-S, 0, S * 3, S * 2)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class Beacon {
  readonly group = new THREE.Group()
  /** the brazier bowl's rim height above the site ground (the fire's base) */
  readonly bowlY: number
  lit = false
  private heat = 0 // 0 cold → 1 burning (ramps over ~3 s when lit)
  private flames: THREE.Mesh[] = []
  private flameMat: THREE.MeshBasicMaterial
  private embers: THREE.Points
  private emberVel: Float32Array
  private glow: THREE.PointLight
  private bowlMat: THREE.MeshStandardMaterial
  private t = 0

  constructor(readonly x: number, readonly groundY: number, readonly z: number) {
    const basalt = new THREE.MeshStandardMaterial({ color: 0x2c2826, roughness: 0.96 })
    // a stepped plinth, three tiers
    let y = groundY
    for (const [r, h] of [[7.2, 1.0], [5.4, 0.9], [3.8, 0.8]] as const) {
      const tier = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.3, h, 24), basalt)
      tier.position.set(x, y + h / 2, z)
      tier.castShadow = true
      tier.receiveShadow = true
      this.group.add(tier)
      y += h
    }
    // the brazier: a tapered stem and a wide bowl, the bowl warm-emissive once lit
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.5, 5.2, 16), basalt)
    stem.position.set(x, y + 2.6, z)
    stem.castShadow = true
    this.group.add(stem)
    y += 5.2
    this.bowlMat = new THREE.MeshStandardMaterial({ color: 0x3a322c, roughness: 0.85, emissive: 0xff6a20, emissiveIntensity: 0 })
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 1.5, 1.5, 20, 1, true), this.bowlMat)
    bowl.position.set(x, y + 0.75, z)
    bowl.castShadow = true
    this.group.add(bowl)
    const bowlFloor = new THREE.Mesh(new THREE.CircleGeometry(1.5, 20).rotateX(-Math.PI / 2), this.bowlMat)
    bowlFloor.position.set(x, y + 0.05, z)
    this.group.add(bowlFloor)
    this.bowlY = y + 1.2 - groundY

    // the fire: three cards, additive, each swaying on its own phase
    this.flameMat = new THREE.MeshBasicMaterial({ map: flameTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, side: THREE.DoubleSide, fog: false })
    for (let i = 0; i < 3; i++) {
      const card = new THREE.Mesh(new THREE.PlaneGeometry(6, 12), this.flameMat)
      card.position.set(x, groundY + this.bowlY + 5.4, z)
      card.rotation.y = (i * Math.PI) / 3
      card.visible = false
      card.frustumCulled = false
      this.flames.push(card)
      this.group.add(card)
    }
    // embers
    const pos = new Float32Array(EMBERS * 3)
    this.emberVel = new Float32Array(EMBERS)
    for (let i = 0; i < EMBERS; i++) this.resetEmber(pos, i, true)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.embers = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffa040, size: 0.22, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false }))
    this.embers.visible = false
    this.embers.frustumCulled = false
    this.group.add(this.embers)
    // the light: candela-scale (the renderer is physically-correct), 90 m reach
    this.glow = new THREE.PointLight(0xff8a3c, 0, 110, 2)
    this.glow.position.set(x, groundY + this.bowlY + 3, z)
    this.group.add(this.glow)
  }

  private resetEmber(pos: Float32Array, i: number, scatter: boolean): void {
    const a = Math.random() * Math.PI * 2
    const r = Math.random() * 1.4
    pos[i * 3] = this.x + Math.cos(a) * r
    pos[i * 3 + 1] = this.groundY + this.bowlY + (scatter ? Math.random() * 14 : 0)
    pos[i * 3 + 2] = this.z + Math.sin(a) * r
    this.emberVel[i] = 1.6 + Math.random() * 2.4
  }

  /** Light it. `instant` skips the ramp (restoring a save). */
  light(instant = false): void {
    this.lit = true
    if (instant) this.heat = 1
    for (const f of this.flames) f.visible = true
    this.embers.visible = true
  }

  update(dt: number, cam: THREE.Vector3): void {
    if (!this.lit) return
    this.t += dt
    this.heat = Math.min(1, this.heat + dt / 3)
    const flick = 0.85 + 0.15 * Math.sin(this.t * 17.3) * Math.sin(this.t * 7.1 + 1)
    // cards face the viewer (yaw only) and breathe
    const yaw = Math.atan2(cam.x - this.x, cam.z - this.z)
    this.flames.forEach((f, i) => {
      f.rotation.y = yaw + ((i - 1) * Math.PI) / 5
      const s = this.heat * (0.9 + 0.12 * Math.sin(this.t * 9 + i * 2.1))
      f.scale.set(s * (1 + 0.08 * Math.sin(this.t * 13 + i)), s, 1)
      f.position.y = this.groundY + this.bowlY + 5.4 * s
    })
    this.flameMat.opacity = this.heat * (0.8 + 0.2 * flick)
    this.glow.intensity = 260 * this.heat * flick
    this.bowlMat.emissiveIntensity = 1.6 * this.heat * flick
    // embers rise, drift, and wrap back into the bowl
    const pos = this.embers.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let i = 0; i < EMBERS; i++) {
      arr[i * 3 + 1] += this.emberVel[i] * dt
      arr[i * 3] += Math.sin(this.t * 2 + i) * 0.6 * dt
      arr[i * 3 + 2] += Math.cos(this.t * 1.7 + i * 0.7) * 0.6 * dt
      if (arr[i * 3 + 1] > this.groundY + this.bowlY + 14 + (i % 5)) this.resetEmber(arr, i, false)
    }
    pos.needsUpdate = true
    ;(this.embers.material as THREE.PointsMaterial).opacity = this.heat * 0.9
  }
}

// The arc's thread, made collectible: a glowing keystone at twelve of the
// ruin sites (the five arc sites and seven of the lost city's minor ruins —
// one per region). Eight open the caldera gate, so no single lost ruin can
// block the arc. The Wayfinder (N key) points to the nearest missing stone —
// diegetic guidance, zero quest UI.
//
// Picking one up is a moment (user, M20): the stone flares, a ring of light
// leaves it, sparks rise, and it flies to your chest as a chime climbs.
import * as THREE from 'three'
import { heightAt, worldMeta } from './heightmap'

export interface KeystoneSite {
  tag: string
  x: number
  y: number
  z: number
  collected: boolean
  mesh: THREE.Mesh
}

/** how many of the stones the caldera gate wants */
export const KEYSTONES_NEEDED = 8

const SPARKS = 48

function softDot(): THREE.CanvasTexture {
  const S = 32
  const c = document.createElement('canvas')
  c.width = S; c.height = S
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.4, 'rgba(255,255,255,0.8)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, S, S)
  return new THREE.CanvasTexture(c)
}

interface Pickup {
  site: KeystoneSite
  t: number
  from: THREE.Vector3
  ring: THREE.Mesh
  sparks: THREE.Points
  vel: Float32Array
}

export class Keystones {
  readonly group = new THREE.Group()
  readonly sites: KeystoneSite[] = []
  private t = 0
  private pickups: Pickup[] = []
  /** ONE halo light for all the stones, parked at the nearest uncollected one:
   *  three.js evaluates every point light in every fragment (no light culling),
   *  and twelve halos across the island cost every pixel on screen — the fly
   *  run dropped to 33 hitches when the count went 5 → 12 (M20) */
  private halo = new THREE.PointLight(0x54c8f0, 40, 14)
  private ringGeo = new THREE.RingGeometry(0.9, 1.0, 48) // thin: the band scales with the ring
  private ringMat = new THREE.MeshBasicMaterial({ color: 0x9df0ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  private sparkMat = new THREE.PointsMaterial({ color: 0xbff4ff, size: 0.14, map: softDot(), alphaTest: 0.05, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false })
  /** main.ts hooks the chime here */
  onCollect: ((site: KeystoneSite) => void) | null = null

  build(): void {
    const meta = worldMeta!
    const geo = new THREE.IcosahedronGeometry(0.55, 0)
    for (const site of meta.ruinSites) {
      if (site.tag === 'caldera-gate' || !site.keystone) continue
      const mat = new THREE.MeshStandardMaterial({
        color: 0x76e8ff,
        emissive: 0x2fa8d8,
        emissiveIntensity: 1.6,
        roughness: 0.25,
      })
      const mesh = new THREE.Mesh(geo, mat)
      const y = heightAt(site.x, site.z) + 1.5
      mesh.position.set(site.x, y, site.z)
      mesh.castShadow = true
      this.group.add(mesh)
      this.sites.push({ tag: site.tag, x: site.x, y, z: site.z, collected: false, mesh })
    }
    this.group.add(this.halo)
  }

  get collectedCount(): number {
    return this.sites.filter((s) => s.collected).length
  }

  get total(): number {
    return this.sites.length
  }

  /** the gate's requirement (never more than exist) */
  get needed(): number {
    return Math.min(KEYSTONES_NEEDED, this.sites.length)
  }

  get enough(): boolean {
    return this.collectedCount >= this.needed
  }

  /** Nearest uncollected keystone site, or null when all are held. */
  nearestMissing(x: number, z: number): KeystoneSite | null {
    let best: KeystoneSite | null = null
    let bd = Infinity
    for (const s of this.sites) {
      if (s.collected) continue
      const d = Math.hypot(s.x - x, s.z - z)
      if (d < bd) {
        bd = d
        best = s
      }
    }
    return best
  }

  /** Try to collect within reach of (x, z). Returns the site or null. */
  collectNear(x: number, z: number, reach = 4, chestY?: number): KeystoneSite | null {
    for (const s of this.sites) {
      if (s.collected) continue
      if (Math.hypot(s.x - x, s.z - z) <= reach) {
        s.collected = true
        this.startPickup(s, new THREE.Vector3(x, chestY ?? s.y, z))
        this.onCollect?.(s)
        return s
      }
    }
    return null
  }

  private startPickup(s: KeystoneSite, chest: THREE.Vector3): void {
    // the stone stays visible for the flight; the halo flares then dies.
    // NEVER halo.visible = false: removing a light from the render list
    // changes the scene light count and forces EVERY material to recompile —
    // a 5-10 s freeze on pickup (user-hit). Intensity carries the whole effect.
    this.halo.position.copy(s.mesh.position)
    this.halo.intensity = 220
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat.clone())
    ring.position.copy(s.mesh.position)
    ring.rotation.x = -Math.PI / 2
    this.group.add(ring)
    const pos = new Float32Array(SPARKS * 3)
    const vel = new Float32Array(SPARKS * 3)
    for (let i = 0; i < SPARKS; i++) {
      pos[i * 3] = s.mesh.position.x; pos[i * 3 + 1] = s.mesh.position.y; pos[i * 3 + 2] = s.mesh.position.z
      const a = Math.random() * Math.PI * 2
      const r = 0.6 + Math.random() * 2.2
      vel[i * 3] = Math.cos(a) * r; vel[i * 3 + 1] = 2.5 + Math.random() * 3.5; vel[i * 3 + 2] = Math.sin(a) * r
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const sparks = new THREE.Points(geo, this.sparkMat.clone())
    sparks.frustumCulled = false
    this.group.add(sparks)
    this.pickups.push({ site: s, t: 0, from: s.mesh.position.clone(), ring, sparks, vel })
    void chest
  }

  /** Bob + spin the uncollected stones; play the pickups. `chest` is where a flying stone goes. */
  update(dt: number, chest?: THREE.Vector3): void {
    this.t += dt
    for (const s of this.sites) {
      if (s.collected) continue
      s.mesh.rotation.y += dt * 1.2
      s.mesh.position.y = s.y + Math.sin(this.t * 1.6 + s.x) * 0.25
    }
    // the halo sits on the nearest uncollected stone (when no pickup is playing)
    if (!this.pickups.length && chest) {
      const near = this.nearestMissing(chest.x, chest.z)
      if (near) {
        this.halo.position.copy(near.mesh.position)
        this.halo.intensity = 40
      } else this.halo.intensity = 0
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]
      p.t += dt
      const T = 1.5
      const k = Math.min(1, p.t / T)
      // the stone: spins up, lifts, then darts to the chest and shrinks away
      const m = p.site.mesh
      m.rotation.y += dt * (4 + 20 * k)
      const arc = Math.sin(k * Math.PI) * 1.2
      if (chest) m.position.lerpVectors(p.from, chest, THREE.MathUtils.smoothstep(k, 0.25, 0.95))
      m.position.y += arc
      m.scale.setScalar(Math.max(0.01, 1 + 0.6 * Math.sin(k * Math.PI) - THREE.MathUtils.smoothstep(k, 0.8, 1)))
      // the ring: expands and fades
      const rs = 1 + THREE.MathUtils.smoothstep(k, 0, 0.8) * 9
      p.ring.scale.set(rs, rs, rs)
      ;(p.ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k)
      // sparks: rise, slow, fade
      const pos = p.sparks.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = pos.array as Float32Array
      for (let j = 0; j < SPARKS; j++) {
        p.vel[j * 3 + 1] -= 2.5 * dt
        arr[j * 3] += p.vel[j * 3] * dt
        arr[j * 3 + 1] += p.vel[j * 3 + 1] * dt
        arr[j * 3 + 2] += p.vel[j * 3 + 2] * dt
      }
      pos.needsUpdate = true
      ;(p.sparks.material as THREE.PointsMaterial).opacity = 1 - k * k
      // the halo: a flare, then gone
      this.halo.position.copy(m.position)
      this.halo.intensity = 220 * (1 - k)
      if (k >= 1) {
        m.visible = false
        m.scale.setScalar(1)
        this.halo.intensity = 0
        this.group.remove(p.ring, p.sparks)
        ;(p.ring.material as THREE.Material).dispose()
        ;(p.sparks.material as THREE.Material).dispose()
        p.sparks.geometry.dispose()
        this.pickups.splice(i, 1)
      }
    }
  }

  serialize(): string[] {
    return this.sites.filter((s) => s.collected).map((s) => s.tag)
  }

  restore(tags: string[]): void {
    for (const s of this.sites) {
      if (tags.includes(s.tag)) {
        s.collected = true
        s.mesh.visible = false
      }
    }
  }
}

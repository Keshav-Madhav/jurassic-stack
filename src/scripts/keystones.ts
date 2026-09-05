// The arc's thread, made collectible: one glowing keystone at each of the
// five pre-caldera ruin sites. Gather all five and the caldera gate opens
// (the door itself is M8's next chunk). The Wayfinder (N key) points to the
// nearest missing keystone — diegetic guidance, zero quest UI.
import * as THREE from 'three'
import { heightAt, worldMeta } from './heightmap'

export interface KeystoneSite {
  tag: string
  x: number
  y: number
  z: number
  collected: boolean
  mesh: THREE.Mesh
  halo: THREE.PointLight
}

export class Keystones {
  readonly group = new THREE.Group()
  readonly sites: KeystoneSite[] = []
  private t = 0

  build(): void {
    const meta = worldMeta!
    const geo = new THREE.IcosahedronGeometry(0.55, 0)
    for (const site of meta.ruinSites) {
      // only the arc's five sites carry keystones (the minor ruins are scenery)
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
      const halo = new THREE.PointLight(0x54c8f0, 40, 14)
      halo.position.copy(mesh.position)
      this.group.add(mesh, halo)
      this.sites.push({ tag: site.tag, x: site.x, y, z: site.z, collected: false, mesh, halo })
    }
  }

  get collectedCount(): number {
    return this.sites.filter((s) => s.collected).length
  }

  get total(): number {
    return this.sites.length
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
  collectNear(x: number, z: number, reach = 4): KeystoneSite | null {
    for (const s of this.sites) {
      if (s.collected) continue
      if (Math.hypot(s.x - x, s.z - z) <= reach) {
        s.collected = true
        s.mesh.visible = false
        // NEVER halo.visible = false: removing a light from the render list
        // changes the scene light count and forces EVERY material to
        // recompile — a 5-10s freeze on pickup (user-hit). Intensity 0 keeps
        // the program signature stable.
        s.halo.intensity = 0
        return s
      }
    }
    return null
  }

  /** Bob + spin the uncollected stones. */
  update(dt: number): void {
    this.t += dt
    for (const s of this.sites) {
      if (s.collected) continue
      s.mesh.rotation.y += dt * 1.2
      s.mesh.position.y = s.y + Math.sin(this.t * 1.6 + s.x) * 0.25
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
        s.halo.intensity = 0
      }
    }
  }
}

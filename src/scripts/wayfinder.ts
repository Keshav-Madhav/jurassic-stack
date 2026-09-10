// THE WAYFINDER (PLAN's "one item replaces the tutorial/quest system", M71).
//
// PLAN has always described it as a relic you find and CARRY:
//
//   "a compass relic on the first beach that points to the next arc beat.
//    Carry it = guided playthrough; leave it in a chest = pure sandbox."
//
// It has been the N key and a toast since M20 — always on, impossible to put
// down, and therefore not a choice at all. This is the item: a bronze rose
// half-buried in the sand a few steps from where you wake, which you pick up
// (or do not), and which shows a live bearing on the HUD only while it is in
// your pack. Drop it in a chest and the island goes quiet.
//
// The relic is BUILT, not downloaded — it is two rings and four spokes, and a
// downloaded compass would be a 200 KB model of something that reads at
// twenty pixels.
import * as THREE from 'three'
import { heightAt } from './heightmap'
import type { Emitter, LightRig } from './lights'

/** how close you have to be to take it */
export const TAKE_RANGE = 3.2

export class Wayfinder {
  readonly group = new THREE.Group()
  /** where it lies until someone picks it up */
  readonly x: number
  readonly z: number
  private y = 0
  private t = 0
  private relic: THREE.Group | null = null
  private glow: Emitter | null = null
  private taken = false

  constructor(x: number, z: number, private lights: LightRig | null = null) {
    this.x = x
    this.z = z
  }

  get isTaken(): boolean {
    return this.taken
  }

  build(): void {
    const g = new THREE.Group()
    const bronze = new THREE.MeshStandardMaterial({
      color: 0xb98b3e,
      emissive: new THREE.Color(0x7a4f12),
      emissiveIntensity: 0.5,
      roughness: 0.34,
      metalness: 0.8,
    })
    // the outer ring, the inner ring, and a needle across them
    const outer = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 8, 28), bronze)
    outer.rotation.x = Math.PI / 2
    g.add(outer)
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.028, 8, 22), bronze)
    inner.rotation.x = Math.PI / 2
    g.add(inner)
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.05), bronze)
      spoke.rotation.y = (i * Math.PI) / 4
      g.add(spoke)
    }
    const needle = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.42, 6), new THREE.MeshStandardMaterial({
      color: 0xe8d9a8, emissive: new THREE.Color(0x8fd8e8), emissiveIntensity: 1.1, roughness: 0.3, metalness: 0.4,
    }))
    needle.rotation.x = -Math.PI / 2
    needle.position.y = 0.06
    g.add(needle)
    for (const m of g.children) { (m as THREE.Mesh).castShadow = true }

    // TILTED, NOT FLAT. Lying level it reads as a gold coin on the grass; at
    // 55° the face is toward a standing player and it reads as what it is.
    g.rotation.x = -0.96
    this.y = heightAt(this.x, this.z) + 0.5
    g.position.set(this.x, this.y, this.z)
    this.relic = g
    this.group.add(g)
    // a small light so it catches the eye from up the beach — one emitter, and
    // the LightRig ranks it against everything else (M31)
    this.glow = this.lights?.add({ x: this.x, y: this.y, z: this.z, intensity: 20, distance: 10, decay: 1.8, color: 0xffce7a }) ?? null
  }

  /** bob and turn, so it reads as a thing worth walking to */
  update(dt: number): void {
    if (this.taken || !this.relic) return
    this.t += dt
    this.relic.rotation.z += dt * 0.7 // its own axis, since it leans back
    this.relic.position.y = this.y + Math.sin(this.t * 1.5) * 0.12
  }

  /** Take it, if the feet are close enough. */
  takeNear(x: number, z: number): boolean {
    if (this.taken) return false
    if (Math.hypot(this.x - x, this.z - z) > TAKE_RANGE) return false
    this.take()
    return true
  }

  /** Take it outright (a restored save, or QA). */
  take(): void {
    if (this.taken) return
    this.taken = true
    if (this.relic) this.group.remove(this.relic)
    // NEVER remove the light — changing the scene's light count recompiles
    // every material in the game, a 5-10 second freeze (M20). Douse it.
    if (this.glow) this.glow.intensity = 0
  }

  /** QA */
  debug(): { taken: boolean; x: number; z: number } {
    return { taken: this.taken, x: this.x, z: this.z }
  }
}

// Hand-written light culling (PERFORMANCE.md, lever A).
//
// three.js has no light culling. Every point light in the scene becomes an
// entry in NUM_POINT_LIGHTS, and every fragment of terrain, grass, leaf, hide
// and rock evaluates ALL of them — including the eight sitting at intensity 0
// two kilometres away. The island had ten (eight fire slots, the keystone
// halo, the beacon): ten distance/decay/BRDF evaluations per pixel, at every
// pixel, all day. M20 already showed the shape of this cost — going 5 → 12
// halos put 33 hitches into the fly run.
//
// So the fires, the halo and the beacon stop owning lights and register
// EMITTERS: plain data. Three real point lights follow the three nearest
// emitters, re-ranked five times a second. The shader light count is constant
// (a changing count recompiles every material — a multi-second freeze, M20),
// the per-pixel cost is fixed at three, and the player cannot tell: beyond its
// `distance` a point light contributes exactly nothing, and you are only ever
// inside four fire radii at once if you built them that way.
import * as THREE from 'three'

export interface Emitter {
  x: number
  y: number
  z: number
  /** candela. 0 = out (a fire that has not been lit) — an emitter at 0 never takes a slot */
  intensity: number
  /** metres; a point light is exactly black past this, which is what makes the culling honest */
  distance: number
  decay: number
  color: THREE.Color
  /** cleared by remove() */
  alive: boolean
}

/** the whole island's fill budget */
const SLOTS = 3
/** re-rank this often (seconds) — the ranking is cheap, but stability matters more than latency */
const RERANK = 0.2
/** a challenger must beat the incumbent's edge distance by this much to take its slot */
const HYSTERESIS = 4

export class LightRig {
  readonly group = new THREE.Group()
  private lights: THREE.PointLight[] = []
  private assigned: (Emitter | null)[] = []
  private emitters: Emitter[] = []
  private timer = 0
  private fwd = new THREE.Vector3()

  constructor() {
    for (let i = 0; i < SLOTS; i++) {
      // intensity 0 until a slot is filled; never removed, never hidden
      const l = new THREE.PointLight(0xffa25a, 0, 34, 1.6)
      l.castShadow = false
      this.lights.push(l)
      this.assigned.push(null)
      this.group.add(l)
    }
  }

  get slots(): number {
    return SLOTS
  }

  get emitterCount(): number {
    return this.emitters.filter((e) => e.alive).length
  }

  /** Register a light source. Mutate the returned handle to flicker/move it. */
  add(init: { x: number; y: number; z: number; intensity: number; distance: number; decay?: number; color: THREE.ColorRepresentation }): Emitter {
    const e: Emitter = {
      x: init.x, y: init.y, z: init.z,
      intensity: init.intensity,
      distance: init.distance,
      decay: init.decay ?? 1.6,
      color: new THREE.Color(init.color),
      alive: true,
    }
    this.emitters.push(e)
    return e
  }

  remove(e: Emitter): void {
    e.alive = false
    e.intensity = 0
    const i = this.emitters.indexOf(e)
    if (i >= 0) this.emitters.splice(i, 1)
    for (let s = 0; s < SLOTS; s++) if (this.assigned[s] === e) { this.assigned[s] = null; this.lights[s].intensity = 0 }
  }

  /** How far the camera is from this emitter's lit sphere: <0 = inside it.
   *  Ranking by the sphere and not the centre is what lets the beacon's 110 m
   *  glow outrank a torch you are standing next to but past the radius of. */
  private edge(e: Emitter, cam: THREE.Vector3): number {
    const dx = e.x - cam.x, dy = e.y - cam.y, dz = e.z - cam.z
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    let s = d - e.distance
    // a fire behind you lights ground you mostly cannot see: worth less than one ahead
    if (d > 6 && dx * this.fwd.x + dz * this.fwd.z < 0) s += 20
    return s
  }

  /** Re-rank (occasionally) and refresh the three lights from their emitters (every frame). */
  update(dt: number, camera: THREE.Camera): void {
    const cam = camera.position
    this.timer -= dt
    if (this.timer <= 0) {
      this.timer = RERANK
      camera.getWorldDirection(this.fwd)
      const scored: { e: Emitter; s: number }[] = []
      for (const e of this.emitters) {
        if (!e.alive || e.intensity <= 0) continue
        scored.push({ e, s: this.edge(e, cam) })
      }
      scored.sort((a, b) => a.s - b.s)
      const want = scored.slice(0, SLOTS)
      const pending = new Set(want.map((w) => w.e))
      const free: number[] = []
      for (let i = 0; i < SLOTS; i++) {
        const cur = this.assigned[i]
        if (cur && cur.alive && cur.intensity > 0) {
          if (pending.has(cur)) { pending.delete(cur); continue } // still one of the best: stays put
          // it lost — but only give the slot up to a clearly better light, or the
          // fire you just walked away from would blink out the moment it ties
          const mine = this.edge(cur, cam)
          const best = want.find((w) => pending.has(w.e))
          if (best && mine - best.s < HYSTERESIS) continue
        }
        free.push(i)
      }
      for (const i of free) {
        const next = want.find((w) => pending.has(w.e))
        if (next) { pending.delete(next.e); this.assigned[i] = next.e } else this.assigned[i] = null
      }
    }
    for (let i = 0; i < SLOTS; i++) {
      const e = this.assigned[i]
      const l = this.lights[i]
      if (!e || !e.alive) { l.intensity = 0; continue }
      l.position.set(e.x, e.y, e.z)
      l.color.copy(e.color)
      l.distance = e.distance
      l.decay = e.decay
      l.intensity = e.intensity
    }
  }

  /** QA/debug: which emitters hold the three slots */
  debug(): { i: number; on: boolean; intensity: number; at: number[] }[] {
    return this.assigned.map((e, i) => ({
      i,
      on: !!e,
      intensity: +this.lights[i].intensity.toFixed(0),
      at: e ? [Math.round(e.x), Math.round(e.y), Math.round(e.z)] : [],
    }))
  }
}

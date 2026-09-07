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

/** The whole island's fill budget. Four, not three: a hearth with torches
 *  round it is the common camp, and a fourth slot is what stops the rig having
 *  to choose between them every time you move. Point lights measured free on
 *  the M5 Pro (3 vs 10 is the same frame, M31) — this cap is for the weakest
 *  machine we target, not this one. */
const SLOTS = 4
/** re-rank this often (seconds) — the ranking is cheap, but stability matters more than latency */
const RERANK = 0.2
/** a challenger must beat the incumbent's edge distance by this much to take its slot */
const HYSTERESIS = 6
/** seconds a slot takes to hand over: down at the old fire, then up at the new
 *  one. A hard swap read as a flicker — the user saw it (M32). */
const FADE = 0.22

export class LightRig {
  readonly group = new THREE.Group()
  private lights: THREE.PointLight[] = []
  /** what each slot is lighting right now */
  private assigned: (Emitter | null)[] = []
  /** what the ranking wants it to light — a slot fades out before it moves */
  private wanted: (Emitter | null)[] = []
  private fade: number[] = []
  private emitters: Emitter[] = []
  private timer = 0

  constructor() {
    for (let i = 0; i < SLOTS; i++) {
      // intensity 0 until a slot is filled; never removed, never hidden
      const l = new THREE.PointLight(0xffa25a, 0, 34, 1.6)
      l.castShadow = false
      this.lights.push(l)
      this.assigned.push(null)
      this.wanted.push(null)
      this.fade.push(0)
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
    for (let s = 0; s < SLOTS; s++) {
      if (this.wanted[s] === e) this.wanted[s] = null
      if (this.assigned[s] === e) { this.assigned[s] = null; this.fade[s] = 0; this.lights[s].intensity = 0 }
    }
  }

  /** How far the camera is from this emitter's lit sphere: <0 = inside it.
   *  Ranking by the sphere and not the centre is what lets the beacon's 110 m
   *  glow outrank a torch you are standing next to but past the radius of.
   *
   *  DISTANCE ONLY. The first cut also pushed emitters behind the camera down
   *  the ranking, which sounds sensible and flickered badly: turning on the
   *  spot flipped the term on and off and the slots churned four times a
   *  revolution — a torch going dark as another lit (user, M32). Where you
   *  LOOK must not decide what is lit; only where you stand. */
  private edge(e: Emitter, cam: THREE.Vector3): number {
    const dx = e.x - cam.x, dy = e.y - cam.y, dz = e.z - cam.z
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - e.distance
  }

  /** Re-rank (occasionally); fade each light toward what it should be lighting
   *  (every frame). `from` is where the PLAYER stands, not where the camera is:
   *  the third-person camera swings several metres around the player as you
   *  turn, so ranking from it re-ordered the fires of a camp five times a
   *  revolution while the player never moved (user: flicker, M32). */
  update(dt: number, from: THREE.Vector3): void {
    const cam = from
    this.timer -= dt
    if (this.timer <= 0) {
      this.timer = RERANK
      this.rank(cam)
    }
    for (let i = 0; i < SLOTS; i++) {
      const l = this.lights[i]
      // a slot that has been re-pointed dims where it is, THEN moves: a light
      // teleporting between two fires at full brightness is a flicker
      if (this.wanted[i] !== this.assigned[i]) {
        this.fade[i] -= dt / FADE
        if (this.fade[i] <= 0) {
          this.fade[i] = 0
          this.assigned[i] = this.wanted[i]
        }
      } else if (this.fade[i] < 1) {
        this.fade[i] = Math.min(1, this.fade[i] + dt / FADE)
      }
      const e = this.assigned[i]
      if (!e || !e.alive) { l.intensity = 0; continue }
      l.position.set(e.x, e.y, e.z)
      l.color.copy(e.color)
      l.distance = e.distance
      l.decay = e.decay
      l.intensity = e.intensity * this.fade[i]
    }
  }

  /** Choose what each slot should light. Incumbents keep their slot unless a
   *  challenger is clearly closer — otherwise two fires at a similar distance
   *  would trade the light back and forth as you walk between them. */
  private rank(cam: THREE.Vector3): void {
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
      const cur = this.wanted[i]
      if (cur && cur.alive && cur.intensity > 0) {
        if (pending.has(cur)) { pending.delete(cur); continue } // still one of the best: stays put
        const mine = this.edge(cur, cam)
        const best = want.find((w) => pending.has(w.e))
        if (best && mine - best.s < HYSTERESIS) continue
      }
      free.push(i)
    }
    for (const i of free) {
      const next = want.find((w) => pending.has(w.e))
      if (next) { pending.delete(next.e); this.wanted[i] = next.e } else this.wanted[i] = null
    }
  }

  /** QA/debug: which emitters hold the slots, and mid-handover fades */
  debug(): { i: number; on: boolean; intensity: number; fade: number; at: number[] }[] {
    return this.assigned.map((e, i) => ({
      i,
      on: !!e,
      intensity: +this.lights[i].intensity.toFixed(0),
      fade: +this.fade[i].toFixed(2),
      at: e ? [Math.round(e.x), Math.round(e.y), Math.round(e.z)] : [],
    }))
  }
}

// The generic dino: one brain, driven entirely by its species row.
// States: wild (idle⇄wander, aggro when provoked) → unconscious (torpor
// maxed; feed to tame) → tamed (follows owner; rideable if saddled).
// Riding swaps the dino onto a real Mover (the shared KCC) — the payoff of
// the single-controller decision: a ridden raptor is just the player's
// intent flowing into a bigger capsule.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { heightAt, normalAt, SEA_LEVEL } from './heightmap'
import { nearestObstacle } from './obstacles'
import { findPath, type PathPoint } from './navmesh'
import { Mover, type MoverConfig } from './mover'
import type { Physics } from './physics'
import type { SpeciesDef } from './species'

export type DinoState = 'idle' | 'wander' | 'aggro' | 'hunt' | 'feed' | 'flee' | 'ko' | 'dead' | 'tamed'

/** What the brain sees each think: the awake herd around it (main.ts fills it once a frame). */
export interface Senses {
  awake: Dino[]
  /** a hit landed somewhere — main.ts sprays blood there */
  onHit: (x: number, y: number, z: number, heavy: boolean) => void
}

const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)
const modelCache = new Map<string, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>>()

// Rig clones are paced: 500 dinos resolving off one model load used to clone
// 500 skeletons in a single microtask flush — a quarter-second hitch on a
// live connection right as the world came up. A few per frame instead.
const cloneQueue: (() => void)[] = []
let clonePump = false
function pumpClones(): void {
  for (let i = 0; i < 4 && cloneQueue.length; i++) cloneQueue.shift()!()
  if (cloneQueue.length) requestAnimationFrame(pumpClones)
  else clonePump = false
}
function whenMyTurn(): Promise<void> {
  return new Promise((resolve) => {
    cloneQueue.push(resolve)
    if (!clonePump) { clonePump = true; requestAnimationFrame(pumpClones) }
  })
}
/** every clip name per model URL — the animation audit reads this */
export const clipNamesByModel = new Map<string, string[]>()
async function loadModel(url: string) {
  if (!modelCache.has(url)) modelCache.set(url, loader.loadAsync(url))
  const gltf = await modelCache.get(url)!
  if (!clipNamesByModel.has(url)) clipNamesByModel.set(url, gltf.animations.map((a) => a.name))
  await whenMyTurn()
  return { scene: (await import('three/addons/utils/SkeletonUtils.js')).clone(gltf.scene) as THREE.Group, animations: gltf.animations }
}

/** wild dinos beyond SLEEP go dormant; they wake inside WAKE */
const DORMANT_SLEEP = 680
const DORMANT_WAKE = 600
/** an awake dino's rig is only attached (drawn, matrices walked) inside this;
 *  a 3 m animal at 400 m is a few pixels, and the 40-odd awake rigs in the
 *  600 m ring were 170 draw calls whichever way you faced (M18 draw audit) */
const DRAW_DIST = 380
const DRAW_HYST = 30

export class Dino {
  /** interpolation factor between the last two physics steps (main loop sets it each frame) */
  static renderAlpha = 1
  /** main.ts hooks this: called once per SPECIES with the first calibrated
   *  rig, to compile its shaders and upload its textures before the rig is
   *  ever drawn (the 1500 rigs load over ~6 s after the scene's warm-up;
   *  a species' first appearance was a 150 ms compile stall — M18) */
  static onFirstRig: ((speciesId: string, model: THREE.Object3D) => void) | null = null
  private static warmed = new Set<string>()
  private static cullSpheres = new Map<string, THREE.Sphere[]>()
  readonly object = new THREE.Group()
  /** the loaded rig — hidden (not `object`, which doubles as "alive") while dormant */
  private model: THREE.Object3D | null = null
  /** far from the player: no AI, no animation, no draw, until they come back */
  dormant = false
  state: DinoState = 'idle'
  hp: number
  torpor = 0
  tameProgress = 0
  saddled = false
  ridden = false
  /** Mover exists only while ridden (kinematic body would fight the AI otherwise). */
  mover: Mover | null = null

  private mixer: THREE.AnimationMixer | null = null
  private actions: Partial<Record<'idle' | 'walk' | 'run' | 'attack' | 'ko', THREE.AnimationAction>> = {}
  private flavorActions: THREE.AnimationAction[] = []
  private flavorT = 4 + Math.random() * 8
  private stateT = 2 + Math.random() * 3
  private target = new THREE.Vector3()
  private home = new THREE.Vector3()
  private heading = Math.random() * Math.PI * 2
  private speed = 0
  private moveWeight = 0
  private runBlend = 0
  private attackCooldown = 0
  private tmpN = new THREE.Vector3()
  /** the animal this one is chasing (hunt) or fighting (aggro on a dino) */
  private foe: Dino | null = null
  /** seconds until a carnivore is hungry again (a kill feeds it for minutes) */
  private satiety = 20 + Math.random() * 60
  /** perception runs every ~0.5 s, staggered */
  private thinkT = Math.random() * 0.5
  /** the carcass timer (dead) and the meal timer (feed) share it */
  private deadT = 0
  /** rigs without a real death clip topple procedurally when KO'd */
  private topple = 0
  private toppleWanted = false
  /** navmesh path-following (chase/follow): waypoints toward the target */
  private waypoints: PathPoint[] = []
  private repathT = 0

  constructor(
    readonly species: SpeciesDef,
    x: number,
    z: number,
    readonly index: number,
  ) {
    this.hp = species.hp
    this.home.set(x, 0, z)
    this.object.position.set(x, heightAt(x, z), z)
    this.object.rotation.y = this.heading
  }

  async load(): Promise<void> {
    const { scene: model, animations } = await loadModel(this.species.model)
    // dino rigs are skinned; any plain static mesh alongside is packaging junk
    // (the T-Rex GLB ships a giant ground plane that rendered as a green slab)
    let hasSkinned = false
    model.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) hasSkinned = true
    })
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (hasSkinned && !(o instanceof THREE.SkinnedMesh)) {
          o.visible = false
          return
        }
        o.castShadow = true
        o.receiveShadow = true
        // OPAQUE, always: the Carnotaurus GLB ships alphaMode BLEND, which
        // GLTFLoader turns into transparent + no depth write — the rig then
        // drew in the transparent pass before the water sheets and the river
        // painted straight over its back (user screenshot 24, M19b)
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          const mm = m as THREE.MeshStandardMaterial
          if (mm.transparent || !mm.depthWrite) {
            mm.transparent = false
            mm.depthWrite = true
            mm.opacity = 1
            if (mm.map) mm.alphaTest = Math.max(mm.alphaTest, 0.4)
            mm.needsUpdate = true
          }
        }
        // the alpha wears its own skin: darker, ember-lit — its materials are
        // CLONED (the GLB's are shared by every rig of the species)
        if (this.species.alpha) {
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          const tinted = mats.map((m) => {
            const c = (m as THREE.MeshStandardMaterial).clone()
            c.color.multiplyScalar(0.55)
            c.emissive = new THREE.Color(0x6a0c08)
            c.emissiveIntensity = 0.45
            return c
          })
          o.material = Array.isArray(o.material) ? tinted : tinted[0]
        }
        // culled by a bounding sphere computed from the SKINNED pose after
        // calibration (below) — three's default used the bind-space sphere,
        // which for rigs with scale tracks on the root sits nowhere near the
        // animal (the mammoth was culled while you stood in front of it, M18);
        // and turning culling off drew every rig in 380 m whichever way you
        // faced — 280 draw calls at the wood line (M19 draw audit)
        o.frustumCulled = true
      }
    })
    this.model = model
    // attached for calibration below — a dormant rig is then DETACHED, not
    // hidden: three.js walks every Object3D in the scene each frame to update
    // world matrices, visible or not, and 1500 rigs × ~100 bones was 30 ms of
    // CPU a frame (M15 jitter meter). Calibrating a detached rig read stale
    // bone matrices and scaled mammoths to the size of the island (M18).
    this.object.add(model)

    this.mixer = new THREE.AnimationMixer(model)
    for (const slot of ['idle', 'walk', 'run', 'attack', 'ko'] as const) {
      const clip = animations.find((a) => this.species.clips[slot].test(a.name))
      if (clip) this.actions[slot] = this.mixer.clipAction(clip)
    }
    for (const re of this.species.flavorClips ?? []) {
      const clip = animations.find((a) => re.test(a.name))
      if (clip) {
        const a = this.mixer.clipAction(clip)
        a.setLoop(THREE.LoopOnce, 1)
        this.flavorActions.push(a)
      }
    }
    this.actions.idle?.play()
    this.actions.walk?.play()
    if (this.actions.walk) this.actions.walk.weight = 0
    if (this.actions.run) {
      this.actions.run.play()
      this.actions.run.weight = 0
    }

    // Size + ground calibration, in ANIMATED pose. Order matters: several
    // Sketchfab rigs carry scale/position tracks on their root nodes, so the
    // first animation frame re-scales the skeleton — normalizing from the
    // bind-pose bbox made trikes and the rex spawn at kaiju scale. Apply one
    // idle frame first, THEN normalize height from the true skinned bounds,
    // then drop feet to ground from those same bounds.
    this.mixer.update(0.01)
    this.object.updateMatrixWorld(true)
    const bounds = this.skinnedBounds(model)
    if (bounds) {
      const s = this.species.height / Math.max(0.01, bounds.max.y - bounds.min.y)
      model.scale.setScalar(s)
      this.object.updateMatrixWorld(true)
      const b2 = this.skinnedBounds(model)
      if (b2) {
        const groundY = this.object.getWorldPosition(new THREE.Vector3()).y
        model.position.y -= b2.min.y - groundY
      }
      this.debugCalib = { rawH: +(bounds.max.y - bounds.min.y).toFixed(2), scale: +s.toFixed(3) }
    }
    // per-mesh culling spheres from the posed skin, inflated for the animation's
    // reach — computed ONCE per species (it walks every skinned vertex; doing it
    // for 1500 clones stretched the load-time frames to 50 ms) and copied
    {
      let spheres = Dino.cullSpheres.get(this.species.id)
      if (!spheres) {
        spheres = []
        model.traverse((o) => {
          if (!(o instanceof THREE.SkinnedMesh)) return
          o.computeBoundingSphere()
          const sp = o.boundingSphere ? o.boundingSphere.clone() : new THREE.Sphere(new THREE.Vector3(), 1)
          sp.radius *= 1.7
          spheres!.push(sp)
        })
        Dino.cullSpheres.set(this.species.id, spheres)
      }
      let k = 0
      model.traverse((o) => {
        if (!(o instanceof THREE.SkinnedMesh)) return
        const sp = spheres![k++]
        if (sp) o.boundingSphere = sp.clone()
      })
    }
    if (Dino.onFirstRig && !Dino.warmed.has(this.species.id)) {
      Dino.warmed.add(this.species.id)
      Dino.onFirstRig(this.species.id, model)
    }
    if (this.dormant) this.object.remove(model)
  }

  /** Warm-up: attach the rig for one compile pass; returns a detach callback (or null if already attached / not loaded). */
  attachForWarmup(): (() => void) | null {
    if (!this.model || this.model.parent) return null
    const model = this.model
    this.object.add(model)
    return () => { this.object.remove(model) }
  }

  /** QA: which clip each slot resolved to (null = the species regex matched nothing) */
  clipReport(): Record<string, string | null> {
    const out: Record<string, string | null> = {}
    for (const slot of ['idle', 'walk', 'run', 'attack', 'ko'] as const) out[slot] = this.actions[slot]?.getClip().name ?? null
    return out
  }

  /** QA: where the rig's high parts (head/neck for most dinos) sit relative to
   *  the heading: +1 = ahead of the body centre, −1 = behind → walking backwards */
  headSide(): number | null {
    if (!this.model) return null
    const detached = !this.model.parent
    if (detached) this.object.add(this.model)
    this.object.updateMatrixWorld(true)
    const pts: THREE.Vector3[] = []
    const v = new THREE.Vector3()
    let maxY = -Infinity, minY = Infinity
    this.model.traverse((o) => {
      if (!(o instanceof THREE.SkinnedMesh) || !o.visible) return
      const count = o.geometry.attributes.position.count
      const step = Math.max(1, Math.floor(count / 3000))
      for (let i = 0; i < count; i += step) {
        o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld)
        pts.push(v.clone())
        maxY = Math.max(maxY, v.y); minY = Math.min(minY, v.y)
      }
    })
    if (detached) this.object.remove(this.model)
    if (!pts.length) return null
    const cut = minY + (maxY - minY) * 0.8
    let hx = 0, hz = 0, n = 0, cx = 0, cz = 0
    for (const p of pts) { cx += p.x; cz += p.z; if (p.y > cut) { hx += p.x; hz += p.z; n++ } }
    cx /= pts.length; cz /= pts.length
    if (!n) return null
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading)
    const along = (hx / n - cx) * fx + (hz / n - cz) * fz
    const span = Math.max(...pts.map((p) => Math.abs((p.x - cx) * fx + (p.z - cz) * fz)))
    return along / (span || 1)
  }

  /** QA: the way it faces/moves (radians, 0 = +z) */
  get facing(): number { return this.heading }
  get speedNow(): number { return this.speed }

  /** QA: the rig's material flags (attached or not) */
  materialReport(): string[] {
    const out = new Set<string>()
    this.model?.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        const mm = m as THREE.MeshStandardMaterial
        out.add(`${mm.type} transparent=${mm.transparent} depthWrite=${mm.depthWrite} alphaTest=${mm.alphaTest} opacity=${mm.opacity} side=${mm.side} skinned=${o instanceof THREE.SkinnedMesh}`)
      }
    })
    return [...out]
  }

  /** QA: how this dino is being drawn right now */
  drawInfo(): Record<string, unknown> {
    const m = this.model
    let meshes = 0, visibleMeshes = 0, minY = Infinity, maxY = -Infinity
    if (m) {
      m.updateMatrixWorld(true)
      m.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        meshes++
        if (o.visible) visibleMeshes++
      })
      const b = this.skinnedBounds(m)
      if (b) { minY = b.min.y; maxY = b.max.y }
    }
    return {
      species: this.species.id, state: this.state, dormant: this.dormant, dist: +this.distToPlayer.toFixed(1),
      loaded: !!m, attached: !!m?.parent, objectVisible: this.object.visible, modelVisible: m?.visible,
      meshes, visibleMeshes, scale: m ? +m.scale.x.toFixed(4) : null,
      objectY: +this.object.position.y.toFixed(2), boundsY: [+minY.toFixed(2), +maxY.toFixed(2)],
    }
  }

  /** QA: the rig's rendered height right now (metres), attaching a dormant rig for the measure. */
  measuredHeight(): number | null {
    if (!this.model) return null
    const detached = !this.model.parent
    if (detached) this.object.add(this.model)
    this.object.updateMatrixWorld(true)
    const b = this.skinnedBounds(this.model)
    if (detached) this.object.remove(this.model)
    return b ? b.max.y - b.min.y : null
  }

  debugCalib: { rawH: number; scale: number } | null = null

  /** World-space bounds of the skinned vertices in the CURRENT pose. */
  private skinnedBounds(model: THREE.Object3D): { min: THREE.Vector3; max: THREE.Vector3 } | null {
    const min = new THREE.Vector3(Infinity, Infinity, Infinity)
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    const v = new THREE.Vector3()
    let any = false
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !o.visible) return
      const isSkinned = o instanceof THREE.SkinnedMesh
      const count = o.geometry.attributes.position.count
      const step = Math.max(1, Math.floor(count / 2500))
      for (let i = 0; i < count; i += step) {
        if (isSkinned) (o as THREE.SkinnedMesh).getVertexPosition(i, v)
        else v.fromBufferAttribute(o.geometry.attributes.position, i)
        v.applyMatrix4(o.matrixWorld)
        min.min(v)
        max.max(v)
        any = true
      }
    })
    return any ? { min, max } : null
  }

  /** A hit from the player. torporHit=true for fists (KO route), false for weapons (damage route). */
  takeHit(damage: number, torporGain: number, fromX: number, fromZ: number): void {
    if (this.state === 'ko' || this.state === 'tamed') return
    this.hp -= damage
    this.torpor += torporGain
    if (this.hp <= 0) {
      // killed: a carcass lies there a while (ragdolls arrive at M7)
      this.die()
      return
    }
    if (this.torpor >= this.species.torporMax) {
      this.state = 'ko'
      this.foe = null
      this.playKo()
      return
    }
    // provoked: aggressive AND defensive species turn on the attacker, skittish bolt
    if (this.species.temperament !== 'skittish') {
      this.state = 'aggro'
      this.foe = null // the player
      this.stateT = 12
    } else {
      this.fleeFrom(fromX, fromZ, 6)
    }
  }

  /** Feed while KO'd; returns true when the tame completes. */
  feed(): boolean {
    if (this.state !== 'ko') return false
    this.tameProgress += this.species.tamePerFeed
    if (this.tameProgress >= 100) {
      this.state = 'tamed'
      this.torpor = 0
      this.hp = this.species.hp
      this.stopKo()
      return true
    }
    return false
  }

  update(dt: number, playerPos: THREE.Vector3, attackPlayer: (damage: number) => void, senses?: Senses): void {
    this.attackCooldown -= dt
    const pos = this.object.position
    this.distToPlayer = pos.distanceTo(playerPos)
    // dormancy: a wild dino far from the player is frozen and undrawn (200 on
    // the map, a few dozen ever simulated). Tames, KOs and anything already
    // aggroed stay live; hysteresis keeps the edge from flickering.
    const wildIdle = !this.ridden && (this.state === 'idle' || this.state === 'wander' || this.state === 'flee' || this.state === 'dead')
    if (this.dormant) {
      // (the main loop only calls a dormant dino every 8th frame)
      if (this.distToPlayer < DORMANT_WAKE || !wildIdle) {
        this.dormant = false
        if (this.model && !this.model.parent) this.object.add(this.model)
      } else {
        return
      }
    } else if (wildIdle && this.distToPlayer > DORMANT_SLEEP) {
      this.dormant = true
      if (this.model) this.object.remove(this.model)
      return
    }
    // draw distance: attach/detach the rig like dormancy does (hysteresis)
    if (this.model && !this.ridden) {
      const attached = !!this.model.parent
      if (attached && this.distToPlayer > DRAW_DIST + DRAW_HYST) this.object.remove(this.model)
      else if (!attached && this.distToPlayer < DRAW_DIST) this.object.add(this.model)
    }
    // skinned casters are expensive in the shadow pass — only nearby dinos cast
    const wantShadow = this.distToPlayer < 110
    if (wantShadow !== this.castingShadow) {
      this.castingShadow = wantShadow
      this.object.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = wantShadow
      })
    }

    if (this.ridden && this.mover) {
      // position comes from the mover — sampled between physics steps so the
      // mount doesn't stutter at speed; visuals + anim only. Small embed: the
      // KCC's contact offset + capsule hemisphere read as hovering otherwise.
      pos.lerpVectors(this.mover.prevPosition, this.mover.position, Dino.renderAlpha)
      pos.y -= this.mover.feetOffset + 0.12
      this.object.rotation.y = this.heading + (this.species.facingOffset ?? 0)
      const planar = Math.hypot(this.mover.intent.vx, this.mover.intent.vz)
      this.speed = planar
      this.animate(dt, planar / this.species.runSpeed, planar > this.species.walkSpeed * 1.4)
      return
    }

    // perception: what's around me, every ~0.5 s
    this.thinkT -= dt
    this.satiety -= dt
    if (senses && this.thinkT <= 0) {
      this.thinkT = 0.45 + Math.random() * 0.15
      this.think(senses, playerPos)
    }

    switch (this.state) {
      case 'dead': {
        // a carcass: lies where it fell for a while, then is gone
        this.deadT -= dt
        this.speed = 0
        this.animate(dt, 0, false)
        this.mixer?.update(0)
        if (this.deadT <= 0) this.object.visible = false
        return
      }
      case 'feed': {
        // eating: stand over the kill, chew (the attack clip, slowed), then walk off full
        this.deadT -= dt
        this.speed = Math.max(0, this.speed - 8 * dt)
        this.attackCooldown -= dt
        if (this.attackCooldown <= 0) {
          this.attackCooldown = 2.6
          const a = this.actions.attack
          if (a) { a.reset().setLoop(THREE.LoopOnce, 1); a.timeScale = 0.6; a.play() }
        }
        if (this.deadT <= 0) {
          this.satiety = 120 + Math.random() * 120
          this.state = 'idle'
          this.stateT = 3
          this.foe = null
        }
        break
      }
      case 'ko': {
        // torpor drains; wake up if it empties before the tame completes
        this.torpor -= this.species.torporDrain * dt
        if (this.torpor <= 0 && this.object.visible) {
          this.state = 'flee'
          this.stateT = 8
          this.tameProgress = 0
          this.stopKo()
        }
        this.speed = 0
        this.animate(dt, 0, false)
        this.mixer?.update(0) // hold the KO pose
        return
      }
      case 'tamed': {
        const d = pos.distanceTo(playerPos)
        if (d > 6) this.seekVia(playerPos, dt, d > 14 ? this.species.runSpeed : this.species.walkSpeed)
        else {
          this.speed = Math.max(0, this.speed - 8 * dt)
          this.waypoints.length = 0
        }
        break
      }
      case 'aggro':
      case 'hunt': {
        // aggro = fighting (the player, or a dino that struck first / stands its
        // ground); hunt = a carnivore running down prey. Same chase, different exits.
        this.stateT -= dt
        const foe = this.foe
        const foeGone = foe && (foe.state === 'dead' || foe.state === 'ko' || foe.dormant || !foe.object.visible)
        const tgt = foe && !foeGone ? foe.object.position : playerPos
        const d = pos.distanceTo(tgt)
        const reach = this.species.attackRange + (foe ? foe.species.height * 0.45 : 0)
        const giveUp = this.state === 'hunt' ? 110 : this.species.alpha ? 120 : 45
        if (foe && foe.state === 'dead' && this.species.diet === 'carnivore' && foe.species.diet === 'herbivore' && d < reach + 3) {
          // the kill: eat
          this.state = 'feed'
          this.deadT = 14 + Math.random() * 8
          this.waypoints.length = 0
          break
        }
        if (this.stateT <= 0 || d > giveUp || foeGone) {
          this.state = 'idle'
          this.stateT = 2
          this.foe = null
          this.waypoints.length = 0
        } else if (d <= reach) {
          this.speed = Math.max(0, this.speed - 10 * dt)
          this.waypoints.length = 0
          // face the target while biting
          const want = Math.atan2(tgt.x - pos.x, tgt.z - pos.z)
          let dd = want - this.heading
          while (dd > Math.PI) dd -= Math.PI * 2
          while (dd < -Math.PI) dd += Math.PI * 2
          this.heading += THREE.MathUtils.clamp(dd, -this.species.turnRate * dt, this.species.turnRate * dt)
          if (this.attackCooldown <= 0) {
            this.attackCooldown = 1.4
            const a = this.actions.attack
            if (a) { a.reset().setLoop(THREE.LoopOnce, 1); a.timeScale = 1; a.play() }
            if (foe && !foeGone) {
              foe.takeHitFrom(this, this.species.attackDamage)
              senses?.onHit(foe.object.position.x, foe.object.position.y + foe.species.height * 0.5, foe.object.position.z, this.species.attackDamage > 30)
            } else {
              attackPlayer(this.species.attackDamage)
              senses?.onHit(playerPos.x, playerPos.y + 1.2, playerPos.z, this.species.attackDamage > 30)
            }
          }
        } else {
          if (foe && !foeGone) this.seek(tgt.x, tgt.z, dt, this.species.runSpeed)
          else this.seekVia(tgt, dt, this.species.runSpeed)
        }
        break
      }
      case 'flee': {
        this.stateT -= dt
        if (this.stateT <= 0) {
          this.state = 'idle'
          this.stateT = 2
        } else {
          this.seek(this.target.x, this.target.z, dt, this.species.runSpeed)
        }
        break
      }
      case 'idle': {
        this.stateT -= dt
        this.speed = Math.max(0, this.speed - 6 * dt)
        if (this.maybeAggro(playerPos)) break
        this.flavorT -= dt
        if (this.flavorT <= 0 && this.flavorActions.length) {
          this.flavorT = 5 + Math.random() * 10
          this.flavorActions[Math.floor(Math.random() * this.flavorActions.length)].reset().play()
        }
        if (this.stateT <= 0) {
          this.pickWanderTarget()
          this.state = 'wander'
        }
        break
      }
      case 'wander': {
        if (this.maybeAggro(playerPos)) break
        const dx = this.target.x - pos.x
        const dz = this.target.z - pos.z
        if (Math.hypot(dx, dz) < 1.6) {
          this.state = 'idle'
          this.stateT = 2 + Math.random() * 4
        } else {
          this.seek(this.target.x, this.target.z, dt, this.species.walkSpeed)
        }
        break
      }
    }

    // slope-aware ground clamp: average front/back paw heights along the
    // heading, and pitch the body to match — single-point clamping floats the
    // feet on any slope
    const fx = Math.sin(this.heading) * 0.8
    const fz = Math.cos(this.heading) * 0.8
    const hFront = heightAt(pos.x + fx, pos.z + fz)
    const hBack = heightAt(pos.x - fx, pos.z - fz)
    pos.y = (hFront + hBack) / 2 - 0.06 // slight embed: convex micro-ground floated feet
    this.object.rotation.y = this.heading + (this.species.facingOffset ?? 0)
    this.object.rotation.x = THREE.MathUtils.clamp(Math.atan2(hBack - hFront, 1.6), -0.3, 0.3)
    // the procedural topple (no death clip): roll onto the side, sink a little
    const wantT = this.toppleWanted ? 1 : 0
    if (this.topple !== wantT) this.topple = THREE.MathUtils.clamp(this.topple + (wantT ? dt / 0.8 : -dt / 0.5), 0, 1)
    if (this.topple > 0) {
      this.object.rotation.z = -1.35 * this.topple
      pos.y -= this.species.height * 0.18 * this.topple
    } else this.object.rotation.z = 0
    const running = this.speed > this.species.walkSpeed * 1.4
    this.animate(dt, this.speed / (running ? this.species.runSpeed : this.species.walkSpeed), running)
  }

  /** Wild aggressive dinos attack on proximity (territorial). */
  private maybeAggro(playerPos: THREE.Vector3): boolean {
    if (this.species.temperament !== 'aggressive' || this.species.aggroRange <= 0) return false
    if (this.object.position.distanceTo(playerPos) > this.species.aggroRange) return false
    this.state = 'aggro'
    this.foe = null
    this.stateT = 12
    this.flavorActions[1]?.reset().play() // call_alert if loaded
    return true
  }

  /**
   * THE THINK: the ecology. Every half second an awake wild dino looks around:
   *  · a hungry carnivore picks the nearest herbivore it can take (not much
   *    taller than itself, not tamed) inside its hunt range and runs it down
   *  · a herbivore that sees a carnivore inside its fear range bolts — unless
   *    it is defensive and the predator is no bigger than it: then it turns
   *    and charges
   * Only idle/wandering animals think; fights and flights run their course.
   */
  private think(senses: Senses, playerPos: THREE.Vector3): void {
    if (this.state !== 'idle' && this.state !== 'wander') return
    if (this.ridden || this.species.alpha) return // the Gatekeeper guards; it hunts nothing
    const pos = this.object.position
    const sp = this.species
    if (sp.diet === 'carnivore') {
      if (this.satiety > 0) return
      const range = Math.max(sp.aggroRange * 2.5, 45)
      let best: Dino | null = null
      let bd = range
      for (const o of senses.awake) {
        if (o === this || o.species.diet !== 'herbivore' || o.state === 'tamed' || o.state === 'dead' || o.state === 'ko' || o.ridden) continue
        if (o.species.height > sp.height * 1.6) continue
        if (o.species.hp > sp.hp * 2.5) continue // a terror bird doesn't pick a stegosaurus
        const d = pos.distanceTo(o.object.position)
        if (d < bd) { bd = d; best = o }
      }
      if (best) {
        this.state = 'hunt'
        this.foe = best
        this.stateT = 30
        this.flavorActions[1]?.reset().play()
      }
      return
    }
    // herbivore: fear
    const fear = 22 + sp.height * 4
    let threat: Dino | null = null
    let td = fear
    for (const o of senses.awake) {
      if (o === this || o.species.diet !== 'carnivore' || o.state === 'tamed' || o.state === 'dead' || o.state === 'ko') continue
      const d = pos.distanceTo(o.object.position)
      if (d < td) { td = d; threat = o }
    }
    if (!threat) return
    const smaller = threat.species.height <= sp.height * 0.95
    if (sp.temperament === 'defensive' && smaller) {
      // a trike does not run from a raptor: it ignores it until it comes close, then charges
      if (td < 16) {
        this.state = 'aggro'
        this.foe = threat
        this.stateT = 14
        this.flavorActions[0]?.reset().play()
      }
    } else {
      this.fleeFrom(threat.object.position.x, threat.object.position.z, 7)
    }
    void playerPos
  }

  private fleeFrom(fromX: number, fromZ: number, secs: number): void {
    const pos = this.object.position
    const ax = pos.x - fromX, az = pos.z - fromZ
    const len = Math.hypot(ax, az) || 1
    this.state = 'flee'
    this.stateT = secs
    this.foe = null
    this.target.set(pos.x + (ax / len) * 60, 0, pos.z + (az / len) * 60)
    this.waypoints.length = 0
  }

  /** Struck by another dino: herbivores flee or (defensive) fight back; carnivores fight back. */
  takeHitFrom(attacker: Dino, damage: number): void {
    if (this.state === 'dead' || this.state === 'ko' || this.state === 'tamed') {
      if (this.state === 'tamed') this.hp -= damage // a tame can be hurt; it fights back below
      else return
    }
    this.hp -= damage
    if (this.hp <= 0) { this.die(); return }
    if (this.state === 'tamed') return
    if (this.state === 'hunt' && this.foe === attacker) { this.stateT = Math.max(this.stateT, 12); return } // prey fighting back doesn't break the hunt
    // a much bigger animal striking you is a reason to run, whatever your temper
    const outsized = attacker.species.height > this.species.height * 1.25
    if (this.species.temperament === 'skittish' || outsized) {
      this.fleeFrom(attacker.object.position.x, attacker.object.position.z, 7)
    } else {
      this.state = 'aggro'
      this.foe = attacker
      this.stateT = 14
    }
  }

  /** Killed: a carcass for a while, then gone. */
  private die(): void {
    this.state = 'dead'
    this.deadT = 75
    this.speed = 0
    this.foe = null
    this.waypoints.length = 0
    this.playKo()
  }

  /** Packmates join a fight: called by the herd manager when one aggros. */
  joinPack(foe: Dino | null): void {
    if (this.state === 'idle' || this.state === 'wander') {
      this.state = 'aggro'
      this.foe = foe
      this.stateT = 10
    }
  }

  /** who this one is fighting/chasing (null = the player, when aggro/hunt) */
  get currentFoe(): Dino | null { return this.foe }

  /** Seek toward a target via the navmesh: repath periodically, steer along
   *  waypoints, fall back to direct seek when no route exists. */
  private seekVia(target: THREE.Vector3, dt: number, speed: number): void {
    const pos = this.object.position
    this.repathT -= dt
    if (this.repathT <= 0) {
      this.repathT = 0.9 + Math.random() * 0.4
      const path = findPath(pos.x, pos.y, pos.z, target.x, target.y, target.z)
      this.waypoints = path ?? []
      // drop the first waypoint if it's basically our own feet
      if (this.waypoints.length && Math.hypot(this.waypoints[0].x - pos.x, this.waypoints[0].z - pos.z) < 1.2) {
        this.waypoints.shift()
      }
    }
    while (this.waypoints.length && Math.hypot(this.waypoints[0].x - pos.x, this.waypoints[0].z - pos.z) < 2.2) {
      this.waypoints.shift()
    }
    const wp = this.waypoints[0]
    if (wp) this.seek(wp.x, wp.z, dt, speed)
    else this.seek(target.x, target.z, dt, speed)
  }

  private seek(tx: number, tz: number, dt: number, speed: number): void {
    const pos = this.object.position
    let want = Math.atan2(tx - pos.x, tz - pos.z)
    // steer around tree trunks/rocks: blend an away-vector for obstacles ahead
    const ob = nearestObstacle(pos.x, pos.z, 3.2)
    if (ob) {
      const away = Math.atan2(pos.x - ob.x, pos.z - ob.z)
      let rel = away - want
      while (rel > Math.PI) rel -= Math.PI * 2
      while (rel < -Math.PI) rel += Math.PI * 2
      const closeness = 1 - Math.min(1, ob.d / 3.2)
      want += rel * 0.6 * closeness
    }
    let d = want - this.heading
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    const maxTurn = this.species.turnRate * dt
    this.heading += THREE.MathUtils.clamp(d, -maxTurn, maxTurn)
    const align = 1 - Math.min(1, Math.abs(d) / Math.PI) * 0.7
    this.speed = THREE.MathUtils.lerp(this.speed, speed * align, 1 - Math.exp(-dt * 4))
    pos.x += Math.sin(this.heading) * this.speed * dt
    pos.z += Math.cos(this.heading) * this.speed * dt
  }

  private mixerSkip = 0

  private animate(dt: number, moveT: number, running: boolean): void {
    const target = THREE.MathUtils.clamp(moveT, 0, 1)
    this.moveWeight = THREE.MathUtils.lerp(this.moveWeight, target, 1 - Math.exp(-dt * 8))
    this.runBlend = THREE.MathUtils.lerp(this.runBlend, running ? 1 : 0, 1 - Math.exp(-dt * 6))
    const { idle, walk, run } = this.actions
    if (idle) idle.weight = 1 - this.moveWeight
    if (walk) {
      walk.weight = this.moveWeight * (1 - this.runBlend)
      // a species whose walk slot fell back to its run clip (the T-Rex, the
      // trike's run→walk the other way) plays it at half tempo
      const sameAsRun = run && walk.getClip() === run.getClip()
      walk.timeScale = (0.6 + target * 0.7) * (sameAsRun && this.species.runSpeed > this.species.walkSpeed * 2 ? 0.55 : 1)
    }
    if (run) run.weight = this.moveWeight * this.runBlend
    // distance-throttled animation (the classic skinned-crowd win): far dinos
    // tick their mixers every Nth frame with accumulated dt
    const d = this.distToPlayer
    const every = d > 260 ? 8 : d > 120 ? 3 : 1
    this.mixerSkip += 1
    this.mixerAccum += dt
    if (this.model && !this.model.parent) return // not drawn: no bones to pose
    if (this.mixerSkip >= every) {
      this.mixer?.update(this.mixerAccum)
      this.mixerSkip = 0
      this.mixerAccum = 0
    }
  }

  private mixerAccum = 0
  private distToPlayer = 0
  private castingShadow = true

  private playKo(): void {
    const ko = this.actions.ko
    // a real collapse clip? (the T-Rex GLB has no death — its slot fell back to
    // a roar; the Mammoth's to its idle) — otherwise topple procedurally
    if (ko && /die|death|knock|lying|fall|ko\b/i.test(ko.getClip().name)) {
      ko.reset().setLoop(THREE.LoopOnce, 1).play()
      ko.clampWhenFinished = true
      this.toppleWanted = false
    } else {
      this.toppleWanted = true
    }
  }

  private stopKo(): void {
    this.actions.ko?.stop()
    this.toppleWanted = false
  }

  /** herd pull: main.ts sets this each think from the awake set (same species, within 60 m) */
  herdX = NaN
  herdZ = NaN

  private pickWanderTarget(): void {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2
      const r = this.species.alpha ? 4 + Math.random() * 14 : 8 + Math.random() * 45
      let x = this.home.x + Math.sin(a) * r
      let z = this.home.z + Math.cos(a) * r
      // herbivores drift with their herd: half-way toward the herd's centre
      if (this.species.diet === 'herbivore' && Number.isFinite(this.herdX)) {
        x = (x + this.herdX) * 0.5
        z = (z + this.herdZ) * 0.5
        this.home.set((this.home.x * 3 + this.herdX) / 4, 0, (this.home.z * 3 + this.herdZ) / 4)
      }
      if (heightAt(x, z) < SEA_LEVEL + 1) continue
      if (normalAt(x, z, this.tmpN).y < 0.72) continue
      this.target.set(x, 0, z)
      return
    }
    this.state = 'idle'
    this.stateT = 3
  }

  /** Attach (or re-attach) the mover for riding. The mover is created once and
   *  reused across mounts; while unridden its body is parked far underground
   *  so the idle kinematic capsule can't ghost-block anything. */
  beginRide(physics: Physics): void {
    const cfg: MoverConfig = {
      // wide capsule: the body is much longer than tall — a slim capsule slid
      // around trunks so easily that riding read as "no collisions"
      radius: Math.max(0.5, this.species.height * 0.42),
      halfHeight: this.species.height * 0.3,
      jumpSpeed: 8.5,
      gravityScale: 1.8,
    }
    const p = this.object.position
    const y = p.y + cfg.halfHeight + cfg.radius + 0.1
    if (!this.mover) {
      this.mover = new Mover(physics, cfg, new THREE.Vector3(p.x, y, p.z))
    } else {
      this.mover.teleport(p.x, y, p.z)
    }
    this.ridden = true
  }

  endRide(): void {
    this.ridden = false
    // AI resumes from wherever the ride ended
    this.home.copy(this.object.position)
    this.state = 'tamed'
    this.mover?.teleport(this.object.position.x, -500, this.object.position.z) // park it
  }

  setHeading(h: number): void {
    this.heading = h
  }

  serialize() {
    return {
      species: this.species.id,
      x: this.object.position.x,
      z: this.object.position.z,
      hp: this.hp,
      torpor: this.torpor,
      tame: this.tameProgress,
      state: this.state === 'tamed' ? 'tamed' : 'idle',
      saddled: this.saddled,
      alive: this.object.visible,
    }
  }
}

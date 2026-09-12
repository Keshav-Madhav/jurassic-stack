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
import { findPath, takePathBudget, type PathPoint } from './navmesh'
import { Mover, type MoverConfig } from './mover'
import type { Physics } from './physics'
import type { SpeciesDef } from './species'
import { registerWarmRoot } from './uploads'

export type DinoState = 'idle' | 'wander' | 'aggro' | 'hunt' | 'feed' | 'flee' | 'ko' | 'dead' | 'tamed'

/** What the brain sees each think: the awake herd around it (main.ts fills it once a frame). */
export interface Senses {
  awake: Dino[]
  /** a hit landed somewhere — main.ts sprays blood there */
  onHit: (x: number, y: number, z: number, heavy: boolean) => void
}

const _m4 = /* @__PURE__ */ new THREE.Matrix4()
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
/** `front`: the first rig of a species jumps the queue. The load-time warm-up
 *  waits for one rig of every species before it compiles anything (M33), and
 *  behind ~200 queued clones at four a frame — on boot frames that are already
 *  100 ms long — seven of the eleven species missed the boat and compiled
 *  later, in the frame you first met one. */
function whenMyTurn(front = false): Promise<void> {
  return new Promise((resolve) => {
    if (front) cloneQueue.unshift(resolve)
    else cloneQueue.push(resolve)
    if (!clonePump) { clonePump = true; requestAnimationFrame(pumpClones) }
  })
}
/** every clip name per model URL — the animation audit reads this */
export const clipNamesByModel = new Map<string, string[]>()
/** species whose albedo textures average under sRGB 80 (M29 audit: carno 75, allo 63, mammoth 52) — lifted ONCE on the source */
const DARK_SKIN_LIFT: Record<string, number> = { 'models/dinos/Carnotaurus.glb': 1.55, 'models/dinos/Allosaurus.glb': 1.7, 'models/dinos/Mammoth.glb': 1.6 }
const lifted = new Set<string>()
async function loadModel(url: string) {
  const firstOfSpecies = !modelCache.has(url)
  if (firstOfSpecies) modelCache.set(url, loader.loadAsync(url))
  const gltf = await modelCache.get(url)!
  if (!clipNamesByModel.has(url)) clipNamesByModel.set(url, gltf.animations.map((a) => a.name))
  registerWarmRoot(gltf.scene) // its textures upload before any clone is drawn (M31)
  // MATERIALS ARE SHARED across every clone of a rig (SkeletonUtils.clone
  // keeps them): a multiplicative tweak in load() ran once per clone — 40
  // carnos × 1.6 went pure white (M29). Anything multiplicative happens here,
  // on the source, once.
  if (!lifted.has(url)) {
    lifted.add(url)
    const k = DARK_SKIN_LIFT[url]
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        const mm = m as THREE.MeshStandardMaterial
        if (k) mm.color.multiplyScalar(k)
        // flat-coloured rigs (the Quaternius apato/parasaur): lift toward a real hide albedo (12–25%)
        if (!mm.map) {
          const lum = mm.color.r * 0.2126 + mm.color.g * 0.7152 + mm.color.b * 0.0722
          if (lum < 0.12) mm.color.multiplyScalar(0.14 / Math.max(lum, 0.01))
        }
      }
    })
  }
  await whenMyTurn(firstOfSpecies)
  return { scene: (await import('three/addons/utils/SkeletonUtils.js')).clone(gltf.scene) as THREE.Group, animations: gltf.animations }
}

/** wild dinos beyond SLEEP go dormant; they wake inside WAKE */
const DORMANT_SLEEP = 680
const DORMANT_WAKE = 600
/** an awake dino's rig is only attached (drawn, matrices walked) inside this;
 *  a 3 m animal at 400 m is a few pixels, and the 40-odd awake rigs in the
 *  600 m ring were 170 draw calls whichever way you faced (M18 draw audit) */
const DRAW_DIST = 260 // (380 → 260 M24: a 3 m animal at 260 m is 8 px; each attached rig is ~45 bones walked every frame)
const DRAW_HYST = 30
/** inside RIG_DIST the skinned rig is drawn; between RIG_DIST and DRAW_DIST a cross-card impostor (M25) */
const RIG_DIST = 120
const RIG_HYST = 15
/** how far out an animal asks for its rig clone — well outside DRAW_DIST so
 *  the four-a-frame clone pump always wins the race (M61) */
const RIG_REQUEST = 380

export class Dino {
  /** interpolation factor between the last two physics steps (main loop sets it each frame) */
  static renderAlpha = 1
  /** main.ts hooks this: called once per SPECIES with the first calibrated
   *  rig, to compile its shaders and upload its textures before the rig is
   *  ever drawn (the 1500 rigs load over ~6 s after the scene's warm-up;
   *  a species' first appearance was a 150 ms compile stall — M18) */
  static onFirstRig: ((speciesId: string, model: THREE.Object3D, dino: Dino) => void) | null = null
  /** main.ts hangs the sound bank here: `voice` is what the animal did, not
   *  which file to play — the mapping to samples lives with the mixer (sfx.ts) */
  static onVoice: ((voice: 'call' | 'roar' | 'hurt' | 'die' | 'eat', d: Dino) => void) | null = null
  /** the moment a falling body hits the ground — main.ts makes the noise and the dust */
  static onThud: ((d: Dino) => void) | null = null
  /** the scene the dino's object lives in while awake — a dormant dino's
   *  object is REMOVED from the scene (three walks every object in the graph
   *  every frame: 1500 empty groups were 5.5K objects and ~3 ms — M24) */
  static scene: THREE.Object3D | null = null
  /** the cross-card sprites for the mid band (dino-impostors.ts); null = rigs only */
  static impostors: import('./dino-impostors').DinoImpostors | null = null
  private carded = false
  private cardX = NaN
  private cardZ = NaN
  private cardHeading = NaN
  private static warmed = new Set<string>()
  /** the scale and foot-lift each species' rig needs — identical for every
   *  clone, so it is measured once (M57) */
  private static calib = new Map<string, { scale: number; dy: number; rawH: number }>()
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
  private hurtAction: THREE.AnimationAction | null = null
  private deathActions: THREE.AnimationAction[] = []
  /** the `attack` slot plus whatever else the rig has to hit with */
  private attackActions: THREE.AnimationAction[] = []
  private eatAction: THREE.AnimationAction | null = null
  /** so a burst of hits reads as one flinch rather than a stutter */
  private hurtT = 0
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
  /** THE TOPPLE (rigs without a death clip). Not a linear roll any more: an
   *  animal that goes down carries the direction it was hit from and falls
   *  under something like gravity, overshoots, bounces once and settles — with
   *  a thud when it lands (M41). A real jointed ragdoll per species is a much
   *  bigger job for a body that is only ever seen lying still afterwards. */
  private topple = 0
  private toppleWanted = false
  /** which way it goes over: +1 = its right, -1 = its left */
  private toppleDir = 1
  private toppleVel = 0
  private toppleLanded = false
  /** seconds until a clip-driven collapse hits the ground */
  private thudIn = 0
  /** world position of whatever last hit it, so it falls AWAY from the blow */
  private lastHitX = 0
  private lastHitZ = 0
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

  /** has a clone been asked for? (the rig arrives asynchronously) */
  private loadStarted = false

  /**
   * Ask for this animal's rig, once. A `SkeletonUtils.clone` is ~120 KB of
   * `Bone` objects and the island holds 1515 animals — 180 MB of skeletons,
   * measured in M57 — while a rig is only ever DRAWN inside 135 m (past that
   * it is a cross-card, and past 260 m nothing at all). So the clone is asked
   * for when the animal comes within `RIG_REQUEST`, not when it spawns; the
   * clone pump's four-a-frame pacing then does what it has always done (M61).
   */
  ensureRig(): void {
    if (this.loadStarted) return
    this.loadStarted = true
    void this.load()
  }

  async load(): Promise<void> {
    this.loadStarted = true
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
        // MATERIAL SANITY (M29 albedo audit): the Quaternius rigs ship
        // metalness 0.4–0.5 (untextured: metal kills diffuse, so a 0.12-linear
        // apato rendered near-black), the pachy roughness 0 (a mirror), and
        // several flat colours at 6–12% albedo. No dinosaur is metal.
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          const mm = m as THREE.MeshStandardMaterial
          mm.metalness = 0
          mm.roughness = Math.max(mm.roughness, 0.55)

          mm.needsUpdate = true
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

    this.clips = animations
    // THE MIXER IS BUILT ON DEMAND (M60). One `AnimationMixer` with up to five
    // bound actions, their interpolants and their parsed track names costs
    // roughly 0.1 MB per animal, and there are 1515 animals on this island —
    // 156 MB of the heap, named by Chrome's sampling profiler in M57 — and the
    // vast majority of it belongs to animals the player never goes near
    // (measured: 333 of 1515 ever build one in a session). Only the FIRST
    // clone of a species builds one here, because calibration needs a posed
    // frame; everything else gets one shortly before it wakes, from a budgeted
    // pass, so no animal is ever drawn in its bind pose.
    if (!Dino.calib.has(this.species.id)) this.buildAnim()


    // Size + ground calibration, in ANIMATED pose. Order matters: several
    // Sketchfab rigs carry scale/position tracks on their root nodes, so the
    // first animation frame re-scales the skeleton — normalizing from the
    // bind-pose bbox made trikes and the rex spawn at kaiju scale. Apply one
    // idle frame first, THEN normalize height from the true skinned bounds,
    // then drop feet to ground from those same bounds.
    //
    // ONCE PER SPECIES, NOT ONCE PER ANIMAL (M57). Both numbers this produces
    // — the scale that makes the rig `species.height` tall, and the lift that
    // puts its feet on the object's origin — are properties of the GLB, so
    // every clone of a species arrives at exactly the same two floats. Each
    // `skinnedBounds` call walks up to 2500 vertices through `getVertexPosition`
    // (skinning maths per vertex), and this ran TWICE for each of ~200 clones.
    // The cull spheres below have been cached per species since M18 for the
    // same reason; this is the other half of that fix.
    let calib = Dino.calib.get(this.species.id)
    if (!calib) {
      this.mixer?.update(0.01) // built above for the first clone of a species
      this.object.updateMatrixWorld(true)
      const bounds = this.skinnedBounds(model)
      if (bounds) {
        const s = this.species.height / Math.max(0.01, bounds.max.y - bounds.min.y)
        model.scale.setScalar(s)
        this.object.updateMatrixWorld(true)
        const b2 = this.skinnedBounds(model)
        const groundY = this.object.getWorldPosition(new THREE.Vector3()).y
        const dy = b2 ? -(b2.min.y - groundY) : 0
        model.position.y += dy
        calib = { scale: s, dy, rawH: +(bounds.max.y - bounds.min.y).toFixed(2) }
        Dino.calib.set(this.species.id, calib)
      }
    } else {
      model.scale.setScalar(calib.scale)
      model.position.y += calib.dy
    }
    if (calib) this.debugCalib = { rawH: calib.rawH, scale: +calib.scale.toFixed(3) }
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
      Dino.onFirstRig(this.species.id, model, this)
    }
    // A CLONE THAT LANDS ON AN ANIMAL YOU CAN SEE MUST ARRIVE ANIMATED.
    // `setRig` leaves the model ATTACHED unless the animal is dormant, and the
    // clone pump runs on its own requestAnimationFrame — so a rig could land
    // after the frame's dino updates and before the render, and be drawn once
    // in its BIND POSE before `update()` reached the guard that builds the
    // mixer. One frame, at 380 m, a few pixels wide — and still a hole in the
    // invariant, caught by flying across the island and watching `unanimated`
    // rather than by any gate (M63). A dormant animal still waits: it is
    // detached, nothing can draw it, and that is where the saving lives.
    if (this.dormant) this.object.remove(model)
    else this.buildAnim()
  }


  /** the rig's clips, kept so the mixer can be built later (M60) */
  private clips: THREE.AnimationClip[] = []

  /** the frame's allowance for building mixers ahead of the wake radius */
  static animBudget = 2

  /**
   * Build this animal's mixer and actions. Idempotent. An animal without one
   * simply holds its bind pose — and a dormant animal is DETACHED from the
   * scene (M24), so nothing draws it while it waits.
   */
  private buildAnim(): void {
    if (this.mixer || !this.model) return
    const model = this.model
    const animations = this.clips
    this.mixer = new THREE.AnimationMixer(model)
    const oc = this.species.oneClip
    if (oc) {
      // ONE animation, ONE action, a changing RATE. The first cut gave each
      // slot its own action on a clone of the same clip; `animate()` then
      // cross-faded three of them, and averaging one pose against itself at
      // three different times collapsed the Sauropelta into a flat lump
      // (M52). A single action, re-timed by state, is what a one-clip rig
      // actually wants — the pose is never blended with anything.
      const clip = animations.filter((a) => a.duration > 0.5).sort((a, b) => b.tracks.length - a.tracks.length)[0]
      if (clip) {
        const act = this.mixer.clipAction(clip)
        act.timeScale = oc.idle
        this.actions.idle = act
      }
    } else {
      for (const slot of ['idle', 'walk', 'run', 'attack', 'ko'] as const) {
        const clip = animations.find((a) => this.species.clips[slot].test(a.name))
        if (clip) this.actions[slot] = this.mixer.clipAction(clip)
      }
    }
    if (this.species.eatClip) {
      const clip = animations.find((a) => this.species.eatClip!.test(a.name))
      if (clip) { this.eatAction = this.mixer.clipAction(clip); this.eatAction.setLoop(THREE.LoopOnce, 1) }
    }
    if (this.actions.attack) this.attackActions.push(this.actions.attack)
    for (const re of this.species.attackClips ?? []) {
      const clip = animations.find((a) => re.test(a.name))
      if (clip) this.attackActions.push(this.mixer.clipAction(clip))
    }
    for (const re of this.species.deathClips ?? []) {
      const clip = animations.find((a) => re.test(a.name))
      if (clip) {
        const a = this.mixer.clipAction(clip)
        a.setLoop(THREE.LoopOnce, 1)
        a.clampWhenFinished = true
        this.deathActions.push(a)
      }
    }
    if (this.species.hurtClip) {
      const clip = animations.find((a) => this.species.hurtClip!.test(a.name))
      if (clip) {
        this.hurtAction = this.mixer.clipAction(clip)
        this.hurtAction.setLoop(THREE.LoopOnce, 1)
      }
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
  }

  /** Warm-up: attach the rig for one compile pass; returns a detach callback (or null if already attached / not loaded). */
  /** the loaded rig, for the load-time warm-up (impostor capture) */
  get rig(): THREE.Object3D | null {
    return this.model
  }

  /** the warm-up handled this species: don't fire onFirstRig for it later */
  static markWarmed(id: string): void {
    Dino.warmed.add(id)
  }

  /** how many species have had their rig compiled, textures uploaded and card
   *  captured — the boot card waits on this before it lets the player in */
  static get warmedCount(): number {
    return Dino.warmed.size
  }

  /** Put this rig where the warm-up's compile can SEE it. `renderer.compile`
   *  walks the scene with traverseVisible, and at load most dinos are dormant
   *  and their whole object is detached (M24) — so hanging the model on a
   *  detached object compiled nothing, and the species' materials compiled
   *  later, in whatever frame you first met one: a 40-100 ms freeze (M33). */
  attachForWarmup(): (() => void) | null {
    if (!this.model || !Dino.scene) return null
    // IS THE RIG ACTUALLY IN THE SCENE? Having a parent proves nothing: a
    // dormant dino keeps its model on its object and DETACHES THE OBJECT
    // (M24), so `model.parent` is set while nothing is drawn. The old check
    // bailed on exactly those animals — which is every animal at load — and
    // their skinned depth programs were left to compile in play (M34).
    let root: THREE.Object3D = this.model
    while (root.parent) root = root.parent
    if (root === Dino.scene) return null // already live
    const model = this.model
    const addedModel = model.parent === null
    if (addedModel) this.object.add(model)
    const parkedObject = this.object.parent === null
    if (parkedObject) Dino.scene.add(this.object)
    if (!addedModel && !parkedObject) return null
    return () => {
      if (addedModel) this.object.remove(model)
      if (parkedObject) this.object.parent?.remove(this.object)
    }
  }

  /** QA (M60): an animal that can be drawn but has no mixer would stand in its
   *  bind pose. The invariant is that this is never true; gate-ecology asserts it. */
  get unanimated(): boolean {
    return !this.dormant && !!this.model && !this.mixer
  }

  /** QA (M61): an animal inside the draw distance with no rig at all is a hole
   *  in the world. The clone is asked for 120 m further out than this. */
  get unrigged(): boolean {
    return !this.dormant && !this.model && this.distToPlayer < DRAW_DIST
  }

  /** QA: how many animals hold a rig clone — the memory M61 is about */
  get hasRig(): boolean {
    return !!this.model
  }

  /** QA: how many animals hold a mixer — the memory this lever is about */
  get hasAnim(): boolean {
    return !!this.mixer
  }

  /** QA: which clip each slot resolved to (null = the species regex matched nothing) */
  clipReport(): Record<string, string | null> {
    const out: Record<string, string | null> = {}
    for (const slot of ['idle', 'walk', 'run', 'attack', 'ko'] as const) out[slot] = this.actions[slot]?.getClip().name ?? null
    out.hurt = this.hurtAction?.getClip().name ?? null
    out.eat = this.eatAction?.getClip().name ?? null
    return out
  }

  /** QA: is this animal's flinch bound, and is it playing right now? */
  flinchState(): { bound: boolean; running: boolean; declared: boolean; seconds: number; at: number } {
    return {
      declared: !!this.species.hurtClip,
      bound: !!this.hurtAction,
      running: !!this.hurtAction?.isRunning(),
      seconds: +(this.hurtAction?.getClip().duration ?? 0).toFixed(2),
      at: +(this.hurtAction?.time ?? 0).toFixed(2),
    }
  }

  /** QA: where the rig's high parts sit relative to the heading — INDICATIVE
   *  ONLY, and the history is worth keeping (M85). It reads as a facing test
   *  and is not one: the top fifth of the body is the head on a long-necked
   *  apatosaur and a raised TAIL on a raptor, the plates on a stego, the sail
   *  on a spino. Measured off the animated pose it also moved with the
   *  stride (stego +0.18 one run, -0.26 the next). It is deterministic now —
   *  the bind attribute, and a ratio, so the scale some of these rigs carry
   *  on their bones cancels — but deterministic is not correct: it puts the
   *  raptor at -0.19 and the trike at -0.36, both verified walking forwards
   *  in side-on portraits. NOTHING GATES ON THIS. The real facing test is
   *  the head-BONE probe in gate-m4, which covers the twelve rigs that name
   *  their bones; the other four (carno, spino, trike, sauropelta) are
   *  checked by eye with `qa-dinos.mjs`, which frames them walking. */
  headSide(): number | null {
    if (!this.model) return null
    // ONLY A LIVE ANIMAL CAN BE MEASURED. A dormant one keeps its model but
    // its skeleton is not updated and not drawn, so the skinned vertices come
    // back in whatever pose and place its bones were last left in — rotated,
    // not merely displaced, which silently corrupts the body's long axis as
    // well as its position. Read that way the roster-wide audit was noise
    // (apato "walking backwards" at -0.60 against a head bone the M83 probe
    // put squarely on +z) and the seat measurements were metres out. The
    // caller has to bring the animal close enough to be alive first.
    if (this.dormant || !this.mixer) return null

    const detached = !this.model.parent
    if (detached) this.object.add(this.model)
    this.object.updateMatrixWorld(true)
    // MEASURE IN THE OBJECT'S OWN FRAME, not the world's. This used to
    // project onto `this.heading`, and for a DORMANT animal the heading has
    // moved on while `object.rotation.y` was last written whenever it was
    // still awake — so the two disagree and the ratio is noise. It reported
    // apato at -0.60, "walking backwards", against a head bone that the M83
    // probe put squarely on +z. In object space the only rotation left is
    // `facingOffset`, which is a constant.
    const inv = _m4.copy(this.object.matrixWorld).invert()
    const pts: THREE.Vector3[] = []
    const v = new THREE.Vector3()
    let maxY = -Infinity, minY = Infinity
    this.model.traverse((o) => {
      if (!(o instanceof THREE.SkinnedMesh) || !o.visible) return
      const count = o.geometry.attributes.position.count
      const step = Math.max(1, Math.floor(count / 3000))
      const pos = o.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < count; i += step) {
        // THE BIND POSE, DELIBERATELY. This is a RATIO — how far along the
        // body the top fifth sits, over the body's own half-length — so the
        // scale that some of these rigs carry on their BONES rather than
        // their mesh node cancels out, and reading the bind attribute instead
        // of the skinned one makes the answer the same on every run. Skinned,
        // it moved with the animal's stride: the stego read +0.18 one run and
        // -0.26 the next, which is a gate that fails at random.
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv)
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
    // travel, in object space: the object carries `heading + facingOffset`, so
    // the heading direction inside that frame is a turn of -facingOffset
    const off = -(this.species.facingOffset ?? 0)
    const fx = Math.sin(off), fz = Math.cos(off)
    const along = (hx / n - cx) * fx + (hz / n - cz) * fz
    const span = Math.max(...pts.map((p) => Math.abs((p.x - cx) * fx + (p.z - cz) * fz)))
    return along / (span || 1)
  }

  /** QA: where the animal's BACK is, in the space the saddle seat is authored
   *  in (M84). Three earlier attempts at this measured the wrong thing:
   *  bone positions are unusable (most of these rigs are authored in
   *  centimetres and their skeletons are not all inside the rig subtree —
   *  apato's "spine" read -1647), and a bounding box taken while the animal
   *  is dormant is read off a skeleton nobody has updated, so its size was
   *  right and its position nonsense. The torso is the middle of the body
   *  along its long
   *  axis: include the neck and a long-necked apato reports a saddle four
   *  metres in the air, include the tail and a stego reports one in the mud. */
  backProbe(): Record<string, number | string> | null {
    if (!this.model) return null
    if (this.dormant || !this.mixer) return null // see headSide: dormant is unmeasurable

    const detached = !this.model.parent
    if (detached) this.object.add(this.model)
    this.object.updateMatrixWorld(true)
    const inv = _m4.copy(this.object.matrixWorld).invert()
    const pts: THREE.Vector3[] = []
    const v = new THREE.Vector3()
    this.model.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !o.visible) return
      const pos = o.geometry.attributes.position
      if (!pos) return
      const step = Math.max(1, Math.floor(pos.count / 2500))
      for (let i = 0; i < pos.count; i += step) {
        // EVERY NUMBER OUT OF HERE IS RELATIVE TO THE MODEL'S OWN EXTENT,
        // and it has to be. A dormant animal keeps its model on its object
        // and DETACHES THE OBJECT (the same trap attachForWarmup() documents),
        // so the skinned vertices come back displaced by wherever the parked
        // object last stood — carno read a back height of -248 m. Reading the
        // raw bind-pose attribute instead fixes the offset and breaks the
        // scale, because on several of these rigs the centimetre-to-metre
        // scaling lives on the BONES, not on the mesh node (alpharex then
        // measured 1 cm tall). So: keep the skinned read, which gets the
        // shape right, and only ever report differences.
        o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).applyMatrix4(inv)
        pts.push(v.clone())
      }
    })
    if (detached) this.object.remove(this.model)
    if (pts.length < 20) return null
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
    // the body's long axis, whichever way round the rig was authored
    const spanX = maxX - minX, spanZ = maxZ - minZ
    const useZ = spanZ >= spanX
    const lo = useZ ? minZ : minX, hi = useZ ? maxZ : maxX
    const mid = (lo + hi) / 2, half = (hi - lo) * 0.22
    let backY = -Infinity, along = 0, n = 0
    for (const p of pts) {
      const a = useZ ? p.z : p.x
      if (a < mid - half || a > mid + half) continue
      backY = Math.max(backY, p.y)
      along += a; n++
    }
    if (!n) return null
    return {
      axis: useZ ? 'z' : 'x',
      /** the mid-body back, measured up from the animal's lowest point — the
       *  same origin the saddle seat is authored from (the object sits at the
       *  animal's feet) */
      backAboveFeet: +(backY - minY).toFixed(2),
      /** the same surface in the object's own coordinates, which is the space
       *  the seat is authored in */
      backY: +backY.toFixed(2),
      /** where along the body the torso sample sits, in object coordinates */
      torsoAlong: +(along / n).toFixed(2),
      footY: +minY.toFixed(2),
      /** how far the sampled torso sits from the body's own centre: a sanity
       *  check on the window, not a measurement of anything */
      torsoOffset: +(along / n - mid).toFixed(2),
      length: +Math.max(spanX, spanZ).toFixed(2),
      height: +(maxY - minY).toFixed(2),
    }
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

  /** QA: colour + texture-average per material (how dark does this species ship?) */
  albedoReport(): string[] {
    const out: string[] = []
    this.model?.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        const mm = m as THREE.MeshStandardMaterial
        let avg: string = 'none'
        const img = mm.map?.image as HTMLImageElement | ImageBitmap | undefined
        if (img && (img as HTMLImageElement).width) {
          const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32
          const ctx = cv.getContext('2d')!
          try { ctx.drawImage(img as CanvasImageSource, 0, 0, 32, 32); const d = ctx.getImageData(0, 0, 32, 32).data; const s = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2] }; avg = s.map((v) => Math.round(v / 1024)).join(',') } catch { avg = 'x' }
        }
        out.push(`${mm.type.replace('Mesh', '')} col=${mm.color.toArray().map((v) => v.toFixed(2)).join(',')} mapAvg=${avg} rough=${mm.roughness.toFixed(2)} metal=${mm.metalness.toFixed(2)} emis=${mm.emissive.toArray().map((v) => v.toFixed(2)).join(',')}`)
      }
    })
    return out
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
  /** Play the rig's flinch, if it has one. Rate-limited: a spear volley used
   *  to be four resets inside half a second, which reads as a stutter. */
  private flinch(): void {
    if (!this.hurtAction || this.hurtT > 0) return
    this.hurtT = 0.55
    this.hurtAction.reset().setLoop(THREE.LoopOnce, 1)
    this.hurtAction.timeScale = 1.15
    this.hurtAction.play()
  }

  takeHit(damage: number, torporGain: number, fromX: number, fromZ: number): void {
    if (this.state === 'ko' || this.state === 'tamed') return
    this.lastHitX = fromX
    this.lastHitZ = fromZ
    this.hp -= damage
    this.torpor += torporGain
    if (this.hp <= 0) {
      // killed: a carcass lies there a while (ragdolls arrive at M7)
      this.die()
      return
    }
    if (this.torpor >= this.species.torporMax) {
      // the blow that drops it is still a blow: an animal that goes down in
      // silence reads as a bug, not a knockout (M53)
      this.say('hurt')
      this.state = 'ko'
      this.foe = null
      this.playKo()
      return
    }
    this.say('hurt')
    this.flinch()
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

  /** Ground clamp, slope pitch and the topple — everything a body does with
   *  the floor. Extracted (M41) because `case 'dead'` RETURNED before reaching
   *  it: the procedural topple only ever ran on knocked-out animals, and a
   *  killed one with no death clip stood there like a statue. */
  private settle(dt: number, pos: THREE.Vector3): void {
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
    if (this.thudIn > 0) {
      this.thudIn -= dt
      if (this.thudIn <= 0 && !this.toppleLanded) { this.toppleLanded = true; Dino.onThud?.(this) }
    }
    // the topple: a fall, not a fade. It accelerates like a felled tree, lands,
    // bounces once off its own mass and settles (M41)
    if (this.toppleWanted) {
      if (this.topple < 1) {
        // the further over it goes the harder gravity pulls — a pendulum past
        // its balance point, scaled by how tall the animal is
        this.toppleVel += (1.6 + 2.4 * this.topple) * dt * (2.6 / Math.max(1.2, this.species.height * 0.5))
        this.topple += this.toppleVel * dt
        if (this.topple >= 1) {
          this.topple = 1
          if (this.toppleVel > 0.8) {
            this.toppleVel = -this.toppleVel * 0.22 // it comes back up a little
            if (!this.toppleLanded) {
              this.toppleLanded = true
              Dino.onThud?.(this)
            }
          } else {
            this.toppleVel = 0
            if (!this.toppleLanded) { this.toppleLanded = true; Dino.onThud?.(this) }
          }
        }
      } else if (this.toppleVel < 0) {
        this.topple += this.toppleVel * dt
        this.toppleVel += 5.5 * dt
        if (this.topple > 1) { this.topple = 1; this.toppleVel = 0 }
      }
    } else if (this.topple > 0) {
      this.topple = Math.max(0, this.topple - dt / 0.5) // it gets back up (a tamed KO)
    }
    if (this.topple > 0) {
      const t = Math.min(1, this.topple)
      this.object.rotation.z = -1.45 * t * this.toppleDir
      this.object.rotation.x += -0.22 * t // and noses down as it goes
      pos.y -= this.species.height * 0.2 * t
    } else this.object.rotation.z = 0
  }

  update(dt: number, playerPos: THREE.Vector3, attackPlayer: (damage: number, from?: Dino) => void, senses?: Senses): void {
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
        if (Dino.scene && !this.object.parent) Dino.scene.add(this.object)
      } else {
        // AHEAD OF THE WAKE RADIUS, A FEW A FRAME. Building the mixer is a few
        // milliseconds of parsing track names and binding them to bones, and
        // doing it at the moment of waking would put that in the frame an
        // animal appears — the exact hitch this project keeps removing. So it
        // happens in the ring OUTSIDE the wake radius, on a budget, the same
        // shape as the upload warden and the collider builder (M60).
        if (!this.mixer && this.model && Dino.animBudget > 0 && this.distToPlayer < DORMANT_WAKE + 90) {
          Dino.animBudget--
          this.buildAnim()
        }
        return
      }
    } else if (wildIdle && this.distToPlayer > DORMANT_SLEEP) {
      this.dormant = true
      if (this.model) this.object.remove(this.model)
      this.object.parent?.remove(this.object)
      if (this.carded) { Dino.impostors?.clear(this.species.id, this.index); this.carded = false }
      return
    }
    // AWAKE AND CLOSING: ask for the rig long before anything wants to draw
    // it. RIG_REQUEST is 120 m outside DRAW_DIST, which at a sprint is fifteen
    // seconds of warning for a queue that drains four a frame (M61).
    if (!this.loadStarted && this.distToPlayer < RIG_REQUEST) this.ensureRig()
    // AWAKE MEANS ANIMATED. Everything below this line can be drawn, so the
    // mixer must exist by now whatever route got us here — waking from
    // dormancy, being a tame that is never dormant at all, or simply standing
    // near the player at load. The budgeted pass above is an optimisation on
    // WHEN this happens, never on whether (M60: without this line the animals
    // within sleep range of the spawn beach stood in their bind pose).
    if (!this.mixer && this.model) this.buildAnim()
    // draw bands: the rig inside RIG_DIST, a cross-card impostor to DRAW_DIST,
    // nothing beyond (all with hysteresis). Ridden mounts are always the rig.
    if (this.model && !this.ridden) {
      const attached = !!this.model.parent
      const imp = Dino.impostors
      const canCard = imp !== null && imp.has(this.species.id) && this.state !== 'dead' && this.state !== 'ko'
      const wantRig = canCard ? this.distToPlayer < RIG_DIST + (attached ? RIG_HYST : 0) : this.distToPlayer < DRAW_DIST + (attached ? DRAW_HYST : 0)
      if (attached && !wantRig) this.object.remove(this.model)
      else if (!attached && wantRig) this.object.add(this.model)
      const wantCard = canCard && !wantRig && this.distToPlayer < DRAW_DIST + (this.carded ? DRAW_HYST : 0)
      if (wantCard) {
        // (re)place the card only when the animal has moved or turned
        if (!this.carded || Math.abs(pos.x - this.cardX) > 0.25 || Math.abs(pos.z - this.cardZ) > 0.25 || Math.abs(this.heading - this.cardHeading) > 0.08) {
          imp!.set(this.species.id, this.index, pos.x, pos.y, pos.z, this.heading + (this.species.facingOffset ?? 0))
          this.cardX = pos.x; this.cardZ = pos.z; this.cardHeading = this.heading
          this.carded = true
        }
      } else if (this.carded) {
        imp?.clear(this.species.id, this.index)
        this.carded = false
      }
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
        this.settle(dt, pos) // it falls, lands and settles — see settle()
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
          if (this.eatAction) { this.eatAction.reset().setLoop(THREE.LoopOnce, 1); this.eatAction.weight = 1; this.eatAction.play() }
          else this.playAttack(0.6)
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
        // a quarrel first: chase the enemy down, bite it, and never stray more
        // than 40 m from the person you are protecting
        const foe = this.guardFoe
        if (foe) {
          this.guardT -= dt
          const gone = foe.state === 'dead' || foe.state === 'ko' || foe.dormant
          const strayed = pos.distanceTo(playerPos) > 40
          if (this.guardT <= 0 || gone || strayed || this.ridden) {
            this.guardFoe = null
            this.waypoints.length = 0
          } else {
            const fp = foe.object.position
            const fd = pos.distanceTo(fp)
            const reach = this.species.attackRange + foe.species.height * 0.45
            if (fd <= reach) {
              this.speed = Math.max(0, this.speed - 10 * dt)
              this.waypoints.length = 0
              const want = Math.atan2(fp.x - pos.x, fp.z - pos.z)
              let dd = want - this.heading
              while (dd > Math.PI) dd -= Math.PI * 2
              while (dd < -Math.PI) dd += Math.PI * 2
              this.heading += THREE.MathUtils.clamp(dd, -this.species.turnRate * dt, this.species.turnRate * dt)
              if (this.attackCooldown <= 0) {
                this.attackCooldown = 1.4
                this.playAttack(1)
                foe.takeHitFrom(this, this.species.attackDamage)
                senses?.onHit(fp.x, fp.y + foe.species.height * 0.5, fp.z, this.species.attackDamage > 30)
              }
            } else {
              this.seek(fp.x, fp.z, dt, this.species.runSpeed)
            }
            break
          }
        }
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
            this.playAttack(1)
            if (foe && !foeGone) {
              foe.takeHitFrom(this, this.species.attackDamage)
              senses?.onHit(foe.object.position.x, foe.object.position.y + foe.species.height * 0.5, foe.object.position.z, this.species.attackDamage > 30)
            } else {
              attackPlayer(this.species.attackDamage, this)
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

    this.settle(dt, pos)
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
    this.say('roar')
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
    // an animal at rest says something now and then — about once a minute each,
    // and the mixer's own distance cull keeps the far herd silent
    if (Math.random() < 0.008) this.say('call')
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
        this.say('roar')
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
    this.lastHitX = attacker.object.position.x
    this.lastHitZ = attacker.object.position.z
    this.say('hurt')
    if (this.state === 'dead' || this.state === 'ko' || this.state === 'tamed') {
      if (this.state === 'tamed') this.hp -= damage // a tame can be hurt; it fights back below
      else return
    }
    this.hp -= damage
    if (this.hp <= 0) { this.die(); return }
    this.flinch()
    if (this.state === 'tamed') { this.guard(attacker); return }
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
  /** QA: drop it where it stands, as a killing blow from (x, z) would */
  kill(fromX?: number, fromZ?: number): void {
    if (fromX !== undefined && fromZ !== undefined) { this.lastHitX = fromX; this.lastHitZ = fromZ }
    if (this.state !== 'dead') this.die()
  }

  /** speak, if anything is listening */
  private say(voice: 'call' | 'roar' | 'hurt' | 'die' | 'eat'): void {
    Dino.onVoice?.(voice, this)
  }

  private die(): void {
    this.say('die')
    this.state = 'dead'
    this.deadT = 75
    this.speed = 0
    this.foe = null
    this.waypoints.length = 0
    this.harvestLeft = Math.max(2, Math.round(this.species.height * 2.2)) // a raptor gives 3 swings, a rex 10
    this.playDeath()
  }

  /** swings of meat + hide left in this carcass (dead only) */
  harvestLeft = 0

  /** Harvest a carcass with a blade: one swing → meat (+ hide every other). Returns what came off, or null. */
  harvest(): { rawmeat: number; hide: number; fur: number } | null {
    if (this.state !== 'dead' || this.harvestLeft <= 0) return null
    this.harvestLeft--
    const big = this.species.height >= 3
    const out = {
      rawmeat: big ? 2 : 1,
      hide: this.harvestLeft % 2 === 0 ? 1 : 0,
      // a shaggy animal also gives fur — the only source of the coat (M50)
      fur: this.species.furry ? (big ? 2 : 1) : 0,
    }
    if (this.harvestLeft <= 0) { this.object.visible = false; this.deadT = 0 }
    return out
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
    // A recast query is milliseconds, and a herd that all turns at once used to
    // run every one of them in the same frame — 25-40 ms of `dinos` in a frame
    // with nothing on screen to explain it (M55, tools/qa-trek.mjs). The frame
    // has a budget; an animal refused a slot KEEPS THE ROUTE IT HAS and asks
    // again next frame, which is invisible, where forgetting the route is not.
    if (this.repathT <= 0 && takePathBudget()) {
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
    const oc = this.species.oneClip
    if (oc) {
      // the single cycle, re-timed: still → idle rate, moving → walk, fast → run
      const act = this.actions.idle
      if (act) {
        this.moveWeight = THREE.MathUtils.lerp(this.moveWeight, target, 1 - Math.exp(-dt * 8))
        this.runBlend = THREE.MathUtils.lerp(this.runBlend, running ? 1 : 0, 1 - Math.exp(-dt * 6))
        const moving = THREE.MathUtils.lerp(oc.walk, oc.run, this.runBlend)
        act.weight = 1
        act.timeScale = THREE.MathUtils.lerp(oc.idle, moving, this.moveWeight)
      }
      if (this.hurtT > 0) this.hurtT -= dt
      const d0 = this.distToPlayer
      const every0 = d0 > 260 ? 8 : d0 > 120 ? 3 : 1
      this.mixerSkip += 1
      this.mixerAccum += dt
      if (this.model && !this.model.parent) return
      if (this.mixerSkip >= every0) {
        this.mixer?.update(this.mixerAccum)
        this.mixerSkip = 0
        this.mixerAccum = 0
      }
      return
    }
    if (this.hurtT > 0) this.hurtT -= dt
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

  /** One blow, picked from whatever the rig can throw. `timeScale` is the
   *  caller's: a feeding bite runs slow, a fight's does not. */
  private playAttack(timeScale: number): void {
    const n = this.attackActions.length
    if (!n) return
    const a = this.attackActions[n === 1 ? 0 : Math.floor(Math.random() * n)]
    a.reset().setLoop(THREE.LoopOnce, 1)
    a.timeScale = timeScale
    a.weight = 1
    a.play()
  }

  /** QA: how many different blows this animal has. */
  attackCount(): number { return this.attackActions.length }

  /** DYING IS NOT BEING KNOCKED OUT. Four rigs carry both and used to play
   *  the knockout for both — a raptor with Death_01 and Death_02 in it went
   *  down in its "Knocked Down" pose every time. Everything else still falls
   *  through to the knockout clip, or to the procedural topple behind it. */
  private playDeath(): void {
    if (!this.deathActions.length) { this.playKo(); return }
    const a = this.deathActions[Math.floor(Math.random() * this.deathActions.length)]
    a.reset().setLoop(THREE.LoopOnce, 1)
    a.clampWhenFinished = true
    a.weight = 1
    a.play()
    // whatever it was doing stops fighting the collapse
    for (const slot of ['idle', 'walk', 'run'] as const) { const o = this.actions[slot]; if (o) o.weight = 0 }
    this.hurtAction?.stop()
    this.toppleWanted = false
    this.thudIn = 0.55
    this.toppleLanded = false
  }

  /** QA: which collapse this animal would play, and whether it is playing. */
  deathState(): { declared: number; bound: number; running: boolean; clip: string | null } {
    const live = this.deathActions.find((a) => a.isRunning())
    return {
      declared: this.species.deathClips?.length ?? 0,
      bound: this.deathActions.length,
      running: !!live,
      clip: live?.getClip().name ?? null,
    }
  }

  private playKo(): void {
    const ko = this.actions.ko
    // a real collapse clip? (the T-Rex GLB has no death — its slot fell back to
    // a roar; the Mammoth's to its idle) — otherwise topple procedurally
    if (ko && /die|death|knock|lying|fall|ko\b/i.test(ko.getClip().name)) {
      ko.reset().setLoop(THREE.LoopOnce, 1).play()
      ko.clampWhenFinished = true
      this.toppleWanted = false
      // a clip-driven collapse lands too — the thud is not the topple's alone
      this.thudIn = 0.55
      this.toppleLanded = false
    } else {
      // away from the blow: the cross product of "which way it faces" and
      // "which way the hit came from" gives the side it falls on
      const dx = this.object.position.x - this.lastHitX
      const dz = this.object.position.z - this.lastHitZ
      const side = Math.cos(this.heading) * dx - Math.sin(this.heading) * dz
      this.toppleDir = side >= 0 ? 1 : -1
      this.toppleVel = 0.55 + Math.random() * 0.5
      this.toppleLanded = false
      this.toppleWanted = true
    }
  }

  private stopKo(): void {
    this.actions.ko?.stop()
    this.toppleWanted = false
  }

  /** A tame's quarrel: who it is defending its owner from, and for how long.
   *  Tames used to stand and take it — the comment in takeHitFrom even claimed
   *  they fought back, and the line under it returned instead (M36). */
  private guardFoe: Dino | null = null
  private guardT = 0

  /** Set this tame on an enemy (its owner was bitten, or swung first). */
  guard(foe: Dino, seconds = 22): void {
    if (this.state !== 'tamed' || this.ridden || foe === this) return
    if (foe.state === 'dead' || foe.state === 'ko' || foe.state === 'tamed') return
    if (this.guardFoe === foe) { this.guardT = Math.max(this.guardT, seconds); return }
    this.guardFoe = foe
    this.guardT = seconds
    this.say('roar')
  }

  /** is this tame currently fighting for you? (HUD/QA) */
  get guarding(): boolean {
    return this.guardFoe !== null
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

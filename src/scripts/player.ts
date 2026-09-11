// Player: reads input, produces mover intent relative to the camera's yaw,
// and owns the visible character — a Quaternius "Casual2" human (CC0),
// recolored at load into a bare castaway (shirtless, barefoot, ragged
// shorts). States: idle/walk/run/air/swim, one-shot swings by held tool
// (punch / chop / throw), idle-astride while riding.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { Input } from './input'
import { Mover, PLAYER_MOVER } from './mover'
import type { Physics } from './physics'
import type { ItemId } from './items'
import { registerWarmRoot } from './uploads'

const WALK_SPEED = 4.4
const SPRINT_SPEED = 8.0
const SWIM_SPEED = 3.4
const DIVE_SPEED = 3.2
const CURRENT_SPEED = 2.2
const HEIGHT = 1.75
/** where the swim pitch hinges: roughly the hips, in metres above the feet */
const PIVOT_Y = 0.95

type ClipSlot = 'idle' | 'armed' | 'walk' | 'run' | 'back' | 'left' | 'right' | 'air' | 'sit' | 'punch' | 'chop' | 'throw' | 'hurt' | 'interact'
// Quaternius "Casual2" castaway — clip names carry an armature prefix, so match by suffix
/** where each tool sits in the fist: metres and radians */
const HELD_POSE: Partial<Record<ItemId, { pos: [number, number, number]; rot: [number, number, number]; size: number }>> = {
  // Measured, not guessed (M84): heldProbe() reports the tool's long axis in
  // the PLAYER's frame, so these were chosen from the direction they produce.
  // All three used to share one rotation, which laid every tool out along the
  // same forward horizontal — a 2.1 m spear carried like a couched lance
  // through the scenery, and a torch burning sideways.
  hatchet: { pos: [0, 0.05, 0], rot: [0, 0, Math.PI / 2], size: 0.55 }, // out front, blade forward
  spear: { pos: [0, 0.1, 0], rot: [2.5, 0, 0.9], size: 2.1 }, // shouldered, tip up 50°
  torch: { pos: [0, 0.06, 0], rot: [2.9, 0, 0.2], size: 0.8 }, // upright, flame up
}

/** the size the kit model is normalised to, per item */
export const HELD_SIZE: Partial<Record<ItemId, number>> = { hatchet: 0.55, spear: 2.1, torch: 0.8 }

const CLIP_MATCH: Record<ClipSlot, RegExp> = {
  idle: /(^|\|)Idle_Neutral$/,
  armed: /(^|\|)Idle_Sword$/, // tool in hand: a ready stance, not the empty-handed idle
  walk: /(^|\|)Walk$/,
  run: /(^|\|)Run$/,
  // THE RIG ALREADY HAD THESE (M84). The castaway used to spin his whole body
  // to face whatever direction you pressed, so backing away from a raptor
  // played a forward sprint with the model turned around. Casual2 ships
  // strafe and backpedal runs; the body now holds the camera's heading and
  // these carry the direction.
  back: /(^|\|)Run_Back$/,
  left: /(^|\|)Run_Left$/,
  right: /(^|\|)Run_Right$/,
  air: /(^|\|)Idle$/, // no jump clip on this rig; alert-idle reads fine airborne
  sit: /(^|\|)Sit/, // none on this rig — animate() falls back to idle astride
  punch: /(^|\|)Punch_Right$/,
  chop: /(^|\|)Sword_Slash$/,
  throw: /(^|\|)Punch_Left$/,
  // Two more one-shots the rig has always carried and nothing played: a
  // flinch when something bites you, and a reach for opening a chest or
  // laying a bedroll. Losing health used to be a red vignette and nothing
  // else on the body.
  hurt: /(^|\|)HitRecieve$/,
  interact: /(^|\|)Interact$/,
}
/** Castaway look: recolor the casual outfit to bare skin + ragged shorts. */
const CASTAWAY_RECOLOR: Record<string, number> = {
  LightBrown: -1, // shirt → skin (resolved from the Skin material at load)
  White: -1, // shoes → skin
  Red_Dark: -1, // shoe soles → skin
  LightBlue: 0x4a3623, // jeans → ragged brown shorts
}

/** A bone posed about the MODEL's axes rather than its own (M84). The rig's
 *  bone frames are bound rotated — the legs by ~180° about z — so "rotate the
 *  shoulder on x" means something different for every bone, and the first
 *  crawl attempt swept both arms straight back into a glide. `pitch` and
 *  `roll` are the model's x and z axes carried into the bone's PARENT frame,
 *  so pre-multiplying by a rotation about them tips the limb in the model's
 *  own sagittal and coronal planes whatever the bind pose was. */
interface SwimBone {
  bone: THREE.Bone
  side: 1 | -1
  rest: THREE.Quaternion
  pitch: THREE.Vector3
  roll: THREE.Vector3
}

const _q = /* @__PURE__ */ new THREE.Quaternion()
const _q2 = /* @__PURE__ */ new THREE.Quaternion()
const _target = /* @__PURE__ */ new THREE.Quaternion()
const _v = /* @__PURE__ */ new THREE.Vector3()
const _v2 = /* @__PURE__ */ new THREE.Vector3()
const _axX = /* @__PURE__ */ new THREE.Vector3(1, 0, 0)
const _axZ = /* @__PURE__ */ new THREE.Vector3(0, 0, 1)

export class Player {
  /** The straddle, tunable at runtime so it can be dialled in against a
   *  screenshot instead of one rebuild per guess (M83). */
  // Chosen against screenshots, not guessed: -1.15/0.4/1.55 threw the thighs
  // out horizontally, and 1.55 of shin folded the calf flat against it.
  static sitPose = { thighX: -0.7, thighZ: 0.32, shinX: 1.1 }
  /** The swim, likewise tunable at runtime (setSwimPose) so the stroke can be
   *  dialled in against a screenshot. `pitch` is how far the body tips toward
   *  prone when stroking; `tread` when holding station; `lift` floats the
   *  prone body up to the surface, since the mover keeps the CAPSULE's head
   *  at the waterline and a horizontal body hangs below that. */
  static swimPose = {
    pitch: 1.42, tread: 0.34, lift: 0.62,
    armBase: -2.05, armSwing: 0.85, armOut: 0.22, armOutSwing: 0.45, elbow: 0.9,
    thighOut: 0.4, thighPitch: 0.3, knee: -1.1,
    /** how far the body tips off level when rising or diving */
    climb: 0.55,
    /** HOLDING STATION IS A DIFFERENT STROKE. The breaststroke angles are
     *  authored for a PRONE body; on an upright one the same numbers threw
     *  the arms straight out in front and left the legs hanging together,
     *  which from the front read as a starfish. Treading gets its own arm
     *  angle and a slow scissor kick, blended in as the stroke falls away. */
    treadArm: -1.05, scissor: 0.42, treadKnee: -0.55,
  }

  readonly mover: Mover
  readonly object = new THREE.Group()
  swimming = false
  /** holding the descend key while swimming — the only way under the surface */
  diving = false
  riding = false
  /** Creative flight (double-tap space in creative mode). Auto-lands on ground contact. */
  flying = false
  /** survival gates this: a winded player cannot sprint */
  sprintAllowed = true
  /** what the last fixed step did (survival reads these) */
  sprinting = false
  moving = false
  private facing = Math.PI // north, away from the spawn camera (0 = +z faced the camera: every fresh-spawn shot had him staring at you)
  private mixer: THREE.AnimationMixer | null = null
  private actions = new Map<ClipSlot, THREE.AnimationAction>()
  private moveWeight = 0
  private runBlend = 0
  private airBlend = 0
  private swimBlend = 0
  private sitBlend = 0
  private armBlend = 0
  /** travel direction in body space, smoothed: [forward, right] unit-ish */
  private dirF = 1
  private dirR = 0
  /** stroke phase, advanced by stroke rate rather than wall time */
  private strokeT = 0
  /** smoothed vertical intent in the water: +1 rising, -1 diving */
  private climbBlend = 0
  /** hip-height pivot: the swim pitch has to rotate the body about its
   *  middle, not about the point between its feet (which would swing the
   *  head out in front on the end of a 1.75 m lever). */
  private readonly pivot = new THREE.Group()
  private oneShotT = 0
  /** THE TOOL'S OWN ARC. The rig's clips move the arm, and a tool parented to
   *  the wrist just rode along stiffly — an axe should cock back, whip through
   *  and settle. This is a second rotation on the mount, over the top of
   *  whatever the arm is doing: -1 = not swinging, 0..1 = through the arc. */
  private swingT = -1
  /** leg bones for the procedural riding pose (rig has no sit clip).
   *  Casual2 ships FOUR duplicate armatures (one per body-part mesh) with
   *  identical bone names — every match must be posed, not just the first. */
  /** the right wrist — where a held tool hangs (M48) */
  private hand: THREE.Bone | null = null
  private heldMount: THREE.Object3D | null = null
  private heldModel: THREE.Object3D | null = null
  private heldId: ItemId | null = null
  /** main.ts supplies the kit model for an item (player.ts must not know the kit) */
  heldFactory: ((id: ItemId) => THREE.Object3D | null) | null = null
  private thighs: { bone: THREE.Bone; side: 1 | -1; rest: THREE.Quaternion }[] = []
  private shins: { bone: THREE.Bone; rest: THREE.Quaternion }[] = []
  private arms: SwimBone[] = []
  private forearms: SwimBone[] = []
  private kickers: SwimBone[] = []
  private knees: SwimBone[] = []

  constructor(physics: Physics, spawn: THREE.Vector3) {
    this.mover = new Mover(physics, PLAYER_MOVER, spawn)
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const gltf = await loader.loadAsync('models/player/Castaway.glb')
    registerWarmRoot(gltf.scene)
    const model = gltf.scene

    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    model.scale.setScalar(HEIGHT / (size.y || 1))
    const box2 = new THREE.Box3().setFromObject(model)
    model.position.y -= box2.min.y

    // castaway recolor: find the Skin tone, repaint outfit materials
    let skin: THREE.Color | null = null
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if ((m as THREE.MeshStandardMaterial).name === 'Skin') skin = (m as THREE.MeshStandardMaterial).color.clone()
      }
    })
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = true
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) {
          const mat = m as THREE.MeshStandardMaterial
          if (mat.name in CASTAWAY_RECOLOR) {
            const v = CASTAWAY_RECOLOR[mat.name]
            if (v === -1 && skin) mat.color.copy(skin)
            else if (v >= 0) mat.color.setHex(v)
          }
        }
      }
    })
    model.position.y -= PIVOT_Y
    this.pivot.position.y = PIVOT_Y
    this.pivot.add(model)
    this.object.add(this.pivot)

    // NOTE: GLTFLoader sanitizes node names — '.' is a reserved PropertyBinding
    // char and gets stripped, so the file's "UpperLeg.L" loads as "UpperLegL".
    // Match both forms. (The first pose attempt matched the raw-file names and
    // silently found zero bones.)
    model.traverse((o) => {
      if (!(o instanceof THREE.Bone)) return
      const n = o.name.replace(/\./g, '')
      if (n === 'WristR') this.hand = o
      // THE REST POSE IS THE ONLY STABLE REFERENCE (M83). These bones' local
      // frames are rotated ~180° about z in this rig, so nudging
      // `rotation.x` — which is what the sit pose used to do — pushes the leg
      // on an axis that is not the hip's pitch, and the two halves cancel:
      // measured while mounted, thighs sat at z ±3.39 and shins at x 2.97,
      // and the rider stood bolt upright on the animal's back. Posing from
      // the captured rest quaternion makes the result independent of both
      // the rig's bind orientation and whatever the walk clip was doing.
      if (n === 'UpperLegL') this.thighs.push({ bone: o, side: -1, rest: o.quaternion.clone() })
      if (n === 'UpperLegR') this.thighs.push({ bone: o, side: 1, rest: o.quaternion.clone() })
      if (n === 'LowerLegL' || n === 'LowerLegR') this.shins.push({ bone: o, rest: o.quaternion.clone() })
      const swimBone = (side: 1 | -1): SwimBone => {
        // the parent chain's rest orientation, model-root-relative
        const acc = new THREE.Quaternion()
        for (let par = o.parent; par && par !== model; par = par.parent) acc.premultiply(par.quaternion)
        acc.invert()
        return {
          bone: o, side, rest: o.quaternion.clone(),
          pitch: new THREE.Vector3(1, 0, 0).applyQuaternion(acc),
          roll: new THREE.Vector3(0, 0, 1).applyQuaternion(acc),
        }
      }
      // the legs are captured TWICE, deliberately: `thighs`/`shins` carry
      // M83's straddle, which is posted against the bone's own rest frame and
      // was dialled in by eye, and re-deriving it on the model axes would mean
      // re-tuning a pose that is verified. The swim wants model axes.
      if (n === 'UpperArmL') this.arms.push(swimBone(-1))
      if (n === 'UpperArmR') this.arms.push(swimBone(1))
      if (n === 'LowerArmL') this.forearms.push(swimBone(-1))
      if (n === 'LowerArmR') this.forearms.push(swimBone(1))
      if (n === 'UpperLegL') this.kickers.push(swimBone(-1))
      if (n === 'UpperLegR') this.kickers.push(swimBone(1))
      if (n === 'LowerLegL') this.knees.push(swimBone(-1))
      if (n === 'LowerLegR') this.knees.push(swimBone(1))
    })
    if (this.thighs.length === 0) console.warn('riding pose: no leg bones matched — rig names changed?')

    this.mixer = new THREE.AnimationMixer(model)
    for (const slot of Object.keys(CLIP_MATCH) as ClipSlot[]) {
      const clip = gltf.animations.find((a) => CLIP_MATCH[slot].test(a.name))
      if (!clip) continue
      const action = this.mixer.clipAction(clip)
      if (slot === 'punch' || slot === 'chop' || slot === 'throw' || slot === 'hurt' || slot === 'interact') {
        action.setLoop(THREE.LoopOnce, 1)
      } else {
        action.play()
        action.weight = slot === 'idle' ? 1 : 0
      }
      this.actions.set(slot, action)
    }
  }

  /** The held tool's arc, layered on the mount so it works with any clip:
   *  a quick wind-up, a fast strike through, then an ease back to rest. */
  private swingTool(dt: number): void {
    if (this.swingT < 0) return
    this.swingT += dt / 0.52
    if (this.swingT >= 1) { this.swingT = -1; if (this.heldMount) this.heldMount.rotation.set(0, 0, 0); return }
    if (!this.heldMount) return
    const t = this.swingT
    // -0.5 (cocked back) → +1.9 rad (through), then settle: a cubic ease out
    // of the wind-up and a hard fast strike, which is where the weight reads
    const wind = Math.min(1, t / 0.28)
    const strike = t < 0.28 ? 0 : Math.min(1, (t - 0.28) / 0.34)
    const settle = t < 0.62 ? 0 : (t - 0.62) / 0.38
    const angle = -0.55 * (1 - wind * wind) - 0.55 * wind + 2.45 * (1 - Math.pow(1 - strike, 3)) - 1.35 * (settle * settle)
    this.heldMount.rotation.x = angle
    // and a little roll, so it is not a pure hinge
    this.heldMount.rotation.z = 0.18 * Math.sin(t * Math.PI)
  }

  /** QA: the locomotion state the blend tree is actually in (M84) — which
   *  direction the body reads as travelling, and which clips carry weight. */
  locoState(): Record<string, unknown> {
    const w: Record<string, number> = {}
    for (const [slot, a] of this.actions) w[slot] = +a.weight.toFixed(3)
    return {
      weights: w,
      dirF: +this.dirF.toFixed(2), dirR: +this.dirR.toFixed(2),
      swimBlend: +this.swimBlend.toFixed(2), airBlend: +this.airBlend.toFixed(2),
      armBlend: +this.armBlend.toFixed(2), moveWeight: +this.moveWeight.toFixed(2),
      pitch: +this.pivot.rotation.x.toFixed(2),
      climb: +this.climbBlend.toFixed(2), diving: this.diving,
      bodyY: +(this.object.position.y + this.pivot.position.y).toFixed(2),
      arms: this.arms.length, forearms: this.forearms.length,
      clips: [...this.actions.keys()],
      facing: +this.facing.toFixed(2), swimming: this.swimming,
    }
  }

  /** Pose diagnostics: matched leg bones + live thigh flex (radians). */
  poseInfo(): { thighs: number; shins: number; flexX: number; sitBlend: number; hipAboveOrigin: number } {
    // WHERE THE RIDER'S WEIGHT ACTUALLY IS. `player.object`'s origin is at his
    // FEET, but astride an animal it is his hip that has to land on the back,
    // and the straddle does not move the pelvis — so a seat is only right if
    // it is authored against this number, not against his height.
    let hip = 0
    if (this.thighs[0]) {
      this.object.updateWorldMatrix(true, true)
      hip = this.thighs[0].bone.getWorldPosition(_v).y - this.object.getWorldPosition(_v2).y
    }
    return {
      thighs: this.thighs.length,
      shins: this.shins.length,
      flexX: this.thighs[0] ? +this.thighs[0].bone.rotation.x.toFixed(2) : 0,
      sitBlend: +this.sitBlend.toFixed(2),
      hipAboveOrigin: +hip.toFixed(2),
    }
  }

  /** HOLD IT. The castaway used to mime every tool — you swung at a tree with
   *  an empty fist and the hatchet existed only in the hotbar (user, M48).
   *  The kit model now hangs off the right wrist, counter-scaled out of the
   *  bone's own scale and posed per item so the handle sits in the fist. */
  setHeldItem(id: ItemId | null): void {
    if (id === this.heldId) return
    this.heldId = id
    if (this.heldMount) {
      this.heldMount.parent?.remove(this.heldMount)
      this.heldMount = null
      this.heldModel = null
    }
    if (!id || !this.hand || !this.heldFactory) return
    const pose = HELD_POSE[id]
    if (!pose) return
    const model = this.heldFactory(id)
    if (!model) return
    const mount = new THREE.Group()
    // the bone carries the rig's own scale; undo it so the tool is in metres
    const ws = this.hand.getWorldScale(new THREE.Vector3())
    mount.scale.setScalar(1 / Math.max(0.0001, ws.x))
    model.position.set(pose.pos[0], pose.pos[1], pose.pos[2])
    model.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2])
    mount.add(model)
    this.hand.add(mount)
    this.heldMount = mount
    this.heldModel = model
  }

  /** Live pose tuning for the held tool (M84): the fist's bone frame is not
   *  aligned with anything you can reason about from the outside, so the
   *  numbers in HELD_POSE were only ever going to be found by measurement. */
  setHeldPose(id: ItemId, pos: [number, number, number], rot: [number, number, number]): void {
    const pose = HELD_POSE[id]
    if (!pose) return
    pose.pos = pos
    pose.rot = rot
    if (this.heldId === id) { this.heldId = null; this.setHeldItem(id) }
  }

  /** QA: where the tool actually IS — its long axis in the player's own frame,
   *  and how far the grip end sits from the fist. A screenshot cannot measure
   *  either, and both are what "held properly" means. */
  heldProbe(): Record<string, unknown> | null {
    if (!this.heldMount || !this.hand || !this.heldId || !this.heldModel) return null
    this.object.updateWorldMatrix(true, true)
    const size = HELD_SIZE[this.heldId] ?? 1
    // kit.instance() puts the model's origin at the BOTTOM of its own bounding
    // box and scales it to `size`, so in the wrapper's frame the tool runs
    // from (0,0,0) to (0,size,0) — exact, where a world bounding box is not
    // (the first version read bbox corners, and a diagonal spear's corners are
    // nowhere near the shaft: it reported a 0.6 m grip gap on a fist grip).
    const butt = this.heldModel.getWorldPosition(new THREE.Vector3())
    const tip = this.heldModel.localToWorld(new THREE.Vector3(0, size, 0))
    const hand = this.hand.getWorldPosition(new THREE.Vector3())
    const inv = new THREE.Matrix4().copy(this.object.matrixWorld).invert()
    const dir = tip.clone().sub(butt).normalize().transformDirection(inv)
    const handLocal = hand.clone().applyMatrix4(inv)
    const tipLocal = tip.clone().applyMatrix4(inv)
    return {
      item: this.heldId,
      pose: HELD_POSE[this.heldId],
      length: +butt.distanceTo(tip).toFixed(2),
      gripGap: +butt.distanceTo(hand).toFixed(2),
      // in the player's frame: +z is the way he faces, +y up, +x his left
      dir: [+dir.x.toFixed(2), +dir.y.toFixed(2), +dir.z.toFixed(2)],
      hand: [+handLocal.x.toFixed(2), +handLocal.y.toFixed(2), +handLocal.z.toFixed(2)],
      tip: [+tipLocal.x.toFixed(2), +tipLocal.y.toFixed(2), +tipLocal.z.toFixed(2)],
    }
  }

  /** Flinch: something hit you. */
  playHurt(): void {
    const action = this.actions.get('hurt')
    if (!action) return
    action.reset().play()
    this.oneShotT = Math.max(this.oneShotT, 0.42)
  }

  /** Reach: opening a chest, laying a bedroll, taking something. */
  playInteract(): void {
    const action = this.actions.get('interact')
    if (!action) return
    action.reset().play()
    this.oneShotT = Math.max(this.oneShotT, 0.5)
  }

  /** One-shot swing animation, flavored by the held tool. */
  playSwing(held: ItemId | null): void {
    const slot: ClipSlot = held === 'hatchet' ? 'chop' : held === 'spear' ? 'throw' : 'punch'
    const action = this.actions.get(slot)
    if (!action) return
    action.reset().play()
    this.oneShotT = 0.55
    this.swingT = 0 // and the tool starts its own arc (M48b)
  }

  /** Fixed-step: translate keys + camera yaw into mover intent. */
  fixedUpdate(
    dt: number,
    input: Input,
    cameraYaw: number,
    gravityY: number,
    waterLevel: number | null,
    current: { x: number; z: number } | null,
    override?: { vx: number; vz: number },
  ): void {
    const depth = waterLevel !== null ? waterLevel - (this.mover.position.y - this.mover.feetOffset) : -1
    this.swimming = !this.flying && depth > 1.05

    if (this.flying) {
      this.diving = false
      // creative flight: WASD fast horizontal, space up, shift down; landing
      // (ground contact while descending) disengages. Debug override steers too.
      if (override) {
        this.mover.intent.vx = override.vx
        this.mover.intent.vz = override.vz
        if (override.vx || override.vz) this.facing = Math.atan2(override.vx, override.vz)
        const vertO = input.down('Space') ? 9 : input.down('ShiftLeft') ? -9 : 0
        this.mover.velocityY = vertO
        this.mover.intent.jump = false
        this.mover.update(dt, 0)
        if (this.mover.grounded && vertO < 0) this.flying = false // land = descend into ground
        return
      }
      let fwd = 0
      let strafe = 0
      if (input.down('KeyW')) fwd -= 1
      if (input.down('KeyS')) fwd += 1
      if (input.down('KeyA')) strafe -= 1
      if (input.down('KeyD')) strafe += 1
      const len = Math.hypot(fwd, strafe)
      const FLY_SPEED = 20
      if (len > 0) {
        const sin = Math.sin(cameraYaw)
        const cos = Math.cos(cameraYaw)
        const nx = (strafe * cos + fwd * sin) / len
        const nz = (fwd * cos - strafe * sin) / len
        this.mover.intent.vx = nx * FLY_SPEED
        this.mover.intent.vz = nz * FLY_SPEED
        this.facing = Math.atan2(nx, nz)
      } else {
        this.mover.intent.vx = 0
        this.mover.intent.vz = 0
      }
      const vert = (input.down('Space') ? 9 : 0) + (input.down('ShiftLeft') || input.down('ShiftRight') ? -9 : 0)
      this.mover.velocityY = vert
      this.mover.intent.jump = false
      this.mover.update(dt, 0)
      if (this.mover.grounded && vert < 0) this.flying = false // land = descend into ground
      return
    }

    if (override) {
      // the QA override: a speed past walking counts as a sprint (survival),
      // and a winded player is held to walking pace like anyone else. It
      // never dives — and it has to SAY so, or a driven player who was
      // holding SHIFT a moment ago keeps sinking with nothing pressed.
      this.diving = false
      const mag = Math.hypot(override.vx, override.vz)
      const k = mag > WALK_SPEED + 0.1 && !this.sprintAllowed ? WALK_SPEED / mag : 1
      this.mover.intent.vx = override.vx * k
      this.mover.intent.vz = override.vz * k
      this.moving = mag > 0.1
      this.sprinting = mag > WALK_SPEED + 0.1 && this.sprintAllowed && !this.swimming
      if (override.vx || override.vz) this.facing = Math.atan2(override.vx, override.vz)
      this.applyStep(dt, gravityY, waterLevel, current)
      return
    }
    let fwd = 0
    let strafe = 0
    if (input.down('KeyW')) fwd -= 1
    if (input.down('KeyS')) fwd += 1
    if (input.down('KeyA')) strafe -= 1
    if (input.down('KeyD')) strafe += 1

    const shift = input.down('ShiftLeft') || input.down('ShiftRight')
    const wantSprint = shift && this.sprintAllowed
    // SHIFT TAKES YOU DOWN. The buoyancy used to push the head back to the
    // surface the moment it dipped below, so the sea floor — rocks, weed, the
    // whole third of the map the water covers — could not be reached at all.
    // Shift is free in the water (a swimmer cannot sprint) and it is already
    // "down" in creative flight, so it is the same key in both.
    this.diving = this.swimming && shift
    const speed = this.swimming ? SWIM_SPEED : wantSprint ? SPRINT_SPEED : WALK_SPEED
    const len = Math.hypot(fwd, strafe)
    this.moving = len > 0
    this.sprinting = len > 0 && wantSprint && !this.swimming
    // THE BODY HOLDS THE CAMERA'S HEADING (M84). It used to snap round to
    // face whatever direction you pressed, so backing away from something
    // played a forward run with the model spun 180°, and a swing landed
    // wherever your feet had turned rather than where you were looking. The
    // strafe/backpedal clips carry the direction now. Swimming is the one
    // exception: a prone body has to point where it is going.
    if (!this.swimming) this.facing = cameraYaw + Math.PI
    if (len > 0) {
      const sin = Math.sin(cameraYaw)
      const cos = Math.cos(cameraYaw)
      const nx = (strafe * cos + fwd * sin) / len
      const nz = (fwd * cos - strafe * sin) / len
      this.mover.intent.vx = nx * speed
      this.mover.intent.vz = nz * speed
      if (this.swimming) this.facing = Math.atan2(nx, nz)
    } else {
      this.mover.intent.vx = 0
      this.mover.intent.vz = 0
    }
    if (input.down('Space')) this.mover.intent.jump = true

    this.applyStep(dt, gravityY, waterLevel, current)
  }

  private applyStep(
    dt: number,
    gravityY: number,
    waterLevel: number | null,
    current: { x: number; z: number } | null,
  ): void {
    if (this.swimming && waterLevel !== null) {
      const head = this.mover.position.y + 0.4
      if (this.diving) {
        this.mover.velocityY = THREE.MathUtils.lerp(this.mover.velocityY, -DIVE_SPEED, 1 - Math.exp(-dt * 5))
      } else if (this.mover.intent.jump) {
        this.mover.velocityY = 2.6
      } else if (head > waterLevel - 0.15) {
        this.mover.velocityY = Math.max(this.mover.velocityY - 8 * dt, -1.2)
      } else {
        // buoyancy: it lifts you, and the deeper you are the harder — so a
        // dive costs you the climb back, without a stat to track it
        const deep = THREE.MathUtils.clamp((waterLevel - head) / 6, 0, 1)
        this.mover.velocityY = THREE.MathUtils.lerp(this.mover.velocityY, 1.4 + deep * 1.1, 1 - Math.exp(-dt * 3))
      }
      this.mover.intent.jump = false
      if (current) {
        this.mover.intent.vx += current.x * CURRENT_SPEED
        this.mover.intent.vz += current.z * CURRENT_SPEED
      }
      this.mover.update(dt, 0)
    } else {
      this.mover.update(dt, gravityY)
    }
  }

  /** Render frame: interpolate the visible mesh + drive the animation state. */
  /** QA: what the riding pose actually bound (M83). */
  rigReport(): Record<string, unknown> {
    const names: string[] = []
    this.object.traverse((o: THREE.Object3D) => { if ((o as THREE.Bone).isBone) names.push(o.name) })
    return {
      thighs: this.thighs.length, shins: this.shins.length, hand: !!this.hand,
      thighRot: this.thighs.map((t) => [+t.bone.rotation.x.toFixed(2), +t.bone.rotation.y.toFixed(2), +t.bone.rotation.z.toFixed(2)]),
      shinRot: this.shins.map((sh) => +sh.bone.rotation.x.toFixed(2)),
      sitBlend: +this.sitBlend.toFixed(2), riding: this.riding,
      bones: names,
    }
  }

  render(alpha: number, dt: number): void {
    if (!this.riding) {
      this.object.position.lerpVectors(this.mover.prevPosition, this.mover.position, alpha)
      this.object.position.y -= this.mover.feetOffset
      let d = this.facing - this.object.rotation.y
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      this.object.rotation.y += d * 0.25
    }
    this.animate(dt)
  }

  private animate(dt: number): void {
    if (!this.mixer) return
    this.oneShotT = Math.max(0, this.oneShotT - dt)
    this.swingTool(dt)
    const planar = Math.hypot(this.mover.intent.vx, this.mover.intent.vz)
    const running = planar > WALK_SPEED * 1.25
    const airborne = !this.riding && !this.swimming && !this.mover.grounded

    const k = 1 - Math.exp(-dt * 9)
    this.moveWeight = THREE.MathUtils.lerp(this.moveWeight, this.riding ? 0 : THREE.MathUtils.clamp(planar / WALK_SPEED, 0, 1), k)
    this.runBlend = THREE.MathUtils.lerp(this.runBlend, running ? 1 : 0, k)
    this.airBlend = THREE.MathUtils.lerp(this.airBlend, airborne ? 1 : 0, k)
    // `swimming` is only recomputed in fixedUpdate, which does NOT run while
    // you are mounted — so mounting from waist-deep water left the flag set
    // and the rider did a breaststroke, prone, on the animal's back.
    this.swimBlend = THREE.MathUtils.lerp(this.swimBlend, this.swimming && !this.riding ? 1 : 0, k)
    // read the vertical from the body, not the key: it covers the dive, the
    // kick for the surface and the slow bob at the top with one number
    const climbT = this.swimming ? THREE.MathUtils.clamp(this.mover.velocityY / 2.6, -1, 1) : 0
    this.climbBlend = THREE.MathUtils.lerp(this.climbBlend, climbT, 1 - Math.exp(-dt * 4))
    this.sitBlend = THREE.MathUtils.lerp(this.sitBlend, this.riding ? 1 : 0, 1 - Math.exp(-dt * 14))
    // a hatchet or a spear is PRESENTED; a torch is only carried
    const readied = !!this.heldId && !!HELD_POSE[this.heldId] && this.heldId !== 'torch'
    this.armBlend = THREE.MathUtils.lerp(this.armBlend, readied ? 1 : 0, k)

    // which way the travel is, in the body's own frame: the body holds the
    // camera's heading, so this is what picks the forward / back / strafe clip
    let tf = 1
    let tr = 0
    if (planar > 0.05) {
      let d = Math.atan2(this.mover.intent.vx, this.mover.intent.vz) - this.facing
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      tf = Math.cos(d)
      tr = -Math.sin(d) // body-local -x is the model's right (its forward is +z)
    }
    this.dirF = THREE.MathUtils.lerp(this.dirF, tf, k)
    this.dirR = THREE.MathUtils.lerp(this.dirR, tr, k)
    const wF = Math.max(0, this.dirF)
    const wB = Math.max(0, -this.dirF)
    const wR = Math.max(0, this.dirR)
    const wL = Math.max(0, -this.dirR)
    const dirSum = wF + wB + wR + wL || 1

    // one-shots temporarily dominate the base layer
    const oneShot = this.oneShotT > 0 ? 0.25 : 1
    const ground = (1 - this.airBlend) * (1 - this.swimBlend) * (1 - this.sitBlend) * oneShot
    const idle = this.actions.get('idle')
    const armed = this.actions.get('armed')
    const walk = this.actions.get('walk')
    const run = this.actions.get('run')
    const back = this.actions.get('back')
    const left = this.actions.get('left')
    const right = this.actions.get('right')
    const air = this.actions.get('air')
    const sit = this.actions.get('sit')
    const rest = ground * (1 - this.moveWeight)
    if (idle) idle.weight = rest * (1 - this.armBlend)
    if (armed) {
      if (this.armBlend > 0.01 && !armed.isRunning()) armed.play()
      armed.weight = rest * this.armBlend
    } else if (idle) {
      idle.weight = rest
    }
    // The strafe and backpedal clips are RUNS — authored for sprint pace — so
    // they are retimed to the ground speed rather than gated to sprints only.
    // Proportional, not a constant plus a slope: a flat 0.62 + speed term ran
    // the cycle at 0.92 while the body walked at 4.4 m/s, which is a foot
    // sliding over the ground at nearly twice its stride.
    const gait = THREE.MathUtils.clamp(planar / SPRINT_SPEED, 0.45, 1.15)
    const move = ground * this.moveWeight
    if (walk) {
      walk.weight = (move * wF * (1 - this.runBlend)) / dirSum
      walk.timeScale = 0.7 + (planar / WALK_SPEED) * 0.45
    }
    if (run) {
      run.weight = (move * wF * this.runBlend) / dirSum
      run.timeScale = 0.75 + (planar / SPRINT_SPEED) * 0.45
    }
    for (const [act, w] of [[back, wB], [left, wL], [right, wR]] as const) {
      if (!act) continue
      if (w > 0.01 && !act.isRunning()) act.play()
      act.weight = (move * w) / dirSum
      act.timeScale = gait
    }
    if (air) air.weight = this.airBlend * (1 - this.sitBlend) * oneShot
    if (sit) {
      if (this.sitBlend > 0.01 && !sit.isRunning()) sit.play()
      sit.weight = this.sitBlend
    } else if (idle) {
      idle.weight += this.sitBlend * oneShot // no sit clip — procedural pose below
    }
    // swimming has no clip on this rig either: hold the neutral idle as the
    // base (a relaxed, straight-limbed pose is the right thing to bend) and
    // let the procedural crawl below do the work
    if (this.swimBlend > 0.02 && idle) idle.weight += this.swimBlend * oneShot
    this.mixer.update(dt)

    // PROCEDURAL SWIM (M84). The castaway used to cross open water bolt
    // upright in an alert idle, sliding along like a buoy. There is no swim
    // clip in Casual2, so this tips the body toward prone about the hips and
    // drives a front crawl over the top of the idle: arms alternating
    // overhead, knees fluttering, and only a tread-water lean when holding
    // station.
    if (this.swimBlend > 0.002) {
      const P = Player.swimPose
      const t = this.swimBlend
      // GOING SOMEWHERE IS GOING SOMEWHERE, up or along: a dive straight down
      // with no WASD is still a stroke, so the body goes prone for it and
      // does not tread water while descending head-first.
      const stroke = THREE.MathUtils.clamp(Math.max(this.moveWeight * 1.6, Math.abs(this.climbBlend)), 0, 1)
      this.strokeT += dt * (0.9 + stroke * 1.4)
      // tip off level toward wherever he is heading in the water column
      this.pivot.rotation.x = t * (P.tread + (P.pitch - P.tread) * stroke - this.climbBlend * P.climb)
      this.pivot.position.y = PIVOT_Y + t * P.lift * stroke
      const ph = this.strokeT * Math.PI * 2
      // A BREASTSTROKE, not a crawl. The arm hangs along the model's -y at
      // rest, and rotating it about the model's x sweeps it through the
      // sagittal plane: around -2.9 rad it is extended ahead, around -1.2 it
      // has pulled down and back. Both arms move together and both knees fold
      // together — symmetric, so it reads from any angle, where the crawl's
      // half-cycle offset just looked like one arm hanging off the shoulder.
      const s1 = Math.sin(ph)
      const amp = 0.45 + 0.55 * stroke
      const spread = (1 - s1) * 0.5 // 0 extended → 1 swept back
      const armBase = THREE.MathUtils.lerp(P.treadArm, P.armBase, stroke)
      for (const { bone, side, rest, pitch, roll } of this.arms) {
        _q.setFromAxisAngle(pitch, armBase + P.armSwing * spread * 2 * amp - P.armSwing * amp)
        _q2.setFromAxisAngle(roll, (P.armOut + P.armOutSwing * spread) * -side)
        _target.copy(_q).multiply(_q2).multiply(rest)
        bone.quaternion.slerp(_target, t)
      }
      for (const { bone, rest, pitch } of this.forearms) {
        // elbow folds as the arms come back under the chest, straight on the glide
        _q.setFromAxisAngle(pitch, P.elbow * spread * amp)
        _target.copy(_q).multiply(rest)
        bone.quaternion.slerp(_target, t)
      }
      // frog kick, a quarter-cycle behind the arms: knees draw up and out,
      // then snap straight as the arms extend
      const fold = THREE.MathUtils.clamp((1 - Math.sin(ph + 1.0)) * 0.5, 0, 1) * amp
      for (const { bone, side, rest, pitch, roll } of this.kickers) {
        const scissor = Math.sin(ph * 1.15 + (side > 0 ? 0 : Math.PI)) * P.scissor
        _q.setFromAxisAngle(pitch, THREE.MathUtils.lerp(scissor, -P.thighPitch * fold, stroke))
        _q2.setFromAxisAngle(roll, P.thighOut * fold * -side * stroke)
        _target.copy(_q).multiply(_q2).multiply(rest)
        bone.quaternion.slerp(_target, t)
      }
      for (const { bone, side, rest, pitch } of this.knees) {
        const scissor = P.treadKnee * (0.6 + 0.4 * Math.sin(ph * 1.15 + (side > 0 ? 0 : Math.PI)))
        _q.setFromAxisAngle(pitch, THREE.MathUtils.lerp(scissor, P.knee * fold, stroke))
        _target.copy(_q).multiply(rest)
        bone.quaternion.slerp(_target, t)
      }
    } else if (this.pivot.rotation.x !== 0) {
      this.pivot.rotation.x = 0
      this.pivot.position.y = PIVOT_Y
    }

    // procedural riding pose: after the mixer writes bones, flex the legs into
    // a straddle (thighs forward+out, knees bent) proportional to sitBlend
    if (this.sitBlend > 0.02) {
      const t = this.sitBlend
      // Blend from whatever the clip wrote toward a straddle built on the
      // REST pose: hips pitched forward and swung out, knees folded back.
      // The axes are the MODEL's, taken through the bone's rest frame, so
      // this reads the same on any rig whose legs point down at bind time.
      for (const { bone, side, rest } of this.thighs) {
        _q.setFromAxisAngle(_axX, Player.sitPose.thighX)
        _q2.setFromAxisAngle(_axZ, Player.sitPose.thighZ * side)
        _target.copy(rest).multiply(_q).multiply(_q2)
        bone.quaternion.slerp(_target, t)
      }
      for (const { bone, rest } of this.shins) {
        _q.setFromAxisAngle(_axX, Player.sitPose.shinX)
        _target.copy(rest).multiply(_q)
        bone.quaternion.slerp(_target, t)
      }
    }
  }
}

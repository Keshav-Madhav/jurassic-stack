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
const CURRENT_SPEED = 2.2
const HEIGHT = 1.75

type ClipSlot = 'idle' | 'walk' | 'run' | 'air' | 'sit' | 'punch' | 'chop' | 'throw'
// Quaternius "Casual2" castaway — clip names carry an armature prefix, so match by suffix
/** where each tool sits in the fist: metres and radians, tuned by screenshot */
const HELD_POSE: Partial<Record<ItemId, { pos: [number, number, number]; rot: [number, number, number]; size: number }>> = {
  hatchet: { pos: [0, 0.05, 0], rot: [0, 0, Math.PI / 2], size: 0.55 },
  spear: { pos: [0, 0.1, 0], rot: [0, 0, Math.PI / 2], size: 2.1 },
  torch: { pos: [0, 0.06, 0], rot: [0, 0, Math.PI / 2], size: 0.8 },
}

/** the size the kit model is normalised to, per item */
export const HELD_SIZE: Partial<Record<ItemId, number>> = { hatchet: 0.55, spear: 2.1, torch: 0.8 }

const CLIP_MATCH: Record<ClipSlot, RegExp> = {
  idle: /(^|\|)Idle_Neutral$/,
  walk: /(^|\|)Walk$/,
  run: /(^|\|)Run$/,
  air: /(^|\|)Idle$/, // no jump clip on this rig; alert-idle reads fine airborne
  sit: /(^|\|)Sit/, // none on this rig — animate() falls back to idle astride
  punch: /(^|\|)Punch_Right$/,
  chop: /(^|\|)Sword_Slash$/,
  throw: /(^|\|)Punch_Left$/,
}
/** Castaway look: recolor the casual outfit to bare skin + ragged shorts. */
const CASTAWAY_RECOLOR: Record<string, number> = {
  LightBrown: -1, // shirt → skin (resolved from the Skin material at load)
  White: -1, // shoes → skin
  Red_Dark: -1, // shoe soles → skin
  LightBlue: 0x4a3623, // jeans → ragged brown shorts
}

const _q = /* @__PURE__ */ new THREE.Quaternion()
const _q2 = /* @__PURE__ */ new THREE.Quaternion()
const _target = /* @__PURE__ */ new THREE.Quaternion()
const _axX = /* @__PURE__ */ new THREE.Vector3(1, 0, 0)
const _axZ = /* @__PURE__ */ new THREE.Vector3(0, 0, 1)

export class Player {
  /** The straddle, tunable at runtime so it can be dialled in against a
   *  screenshot instead of one rebuild per guess (M83). */
  // Chosen against screenshots, not guessed: -1.15/0.4/1.55 threw the thighs
  // out horizontally, and 1.55 of shin folded the calf flat against it.
  static sitPose = { thighX: -0.7, thighZ: 0.32, shinX: 1.1 }

  readonly mover: Mover
  readonly object = new THREE.Group()
  swimming = false
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
  private sitBlend = 0
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
  private heldId: ItemId | null = null
  /** main.ts supplies the kit model for an item (player.ts must not know the kit) */
  heldFactory: ((id: ItemId) => THREE.Object3D | null) | null = null
  private thighs: { bone: THREE.Bone; side: 1 | -1; rest: THREE.Quaternion }[] = []
  private shins: { bone: THREE.Bone; rest: THREE.Quaternion }[] = []

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
    this.object.add(model)

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
    })
    if (this.thighs.length === 0) console.warn('riding pose: no leg bones matched — rig names changed?')

    this.mixer = new THREE.AnimationMixer(model)
    for (const slot of Object.keys(CLIP_MATCH) as ClipSlot[]) {
      const clip = gltf.animations.find((a) => CLIP_MATCH[slot].test(a.name))
      if (!clip) continue
      const action = this.mixer.clipAction(clip)
      if (slot === 'punch' || slot === 'chop' || slot === 'throw') {
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

  /** Pose diagnostics: matched leg bones + live thigh flex (radians). */
  poseInfo(): { thighs: number; shins: number; flexX: number; sitBlend: number } {
    return {
      thighs: this.thighs.length,
      shins: this.shins.length,
      flexX: this.thighs[0] ? +this.thighs[0].bone.rotation.x.toFixed(2) : 0,
      sitBlend: +this.sitBlend.toFixed(2),
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
      // and a winded player is held to walking pace like anyone else
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

    const wantSprint = (input.down('ShiftLeft') || input.down('ShiftRight')) && this.sprintAllowed
    const speed = this.swimming ? SWIM_SPEED : wantSprint ? SPRINT_SPEED : WALK_SPEED
    const len = Math.hypot(fwd, strafe)
    this.moving = len > 0
    this.sprinting = len > 0 && wantSprint && !this.swimming
    // idle: the character comes round to face where the camera looks (third-
    // person convention; he used to stand with his back to your view direction)
    if (len === 0 && !this.swimming) this.facing = cameraYaw + Math.PI
    if (len > 0) {
      const sin = Math.sin(cameraYaw)
      const cos = Math.cos(cameraYaw)
      const nx = (strafe * cos + fwd * sin) / len
      const nz = (fwd * cos - strafe * sin) / len
      this.mover.intent.vx = nx * speed
      this.mover.intent.vz = nz * speed
      this.facing = Math.atan2(nx, nz)
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
      if (this.mover.intent.jump) {
        this.mover.velocityY = 2.6
      } else if (head > waterLevel - 0.15) {
        this.mover.velocityY = Math.max(this.mover.velocityY - 8 * dt, -1.2)
      } else {
        this.mover.velocityY = THREE.MathUtils.lerp(this.mover.velocityY, 1.4, 1 - Math.exp(-dt * 3))
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
    this.airBlend = THREE.MathUtils.lerp(this.airBlend, airborne || this.swimming ? 1 : 0, k)
    this.sitBlend = THREE.MathUtils.lerp(this.sitBlend, this.riding ? 1 : 0, 1 - Math.exp(-dt * 14))

    // one-shots temporarily dominate the base layer
    const oneShot = this.oneShotT > 0 ? 0.25 : 1
    const ground = (1 - this.airBlend) * (1 - this.sitBlend) * oneShot
    const idle = this.actions.get('idle')
    const walk = this.actions.get('walk')
    const run = this.actions.get('run')
    const air = this.actions.get('air')
    const sit = this.actions.get('sit')
    if (idle) idle.weight = ground * (1 - this.moveWeight)
    if (walk) {
      walk.weight = ground * this.moveWeight * (1 - this.runBlend)
      walk.timeScale = 0.7 + (planar / WALK_SPEED) * 0.45
    }
    if (run) {
      run.weight = ground * this.moveWeight * this.runBlend
      run.timeScale = 0.75 + (planar / SPRINT_SPEED) * 0.45
    }
    if (air) air.weight = this.airBlend * (1 - this.sitBlend) * oneShot
    if (sit) {
      if (this.sitBlend > 0.01 && !sit.isRunning()) sit.play()
      sit.weight = this.sitBlend
    } else if (idle) {
      idle.weight += this.sitBlend * oneShot // no sit clip — procedural pose below
    }
    this.mixer.update(dt)

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

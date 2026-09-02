// Player: reads input, produces mover intent relative to the camera's yaw,
// and owns the visible character — the KayKit Barbarian (CC0), whose GLB
// ships 76 animation clips. States: idle/walk/run/air/swim, one-shot swings
// (punch or chop by held tool), and a seated pose while riding. The axe
// attachment shows only while the hatchet is held; all other accessories
// (mug, shield, offhand axe) stay hidden.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { Input } from './input'
import { Mover, PLAYER_MOVER } from './mover'
import type { Physics } from './physics'
import type { ItemId } from './items'

const WALK_SPEED = 4.4
const SPRINT_SPEED = 8.0
const SWIM_SPEED = 3.4
const CURRENT_SPEED = 2.2
const HEIGHT = 1.75

type ClipSlot = 'idle' | 'walk' | 'run' | 'air' | 'sit' | 'punch' | 'chop' | 'throw'
const CLIP_NAMES: Record<ClipSlot, string> = {
  idle: 'Idle',
  walk: 'Walking_A',
  run: 'Running_A',
  air: 'Jump_Idle',
  sit: 'Sit_Chair_Idle',
  punch: 'Unarmed_Melee_Attack_Punch_A',
  chop: '1H_Melee_Attack_Chop',
  throw: 'Throw',
}
const HIDDEN_ATTACHMENTS = ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '2H_Axe', 'Mug']

export class Player {
  readonly mover: Mover
  readonly object = new THREE.Group()
  swimming = false
  riding = false
  private facing = 0
  private mixer: THREE.AnimationMixer | null = null
  private actions = new Map<ClipSlot, THREE.AnimationAction>()
  private axe: THREE.Object3D | null = null
  private moveWeight = 0
  private runBlend = 0
  private airBlend = 0
  private sitBlend = 0
  private oneShotT = 0

  constructor(physics: Physics, spawn: THREE.Vector3) {
    this.mover = new Mover(physics, PLAYER_MOVER, spawn)
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const gltf = await loader.loadAsync('models/player/Barbarian.glb')
    const model = gltf.scene

    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    model.scale.setScalar(HEIGHT / (size.y || 1))
    const box2 = new THREE.Box3().setFromObject(model)
    model.position.y -= box2.min.y

    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    for (const name of HIDDEN_ATTACHMENTS) {
      const n = model.getObjectByName(name)
      if (n) n.visible = false
    }
    this.axe = model.getObjectByName('1H_Axe') ?? null
    if (this.axe) this.axe.visible = false
    this.object.add(model)

    this.mixer = new THREE.AnimationMixer(model)
    for (const slot of Object.keys(CLIP_NAMES) as ClipSlot[]) {
      const clip = gltf.animations.find((a) => a.name === CLIP_NAMES[slot])
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

  /** Show the axe attachment while a chopping tool is held. */
  setHeldItem(id: ItemId | null): void {
    if (this.axe) this.axe.visible = id === 'hatchet'
  }

  /** One-shot swing animation, flavored by the held tool. */
  playSwing(held: ItemId | null): void {
    const slot: ClipSlot = held === 'hatchet' ? 'chop' : held === 'spear' ? 'throw' : 'punch'
    const action = this.actions.get(slot)
    if (!action) return
    action.reset().play()
    this.oneShotT = 0.55
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
    this.swimming = depth > 1.05

    if (override) {
      this.mover.intent.vx = override.vx
      this.mover.intent.vz = override.vz
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

    const speed = this.swimming
      ? SWIM_SPEED
      : input.down('ShiftLeft') || input.down('ShiftRight')
        ? SPRINT_SPEED
        : WALK_SPEED
    const len = Math.hypot(fwd, strafe)
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
    }
    this.mixer.update(dt)
  }
}

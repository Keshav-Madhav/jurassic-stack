// Player: reads input, produces mover intent relative to the camera's yaw,
// and owns the visible capsule (placeholder until the KayKit character at M4).
import * as THREE from 'three'
import { Input } from './input'
import { Mover, PLAYER_MOVER } from './mover'
import type { Physics } from './physics'

const WALK_SPEED = 4.4
const SPRINT_SPEED = 8.0
const SWIM_SPEED = 3.4
const CURRENT_SPEED = 2.2

export class Player {
  readonly mover: Mover
  readonly object = new THREE.Group()
  /** Yaw the body last faced (mesh turns smoothly toward travel direction). */
  private facing = 0

  constructor(physics: Physics, spawn: THREE.Vector3) {
    this.mover = new Mover(physics, PLAYER_MOVER, spawn)

    const mat = new THREE.MeshStandardMaterial({ color: 0xe8b04b, roughness: 0.8 })
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(PLAYER_MOVER.radius, PLAYER_MOVER.halfHeight * 2, 4, 12),
      mat,
    )
    body.position.y = this.mover.feetOffset
    body.castShadow = true
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.14, 0.26),
      new THREE.MeshStandardMaterial({ color: 0xa8752a }),
    )
    nose.position.set(0, this.mover.feetOffset + 0.45, PLAYER_MOVER.radius + 0.08)
    this.object.add(body, nose)
  }

  /** True while the swim mode drove the last fixed step. */
  swimming = false

  /** Fixed-step: translate keys + camera yaw into mover intent.
   *  `waterLevel`: water surface at the player, or null on dry land.
   *  `current`: river flow to add while swimming.
   *  `override` (harness/debug) replaces key input with a raw world-space velocity. */
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
    this.swimming = depth > 1.05 // chest-deep before swim kicks in

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
      // rotate input into world space around the camera yaw
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
      // buoyant kinematics: no gravity; space paddles up, otherwise settle
      // toward floating just under the surface; rivers push downstream
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

  /** Render frame: interpolate the visible mesh between fixed steps. */
  render(alpha: number): void {
    this.object.position.lerpVectors(this.mover.prevPosition, this.mover.position, alpha)
    this.object.position.y -= this.mover.feetOffset
    // smooth turn toward travel direction
    let d = this.facing - this.object.rotation.y
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    this.object.rotation.y += d * 0.25
  }
}

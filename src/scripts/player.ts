// Player: reads input, produces mover intent relative to the camera's yaw,
// and owns the visible capsule (placeholder until the KayKit character at M4).
import * as THREE from 'three'
import { Input } from './input'
import { Mover, PLAYER_MOVER } from './mover'
import type { Physics } from './physics'

const WALK_SPEED = 4.4
const SPRINT_SPEED = 8.0

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
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.14, 0.26),
      new THREE.MeshStandardMaterial({ color: 0xa8752a }),
    )
    nose.position.set(0, this.mover.feetOffset + 0.45, PLAYER_MOVER.radius + 0.08)
    this.object.add(body, nose)
  }

  /** Fixed-step: translate keys + camera yaw into mover intent.
   *  `override` (harness/debug) replaces key input with a raw world-space velocity. */
  fixedUpdate(
    dt: number,
    input: Input,
    cameraYaw: number,
    gravityY: number,
    override?: { vx: number; vz: number },
  ): void {
    if (override) {
      this.mover.intent.vx = override.vx
      this.mover.intent.vz = override.vz
      if (override.vx || override.vz) this.facing = Math.atan2(override.vx, override.vz)
      this.mover.update(dt, gravityY)
      return
    }
    let fwd = 0
    let strafe = 0
    if (input.down('KeyW')) fwd -= 1
    if (input.down('KeyS')) fwd += 1
    if (input.down('KeyA')) strafe -= 1
    if (input.down('KeyD')) strafe += 1

    const speed = input.down('ShiftLeft') || input.down('ShiftRight') ? SPRINT_SPEED : WALK_SPEED
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

    this.mover.update(dt, gravityY)
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

// The shared "mover": a capsule driven by Rapier's KinematicCharacterController.
// The player walks with one of these; rideable dinos will BE one of these with
// different dimensions/speeds (PLAN.md's single-controller decision) — riding
// is then just redirecting intent from the player's mover to the dino's.
//
// Contract per fixed step: set `intent` (desired horizontal velocity in m/s,
// jump flag), call update(dt), read `position` / `grounded` / `velocityY`.
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type { Physics } from './physics'

export interface MoverConfig {
  radius: number
  /** Capsule half-height of the cylindrical section (total height = 2*(halfHeight+radius)). */
  halfHeight: number
  jumpSpeed: number
  /** Extra gravity multiplier — 1 = physical, >1 feels snappier for games. */
  gravityScale: number
}

export const PLAYER_MOVER: MoverConfig = {
  radius: 0.4,
  halfHeight: 0.55, // total height 1.9 m
  jumpSpeed: 7.5,
  gravityScale: 1.8,
}

export class Mover {
  readonly position = new THREE.Vector3()
  /** Position at the previous fixed step, for render interpolation. */
  readonly prevPosition = new THREE.Vector3()
  readonly intent = { vx: 0, vz: 0, jump: false }
  grounded = false
  velocityY = 0

  private body: RAPIER.RigidBody
  private collider: RAPIER.Collider
  private controller: RAPIER.KinematicCharacterController
  private cfg: MoverConfig

  constructor(physics: Physics, cfg: MoverConfig, spawn: THREE.Vector3) {
    this.cfg = cfg
    const { world } = physics
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    )
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(cfg.halfHeight, cfg.radius),
      this.body,
    )
    this.controller = world.createCharacterController(0.02)
    this.controller.enableAutostep(0.55, 0.25, true)
    this.controller.enableSnapToGround(0.6)
    this.controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180)
    this.controller.setMinSlopeSlideAngle((58 * Math.PI) / 180)
    this.controller.setApplyImpulsesToDynamicBodies(true)
    this.position.copy(spawn)
    this.prevPosition.copy(spawn)
  }

  /** Capsule center → feet offset (for placing meshes on the ground). */
  get feetOffset(): number {
    return this.cfg.halfHeight + this.cfg.radius
  }

  update(dt: number, gravityY: number): void {
    this.prevPosition.copy(this.position)

    if (this.grounded && this.intent.jump) {
      this.velocityY = this.cfg.jumpSpeed
    }
    this.velocityY += gravityY * this.cfg.gravityScale * dt
    // terminal-ish clamp so a long fall never tunnels
    this.velocityY = Math.max(this.velocityY, -55)

    const desired = {
      x: this.intent.vx * dt,
      y: this.velocityY * dt,
      z: this.intent.vz * dt,
    }
    this.controller.computeColliderMovement(this.collider, desired)
    const move = this.controller.computedMovement()
    const t = this.body.translation()
    const next = { x: t.x + move.x, y: t.y + move.y, z: t.z + move.z }
    this.body.setNextKinematicTranslation(next)
    // kinematic position-based bodies apply next translation on world.step();
    // track it now so gameplay code sees the post-move position this frame.
    this.position.set(next.x, next.y, next.z)

    this.grounded = this.controller.computedGrounded()
    if (this.grounded && this.velocityY < 0) this.velocityY = 0
    this.intent.jump = false
  }

  teleport(x: number, y: number, z: number): void {
    this.body.setTranslation({ x, y, z }, true)
    this.position.set(x, y, z)
    this.prevPosition.set(x, y, z)
    this.velocityY = 0
  }
}

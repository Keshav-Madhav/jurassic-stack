// Third-person camera: pointer-controlled yaw/pitch orbit on a boom behind the
// player. Look input is applied immediately (never smoothed — lag on the mouse
// is the classic "camera fights you" feel); only the follow point is smoothed.
// The boom shortens when terrain would occlude the player, sampled against the
// same height function everything else uses.
import * as THREE from 'three'
import { heightAt } from './heightmap'
import { Input } from './input'

const BOOM_LENGTH = 5.2
const HEAD_HEIGHT = 1.55
const SENSITIVITY = 0.0023
const PITCH_MIN = -1.25
const PITCH_MAX = 0.55
const TERRAIN_CLEARANCE = 0.4

export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera
  yaw = 0
  pitch = -0.18
  private follow = new THREE.Vector3()
  private first = true

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 2600)
  }

  /** Skip the follow smoothing on the next update (teleports). */
  snap(): void {
    this.first = true
  }

  update(input: Input, targetFeet: THREE.Vector3, dt: number): void {
    const { dx, dy } = input.drainPointer()
    this.yaw -= dx * SENSITIVITY
    this.pitch -= dy * SENSITIVITY
    this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.pitch))

    const head = targetFeet.clone()
    head.y += HEAD_HEIGHT
    if (this.first) {
      this.follow.copy(head)
      this.first = false
    } else {
      // exponential smoothing, framerate-independent
      const k = 1 - Math.exp(-dt * 14)
      this.follow.lerp(head, k)
    }

    // boom direction from yaw/pitch (behind and above the player)
    const cp = Math.cos(this.pitch)
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * cp,
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * cp,
    )

    // shorten the boom if terrain occludes: march along it and clamp
    let boom = BOOM_LENGTH
    const SAMPLES = 8
    for (let i = 1; i <= SAMPLES; i++) {
      const t = (i / SAMPLES) * BOOM_LENGTH
      const px = this.follow.x + dir.x * t
      const py = this.follow.y + dir.y * t
      const pz = this.follow.z + dir.z * t
      const ground = heightAt(px, pz)
      if (py < ground + TERRAIN_CLEARANCE) {
        boom = Math.max(0.8, t - BOOM_LENGTH / SAMPLES)
        break
      }
    }

    this.camera.position.copy(this.follow).addScaledVector(dir, boom)
    this.camera.lookAt(this.follow)
  }
}

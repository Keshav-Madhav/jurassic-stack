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
import { Mover, type MoverConfig } from './mover'
import type { Physics } from './physics'
import type { SpeciesDef } from './species'

export type DinoState = 'idle' | 'wander' | 'aggro' | 'flee' | 'ko' | 'tamed'

const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)
const modelCache = new Map<string, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>>()

async function loadModel(url: string) {
  if (!modelCache.has(url)) modelCache.set(url, loader.loadAsync(url))
  const gltf = await modelCache.get(url)!
  return { scene: (await import('three/addons/utils/SkeletonUtils.js')).clone(gltf.scene) as THREE.Group, animations: gltf.animations }
}

export class Dino {
  readonly object = new THREE.Group()
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
  private stateT = 2 + Math.random() * 3
  private target = new THREE.Vector3()
  private home = new THREE.Vector3()
  private heading = Math.random() * Math.PI * 2
  private speed = 0
  private moveWeight = 0
  private runBlend = 0
  private attackCooldown = 0
  private tmpN = new THREE.Vector3()

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
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const s = this.species.height / (size.y || 1)
    model.scale.setScalar(s)
    const box2 = new THREE.Box3().setFromObject(model)
    model.position.y -= box2.min.y
    this.object.add(model)

    this.mixer = new THREE.AnimationMixer(model)
    for (const slot of ['idle', 'walk', 'run', 'attack', 'ko'] as const) {
      const clip = animations.find((a) => this.species.clips[slot].test(a.name))
      if (clip) this.actions[slot] = this.mixer.clipAction(clip)
    }
    this.actions.idle?.play()
    this.actions.walk?.play()
    if (this.actions.walk) this.actions.walk.weight = 0
    if (this.actions.run) {
      this.actions.run.play()
      this.actions.run.weight = 0
    }
  }

  /** A hit from the player. torporHit=true for fists (KO route), false for weapons (damage route). */
  takeHit(damage: number, torporGain: number, fromX: number, fromZ: number): void {
    if (this.state === 'ko' || this.state === 'tamed') return
    this.hp -= damage
    this.torpor += torporGain
    if (this.hp <= 0) {
      // graybox death = despawn after collapse; ragdolls arrive at M7
      this.state = 'ko'
      this.playKo()
      this.object.visible = false
      return
    }
    if (this.torpor >= this.species.torporMax) {
      this.state = 'ko'
      this.playKo()
      return
    }
    // provoked: aggressive species turn on the attacker, skittish bolt
    if (this.species.temperament === 'aggressive') {
      this.state = 'aggro'
      this.stateT = 12
    } else {
      this.state = 'flee'
      this.stateT = 6
      this.target.set(this.object.position.x * 2 - fromX, 0, this.object.position.z * 2 - fromZ)
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

  update(dt: number, playerPos: THREE.Vector3, attackPlayer: (damage: number) => void): void {
    this.attackCooldown -= dt
    const pos = this.object.position

    if (this.ridden && this.mover) {
      // position comes from the mover; visuals + anim only
      pos.copy(this.mover.position)
      pos.y -= this.mover.feetOffset
      this.object.rotation.y = this.heading
      const planar = Math.hypot(this.mover.intent.vx, this.mover.intent.vz)
      this.speed = planar
      this.animate(dt, planar / this.species.runSpeed, planar > this.species.walkSpeed * 1.4)
      return
    }

    switch (this.state) {
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
        if (d > 6) this.seek(playerPos.x, playerPos.z, dt, d > 14 ? this.species.runSpeed : this.species.walkSpeed)
        else this.speed = Math.max(0, this.speed - 8 * dt)
        break
      }
      case 'aggro': {
        this.stateT -= dt
        const d = pos.distanceTo(playerPos)
        if (this.stateT <= 0 || d > 40) {
          this.state = 'idle'
          this.stateT = 2
        } else if (d <= this.species.attackRange) {
          this.speed = Math.max(0, this.speed - 10 * dt)
          if (this.attackCooldown <= 0) {
            this.attackCooldown = 1.4
            this.actions.attack?.reset().setLoop(THREE.LoopOnce, 1).play()
            attackPlayer(this.species.attackDamage)
          }
        } else {
          this.seek(playerPos.x, playerPos.z, dt, this.species.runSpeed)
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
        if (this.stateT <= 0) {
          this.pickWanderTarget()
          this.state = 'wander'
        }
        break
      }
      case 'wander': {
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

    pos.y = heightAt(pos.x, pos.z)
    this.object.rotation.y = this.heading
    const running = this.speed > this.species.walkSpeed * 1.4
    this.animate(dt, this.speed / (running ? this.species.runSpeed : this.species.walkSpeed), running)
  }

  private seek(tx: number, tz: number, dt: number, speed: number): void {
    const pos = this.object.position
    const want = Math.atan2(tx - pos.x, tz - pos.z)
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

  private animate(dt: number, moveT: number, running: boolean): void {
    const target = THREE.MathUtils.clamp(moveT, 0, 1)
    this.moveWeight = THREE.MathUtils.lerp(this.moveWeight, target, 1 - Math.exp(-dt * 8))
    this.runBlend = THREE.MathUtils.lerp(this.runBlend, running ? 1 : 0, 1 - Math.exp(-dt * 6))
    const { idle, walk, run } = this.actions
    if (idle) idle.weight = 1 - this.moveWeight
    if (walk) {
      walk.weight = this.moveWeight * (1 - this.runBlend)
      walk.timeScale = 0.6 + target * 0.7
    }
    if (run) run.weight = this.moveWeight * this.runBlend
    this.mixer?.update(dt)
  }

  private playKo(): void {
    const ko = this.actions.ko
    if (ko) {
      ko.reset().setLoop(THREE.LoopOnce, 1).play()
      ko.clampWhenFinished = true
    }
  }

  private stopKo(): void {
    this.actions.ko?.stop()
  }

  private pickWanderTarget(): void {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2
      const r = 8 + Math.random() * 45
      const x = this.home.x + Math.sin(a) * r
      const z = this.home.z + Math.cos(a) * r
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
      radius: 0.55,
      halfHeight: this.species.height * 0.32,
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

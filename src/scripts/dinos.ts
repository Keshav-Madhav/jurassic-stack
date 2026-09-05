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

export type DinoState = 'idle' | 'wander' | 'aggro' | 'flee' | 'ko' | 'tamed'

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
async function loadModel(url: string) {
  if (!modelCache.has(url)) modelCache.set(url, loader.loadAsync(url))
  const gltf = await modelCache.get(url)!
  await whenMyTurn()
  return { scene: (await import('three/addons/utils/SkeletonUtils.js')).clone(gltf.scene) as THREE.Group, animations: gltf.animations }
}

/** wild dinos beyond SLEEP go dormant; they wake inside WAKE */
const DORMANT_SLEEP = 680
const DORMANT_WAKE = 600

export class Dino {
  /** interpolation factor between the last two physics steps (main loop sets it each frame) */
  static renderAlpha = 1
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
      }
    })
    this.model = model
    // a dormant rig is DETACHED, not hidden: three.js walks every Object3D
    // in the scene each frame to update world matrices, visible or not, and
    // 1500 rigs × ~100 bones was 30 ms of CPU a frame (M15 jitter meter)
    if (!this.dormant) this.object.add(model)

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
    this.distToPlayer = pos.distanceTo(playerPos)
    // dormancy: a wild dino far from the player is frozen and undrawn (200 on
    // the map, a few dozen ever simulated). Tames, KOs and anything already
    // aggroed stay live; hysteresis keeps the edge from flickering.
    const wildIdle = !this.ridden && (this.state === 'idle' || this.state === 'wander' || this.state === 'flee')
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
        if (d > 6) this.seekVia(playerPos, dt, d > 14 ? this.species.runSpeed : this.species.walkSpeed)
        else {
          this.speed = Math.max(0, this.speed - 8 * dt)
          this.waypoints.length = 0
        }
        break
      }
      case 'aggro': {
        this.stateT -= dt
        const d = pos.distanceTo(playerPos)
        if (this.stateT <= 0 || d > 40) {
          this.state = 'idle'
          this.stateT = 2
          this.waypoints.length = 0
        } else if (d <= this.species.attackRange) {
          this.speed = Math.max(0, this.speed - 10 * dt)
          this.waypoints.length = 0
          if (this.attackCooldown <= 0) {
            this.attackCooldown = 1.4
            this.actions.attack?.reset().setLoop(THREE.LoopOnce, 1).play()
            attackPlayer(this.species.attackDamage)
          }
        } else {
          this.seekVia(playerPos, dt, this.species.runSpeed)
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
    this.object.rotation.y = this.heading
    this.object.rotation.x = THREE.MathUtils.clamp(Math.atan2(hBack - hFront, 1.6), -0.3, 0.3)
    const running = this.speed > this.species.walkSpeed * 1.4
    this.animate(dt, this.speed / (running ? this.species.runSpeed : this.species.walkSpeed), running)
  }

  /** Wild aggressive dinos attack on proximity (territorial). */
  private maybeAggro(playerPos: THREE.Vector3): boolean {
    if (this.species.temperament !== 'aggressive' || this.species.aggroRange <= 0) return false
    if (this.object.position.distanceTo(playerPos) > this.species.aggroRange) return false
    this.state = 'aggro'
    this.stateT = 12
    this.actions.attack // (roar happens via flavor clip on entry when present)
    this.flavorActions[1]?.reset().play() // call_alert if loaded
    return true
  }

  /** Packmates join a fight: called by the herd manager when one aggros. */
  joinPack(): void {
    if (this.state === 'idle' || this.state === 'wander') {
      this.state = 'aggro'
      this.stateT = 10
    }
  }

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
      walk.timeScale = 0.6 + target * 0.7
    }
    if (run) run.weight = this.moveWeight * this.runBlend
    // distance-throttled animation (the classic skinned-crowd win): far dinos
    // tick their mixers every Nth frame with accumulated dt
    const d = this.distToPlayer
    const every = d > 260 ? 8 : d > 120 ? 3 : 1
    this.mixerSkip += 1
    this.mixerAccum += dt
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

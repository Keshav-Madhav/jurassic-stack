// One wild raptor on a tiny steering brain: IDLE ⇄ WANDER with turn-rate-
// limited seek, ground-clamped to the shared height function. This grows into
// the generic data-driven dino brain at M4 (species table); the graybox proves
// the shape: load → normalize scale → FSM → steering → animation crossfade.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { heightAt, normalAt, SEA_LEVEL } from './heightmap'

const WALK_SPEED = 2.1
const TURN_RATE = 2.6 // rad/s
const WANDER_RADIUS = 45
const ARRIVE_DIST = 1.6

type State = 'idle' | 'wander'

export class Dino {
  readonly object = new THREE.Group()
  private mixer: THREE.AnimationMixer | null = null
  private idleAction: THREE.AnimationAction | null = null
  private walkAction: THREE.AnimationAction | null = null
  private state: State = 'idle'
  private stateT = 2
  private target = new THREE.Vector3()
  private home = new THREE.Vector3()
  private heading = 0
  private speed = 0
  private walkWeight = 0
  private tmpNormal = new THREE.Vector3()

  constructor(x: number, z: number) {
    this.home.set(x, 0, z)
    this.object.position.set(x, heightAt(x, z), z)
    this.heading = Math.random() * Math.PI * 2
    this.object.rotation.y = this.heading
  }

  async load(url = 'models/dinos/Velociraptor.glb'): Promise<void> {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const gltf = await loader.loadAsync(url)
    const model = gltf.scene

    // normalize to ~1.8 m tall, feet at local y=0
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const s = 1.8 / (size.y || 1)
    model.scale.setScalar(s)
    const box2 = new THREE.Box3().setFromObject(model)
    model.position.y -= box2.min.y
    this.object.add(model)

    this.mixer = new THREE.AnimationMixer(model)
    const find = (re: RegExp) => gltf.animations.find((a) => re.test(a.name))
    const idle = find(/^idle_?0?1$/i) ?? find(/idle/i) ?? gltf.animations[0]
    const walk = find(/^walk$/i) ?? find(/walk/i) ?? gltf.animations[0]
    this.idleAction = this.mixer.clipAction(idle)
    this.walkAction = this.mixer.clipAction(walk)
    this.idleAction.play()
    this.walkAction.play()
    this.walkAction.weight = 0
  }

  update(dt: number): void {
    this.stateT -= dt

    if (this.state === 'idle') {
      this.speed = Math.max(0, this.speed - 6 * dt)
      if (this.stateT <= 0) {
        this.pickTarget()
        this.state = 'wander'
      }
    } else {
      const dx = this.target.x - this.object.position.x
      const dz = this.target.z - this.object.position.z
      const dist = Math.hypot(dx, dz)
      if (dist < ARRIVE_DIST) {
        this.state = 'idle'
        this.stateT = 2 + Math.random() * 4
      } else {
        // turn-rate-limited steering toward the target
        const want = Math.atan2(dx, dz)
        let d = want - this.heading
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        const maxTurn = TURN_RATE * dt
        this.heading += THREE.MathUtils.clamp(d, -maxTurn, maxTurn)
        // slow into sharp turns, accelerate on the straight
        const align = 1 - Math.min(1, Math.abs(d) / Math.PI) * 0.7
        this.speed = THREE.MathUtils.lerp(this.speed, WALK_SPEED * align, 1 - Math.exp(-dt * 4))
        this.object.position.x += Math.sin(this.heading) * this.speed * dt
        this.object.position.z += Math.cos(this.heading) * this.speed * dt
      }
    }

    // ground clamp + facing
    this.object.position.y = heightAt(this.object.position.x, this.object.position.z)
    this.object.rotation.y = this.heading

    // animation: crossfade idle ⇄ walk by actual speed
    const targetWeight = THREE.MathUtils.clamp(this.speed / WALK_SPEED, 0, 1)
    this.walkWeight = THREE.MathUtils.lerp(this.walkWeight, targetWeight, 1 - Math.exp(-dt * 8))
    if (this.walkAction && this.idleAction) {
      this.walkAction.weight = this.walkWeight
      this.idleAction.weight = 1 - this.walkWeight
      // walk cycle speed tracks ground speed so feet don't slide
      this.walkAction.timeScale = 0.6 + (this.speed / WALK_SPEED) * 0.7
    }
    this.mixer?.update(dt)
  }

  private pickTarget(): void {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2
      const r = 8 + Math.random() * WANDER_RADIUS
      const x = this.home.x + Math.sin(a) * r
      const z = this.home.z + Math.cos(a) * r
      const h = heightAt(x, z)
      if (h < SEA_LEVEL + 1) continue // stay out of the water
      if (normalAt(x, z, this.tmpNormal).y < 0.72) continue // avoid steep ground
      this.target.set(x, h, z)
      return
    }
    // nowhere good found: stay put a bit longer
    this.state = 'idle'
    this.stateT = 3
  }
}

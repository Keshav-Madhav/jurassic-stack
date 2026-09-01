// Jurassic Stack — M3 graybox: chunked island, Rapier KCC player, third-person
// camera, one wandering raptor, day-night cycle with the M2 grade curve.
//
// Loop shape: fixed 60 Hz simulation steps via accumulator (physics + player),
// render at rAF with player interpolation. AI + animation tick at render rate.
import * as THREE from 'three'
import { Terrain } from './terrain'
import { Physics, FIXED_DT } from './physics'
import { Input } from './input'
import { Player } from './player'
import { ThirdPersonCamera } from './camera'
import { DayNight } from './daynight'
import { Dino } from './dino'
import { Hud } from './hud'
import { heightAt, SPAWN, SEA_LEVEL, HALF_SIZE } from './heightmap'

async function boot(): Promise<void> {
  const app = document.getElementById('app')!
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(innerWidth, innerHeight)
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  app.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const daynight = new DayNight(renderer, scene)

  const terrain = new Terrain()
  scene.add(terrain.group)

  // ocean: a simple plane at sea level, graybox stand-in for M5's real water
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF_SIZE * 6, HALF_SIZE * 6).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2e6ba8, roughness: 0.35, transparent: true, opacity: 0.92 }),
  )
  ocean.position.y = SEA_LEVEL
  scene.add(ocean)

  const physics = new Physics()
  await physics.init()

  const spawnPos = new THREE.Vector3(SPAWN.x, heightAt(SPAWN.x, SPAWN.z) + 1.2, SPAWN.z)
  const player = new Player(physics, spawnPos)
  scene.add(player.object)

  const input = new Input(renderer.domElement)
  const cam = new ThirdPersonCamera(innerWidth / innerHeight)
  cam.yaw = 0 // yaw 0 looks north (-z): the volcano sightline from spawn

  // one raptor living near spawn
  const dino = new Dino(SPAWN.x + 26, SPAWN.z - 30)
  scene.add(dino.object)
  void dino.load() // async; scene works before it resolves

  const hud = new Hud(document.getElementById('hud')!)
  const status = document.getElementById('status')!
  status.textContent = `graybox · three r${THREE.REVISION}`

  addEventListener('resize', () => {
    cam.camera.aspect = innerWidth / innerHeight
    cam.camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
  })
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyT') daynight.setTime(daynight.time + 1 / 24)
  })

  // debug interface for tools/shots.mjs and gate verification
  const dbg = {
    setTime: (t: number) => daynight.setTime(t),
    teleport: (x: number, z: number) => player.mover.teleport(x, heightAt(x, z) + 1.2, z),
    setCam: (yaw: number, pitch: number) => { cam.yaw = yaw; cam.pitch = pitch },
    setIntent: (vx: number, vz: number) => { debugIntent = vx || vz ? { vx, vz } : null },
    player: () => ({ ...player.mover.position }),
    groundAt: (x: number, z: number) => heightAt(x, z),
    fps: () => hud.fps,
    ready: false,
  }
  let debugIntent: { vx: number; vz: number } | null = null
  ;(window as unknown as { __g: typeof dbg }).__g = dbg

  let accumulator = 0
  let last = performance.now()

  function frame(now: number): void {
    requestAnimationFrame(frame)
    if (document.hidden) {
      last = now
      return
    }
    let dt = (now - last) / 1000
    last = now
    dt = Math.min(dt, 0.1) // clamp tab-switch spikes

    // fixed-step simulation
    accumulator += dt
    while (accumulator >= FIXED_DT) {
      physics.ensureTerrainAround(player.mover.position.x, player.mover.position.z)
      player.fixedUpdate(FIXED_DT, input, cam.yaw, physics.world.gravity.y, debugIntent ?? undefined)
      physics.step()
      accumulator -= FIXED_DT
    }
    const alpha = accumulator / FIXED_DT

    // render-rate updates
    player.render(alpha)
    dino.update(dt)
    daynight.advance(dt)
    terrain.update(player.mover.position.x, player.mover.position.z)
    cam.update(input, player.object.position, dt)
    hud.tick(dt, player.mover.position.x, player.mover.position.y, player.mover.position.z, daynight.time)

    renderer.render(scene, cam.camera)
    dbg.ready = true
  }
  requestAnimationFrame(frame)
}

void boot()

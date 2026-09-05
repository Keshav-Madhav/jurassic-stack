// Jurassic Stack — M4: the core loop. Gather → craft → build → tame → ride,
// on the M3 graybox island, with save/load. Fixed 60 Hz simulation, render-
// rate AI/animation, DOM HUD, and a __g.game debug API that the E2E gate
// drives through the same functions the input handlers call.
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { Terrain } from './terrain'
import { Physics, FIXED_DT } from './physics'
import { Input } from './input'
import { Player } from './player'
import { ThirdPersonCamera } from './camera'
import { DayNight, DAY_LENGTH_S } from './daynight'
import { Dino } from './dinos'
import { SPECIES } from './species'
import { Scatter, setLodBands } from './scatter'
import { Building, type PieceKind } from './building'
import { Ruins } from './ruins'
import { Keystones } from './keystones'
import { Beacon } from './beacon'
import { Inventory } from './inventory'
import { ITEMS, type ItemId } from './items'
import { Hud } from './hud'
import { saveGame, loadGame, SAVE_VERSION, type SaveFile } from './save'
import { heightAt, loadHeightmap, worldMeta, SPAWN } from './heightmap'
import { loadNavmesh, findPath } from './navmesh'
import { WaterSystem } from './water'
import { wildPopulation } from './population'
import { GrassField } from './grass'
import { SkyExtras } from './sky-extras'
import { Ambience } from './ambience'

const SWING_COOLDOWN = 0.45
const REACH = 3.2
const INTERACT_RANGE = 3.8

async function boot(): Promise<void> {
  await loadHeightmap() // everything below samples heightAt
  await loadNavmesh()
  const app = document.getElementById('app')!
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(innerWidth, innerHeight)
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.3)) // small resolution trade for fps (user-approved)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap // Soft variant cost ~10fps; radius softens enough
  // shadows redraw at half frame rate — the sun crawls, and re-rendering
  // ~17K tree casters into the 2048 map every frame was the top GPU cost
  renderer.shadowMap.autoUpdate = false
  app.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const daynight = new DayNight(renderer, scene)
  const terrain = new Terrain()
  scene.add(terrain.group)
  terrain.group.name = 'terrain'

  const water = new WaterSystem()
  water.build()
  scene.add(water.group)
  water.group.name = 'water'

  const physics = new Physics()
  await physics.init()

  const save = await loadGame()

  // sanitize saved position: heal saves already corrupted by the park bug,
  // out-of-bounds coords, or anything non-finite
  if (save) {
    const p = save.player
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.abs(p.x) > 1000 || Math.abs(p.z) > 1000) {
      p.x = SPAWN.x
      p.z = SPAWN.z
    }
    const ground = heightAt(p.x, p.z)
    if (!Number.isFinite(p.y) || p.y < ground - 0.5 || p.y > ground + 250) {
      p.y = ground + 1.2
    }
  }
  const spawnPos = save
    ? new THREE.Vector3(save.player.x, save.player.y + 0.5, save.player.z)
    : new THREE.Vector3(SPAWN.x, heightAt(SPAWN.x, SPAWN.z) + 1.2, SPAWN.z)
  const player = new Player(physics, spawnPos)
  void player.load() // async; capsule-less until the Barbarian arrives
  scene.add(player.object)
  let playerHp = save?.player.hp ?? 100
  let creative = save?.creative ?? false

  const input = new Input(renderer.domElement)
  const cam = new ThirdPersonCamera(innerWidth / innerHeight)
  cam.yaw = 0

  const inventory = new Inventory()
  if (save) inventory.restore(save.inventory as ReturnType<Inventory['serialize']>)

  const scatter = new Scatter()
  await scatter.load(renderer)
  const grass = new GrassField()
  scene.add(grass.group)
  grass.group.name = 'grass'
  const skyExtras = new SkyExtras()
  scene.add(skyExtras.group)
  skyExtras.group.name = 'skyExtras'
  const ambience = new Ambience()
  // audio needs a gesture: the first click / key starts the soundscape
  const startAudio = () => { ambience.start(); window.removeEventListener('pointerdown', startAudio); window.removeEventListener('keydown', startAudio) }
  window.addEventListener('pointerdown', startAudio)
  window.addEventListener('keydown', startAudio)
  scene.add(scatter.group)
  scatter.group.name = 'scatter'
  if (save) scatter.restore(save.deadNodes as { id: number; respawnAt: number }[])

  const ruins = new Ruins()
  await ruins.build(physics)
  scene.add(ruins.group)
  ruins.group.name = 'ruins'

  const keystones = new Keystones()
  keystones.build()
  scene.add(keystones.group)
  keystones.group.name = 'keystones'
  if (save?.keystones) keystones.restore(save.keystones as string[])

  // the caldera door: a stone slab sealing the gate arch until all five
  // keystones are set (the arc's lock)
  const gateSite = worldMeta!.ruinSites.find((r) => r.tag === 'caldera-gate')!
  // (sized to the 15 m arch: 12 × 15.5 m slab)
  const doorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(12, 15.5, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x3c3a38, roughness: 0.95 }),
  )
  const doorGroundY = heightAt(gateSite.x, gateSite.z)
  // the slab fills the arch, which stands 19 m north of the site (against the face)
  const doorZ = gateSite.z - 19
  doorMesh.position.set(gateSite.x, doorGroundY + 7.4, doorZ)
  doorMesh.castShadow = true
  doorMesh.receiveShadow = true
  scene.add(doorMesh)
  let doorOpen = save?.doorOpen ?? false
  let doorAnim = 0
  const doorCollider = physics.world.createCollider(
    RAPIER.ColliderDesc.cuboid(6, 7.75, 0.8).setTranslation(gateSite.x, doorGroundY + 7.4, doorZ),
  )
  if (doorOpen) {
    doorMesh.position.y = doorGroundY - 8.5
    physics.world.removeCollider(doorCollider, false)
  }

  // THE BEACON — the arc's end, on the crater bench at the top of the Ravine
  const beaconSite = worldMeta!.ruinSites.find((r) => r.tag === 'crater-beacon')!
  const beacon = new Beacon(beaconSite.x, heightAt(beaconSite.x, beaconSite.z), beaconSite.z)
  scene.add(beacon.group)
  beacon.group.name = 'beacon'
  physics.world.createCollider(RAPIER.ColliderDesc.cylinder(1.4, 7.4).setTranslation(beaconSite.x, beacon.groundY + 1.4, beaconSite.z))
  physics.world.createCollider(RAPIER.ColliderDesc.cylinder(3.5, 1.6).setTranslation(beaconSite.x, beacon.groundY + 2.7 + 3.5, beaconSite.z))
  let beaconLit = save?.beaconLit ?? false
  if (beaconLit) beacon.light(true)

  const building = new Building(physics)
  scene.add(building.group)
  building.group.name = 'building'
  if (save) building.restore(save.pieces as ReturnType<Building['serialize']>)

  if (save) daynight.setTime(save.time)
  if (save?.days) daynight.elapsedDays = save.days as number

  // --- dinos ---
  const dinos: Dino[] = []
  const spawnDino = (speciesId: string, x: number, z: number): Dino => {
    const d = new Dino(SPECIES[speciesId] ?? SPECIES.raptor, x, z, dinos.length)
    dinos.push(d)
    scene.add(d.object)
    void d.load()
    return d
  }
  // TAMED dinos persist from the save; the WILD roster always spawns fresh —
  // otherwise old saves keep their old (smaller) populations forever and
  // roster growth never reaches returning players (user: "still no dinos")
  if (save) {
    for (const row of save.dinos as ReturnType<Dino['serialize']>[]) {
      if (!row.alive || row.state !== 'tamed') continue
      const d = spawnDino(row.species, row.x, row.z)
      d.hp = row.hp
      d.saddled = row.saddled
      d.tameProgress = row.tame
      d.state = 'tamed'
    }
  }
  // wild roster (fresh every load): ~200 across the island by habitat —
  // packs in the woods, herds on the open ground, rexes in the north. Far
  // ones sleep (Dino.dormant), so the count costs nothing until you arrive.
  for (const w of wildPopulation()) spawnDino(w.species, w.x, w.z)

  const hud = new Hud(document.getElementById('hud')!, inventory, (id) => {
    if (inventory.craftById(id)) hud.toast(`Crafted ${ITEMS[id].name}`)
  })
  const vignette = document.createElement('div')
  vignette.id = 'hud-vignette'
  document.body.appendChild(vignette)
  const status = document.getElementById('status')!
  status.textContent = `core loop · three r${THREE.REVISION}`

  // --- interaction state ---
  let riding: Dino | null = null
  let swingT = 0
  let camKick = 0
  const raycaster = new THREE.Raycaster()
  const aimPoint = new THREE.Vector3()

  const feetPos = (): THREE.Vector3 => {
    if (riding?.mover) {
      const p = riding.mover.position.clone()
      p.y -= riding.mover.feetOffset
      return p
    }
    return player.mover.position.clone().setY(player.mover.position.y - player.mover.feetOffset)
  }

  /** Point on the terrain (or 6 m out) the camera center is aiming at. */
  const updateAim = (): THREE.Vector3 => {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), cam.camera)
    // march the ray against the height function (terrain aim, cheap + exact)
    const o = raycaster.ray.origin
    const dir = raycaster.ray.direction
    for (let t = 2; t < 14; t += 0.5) {
      const px = o.x + dir.x * t
      const py = o.y + dir.y * t
      const pz = o.z + dir.z * t
      if (py <= heightAt(px, pz)) {
        aimPoint.set(px, heightAt(px, pz), pz)
        return aimPoint
      }
    }
    // ray missed nearby terrain: fall back to "in front of the player", which
    // is deterministic (camera drift on the boom must not change the build cell)
    const feet = feetPos()
    const vd = cam.camera.getWorldDirection(new THREE.Vector3())
    const len = Math.hypot(vd.x, vd.z) || 1
    aimPoint.set(feet.x + (vd.x / len) * 3.5, 0, feet.z + (vd.z / len) * 3.5)
    aimPoint.y = heightAt(aimPoint.x, aimPoint.z)
    return aimPoint
  }

  const nearestDino = (range: number, filter: (d: Dino) => boolean, atX?: number, atZ?: number): Dino | null => {
    const from = feetPos()
    let best: Dino | null = null
    let bd = range
    for (const d of dinos) {
      if (!d.object.visible || d === riding || !filter(d)) continue
      const dist = atX !== undefined && atZ !== undefined
        ? Math.hypot(d.object.position.x - atX, d.object.position.z - atZ)
        : d.object.position.distanceTo(from)
      if (dist < bd) {
        bd = dist
        best = d
      }
    }
    return best
  }

  const hurtPlayer = (damage: number): void => {
    if (creative) return
    playerHp -= damage
    vignette.classList.add('hurt')
    setTimeout(() => vignette.classList.remove('hurt'), 220)
    if (playerHp <= 0) {
      playerHp = 100
      if (riding) dismount()
      player.mover.teleport(SPAWN.x, heightAt(SPAWN.x, SPAWN.z) + 1.2, SPAWN.z)
      hud.toast('You died. Washed back ashore.')
    }
  }

  // --- core verbs (used by both input handlers and the E2E gate) ---
  const swing = (): boolean => {
    if ((swingT > 0 && !creative) || riding) return false
    swingT = SWING_COOLDOWN
    camKick = 0.05
    const held = inventory.held

    // placeables: LMB places the ghost
    if (held && ITEMS[held].placeable) {
      const placed = building.place(held as PieceKind, updateAim())
      if (placed && inventory.remove(placed, 1)) {
        hud.toast(`Placed ${ITEMS[placed].name}`)
        return true
      }
      return false
    }

    player.playSwing(held)
    // dino in reach and roughly ahead? spear damages, fists build torpor
    const target = nearestDino(REACH, (d) => d.state !== 'ko' && d.state !== 'tamed')
    if (target) {
      const from = feetPos()
      if (creative) target.takeHit(0, 999, from.x, from.z) // creative: instant KO
      else if (held === 'spear') target.takeHit(12, 5, from.x, from.z)
      else if (held === 'hatchet') target.takeHit(7, 4, from.x, from.z)
      else target.takeHit(2, 8, from.x, from.z) // fists: ~20 punches to KO
      hud.toast(target.state === 'ko' ? `${target.species.name} knocked out!` : `Hit ${target.species.name} (torpor ${Math.round(target.torpor)}/${target.species.torporMax})`)
      return true
    }

    // resource node under the crosshair (reach measured from the player)
    raycaster.setFromCamera(new THREE.Vector2(0, 0), cam.camera)
    const node = scatter.raycast(raycaster, feetPos(), REACH + 1.2)
    if (node) {
      const isWood = node.kind === 'tree' || node.kind === 'pine'
      const hits = creative ? 99 : held === 'hatchet' && isWood ? 2 : 1
      let yielded: Partial<Record<ItemId, number>> | null = null
      for (let i = 0; i < hits && node.alive; i++) yielded = scatter.hit(node) ?? yielded
      if (yielded && Object.keys(yielded).length) {
        const parts: string[] = []
        for (const [id, n] of Object.entries(yielded)) {
          inventory.add(id as ItemId, n)
          parts.push(`+${n} ${ITEMS[id as ItemId].icon}`)
        }
        scatter.flushColliderDrops(physics)
        hud.toast(parts.join('  '))
      }
      return true
    }
    return false
  }

  const dismount = (): void => {
    if (!riding) return
    const d = riding
    riding = null
    d.endRide()
    scene.add(player.object) // detach from the seat
    player.riding = false
    const side = new THREE.Vector3(Math.cos(d.object.rotation.y), 0, -Math.sin(d.object.rotation.y))
    const px = d.object.position.x + side.x * 2.2
    const pz = d.object.position.z + side.z * 2.2
    player.mover.teleport(px, heightAt(px, pz) + 1.2, pz)
    hud.toast('Dismounted')
  }

  const interact = (): boolean => {
    if (riding) {
      dismount()
      return true
    }
    // the caldera door
    const f0 = feetPos()
    if (!doorOpen && Math.hypot(f0.x - gateSite.x, f0.z - gateSite.z) < 8) {
      if (keystones.collectedCount >= keystones.total) {
        doorOpen = true
        doorAnim = 4
        physics.world.removeCollider(doorCollider, false)
        hud.toast('The keystones flare — the caldera gate grinds open.')
        return true
      }
      hud.toast(`The gate is sealed. ${keystones.total - keystones.collectedCount} keystones missing (N to seek).`)
      return true
    }
    // the beacon
    if (!beaconLit && Math.hypot(f0.x - beaconSite.x, f0.z - beaconSite.z) < 11) {
      if (keystones.collectedCount >= keystones.total) {
        beaconLit = true
        beacon.light()
        ambience.swell()
        hud.toast('The keystones burn — the beacon takes.')
        const tamed = dinos.filter((d) => d.state === 'tamed').length
        setTimeout(() => hud.credits([
          `${keystones.total} keystones carried through the caldera door`,
          `${tamed} dino${tamed === 1 ? '' : 's'} tamed · ${building.count()} pieces built`,
          `${Math.round(daynight.elapsedDays * 10) / 10} island days lived (one is ${Math.round(DAY_LENGTH_S / 60)} real minutes)`,
        ]), 2800)
        return true
      }
      hud.toast('The brazier is cold — it wants the fire of all five keystones.')
      return true
    }
    // keystones (the arc's thread)
    const got = keystones.collectNear(f0.x, f0.z)
    if (got) {
      const n = keystones.collectedCount
      hud.toast(n === keystones.total
        ? `Keystone ${n}/${keystones.total} — the caldera gate awaits (N to point the way)`
        : `Keystone ${n}/${keystones.total} collected (${got.tag})`)
      return true
    }
    // feed a KO'd dino
    const ko = nearestDino(INTERACT_RANGE, (d) => d.state === 'ko')
    if (ko) {
      if (!inventory.remove(ko.species.tameFood, 1)) {
        hud.toast(`Need ${ITEMS[ko.species.tameFood].name}s to tame`)
        return false
      }
      let tamed = ko.feed()
      if (creative) while (!tamed && ko.state === 'ko') tamed = ko.feed()
      hud.toast(tamed ? `${ko.species.name} tamed!` : `Feeding… ${Math.min(100, Math.round(ko.tameProgress))}%`)
      return true
    }
    // saddle / mount a tamed dino
    const tame = nearestDino(INTERACT_RANGE, (d) => d.state === 'tamed')
    if (tame) {
      if (!tame.saddled) {
        if (inventory.remove('saddle', 1)) {
          tame.saddled = true
          hud.toast(`Saddled the ${tame.species.name}`)
          return true
        }
        hud.toast('Needs a saddle')
        return false
      }
      if (!tame.species.rideable) return false
      riding = tame
      tame.beginRide(physics)
      // park the player body, seat the character on the mount
      player.mover.teleport(tame.object.position.x, -520, tame.object.position.z)
      player.riding = true
      tame.object.add(player.object)
      const seat = tame.species.seat
      player.object.position.set(seat.x, seat.y, seat.z)
      player.object.rotation.set(0, 0, 0)
      hud.toast(`Riding the ${tame.species.name} — E to dismount`)
      return true
    }
    return false
  }

  // --- input events ---
  const grantCreativeKit = (): void => {
    for (const id of ['wood', 'stone', 'fiber', 'flint', 'berry'] as ItemId[]) {
      const missing = 999 - inventory.count(id)
      if (missing > 0) inventory.add(id, missing)
    }
    for (const id of ['foundation', 'wall', 'ceiling', 'campfire'] as ItemId[]) {
      const missing = 99 - inventory.count(id)
      if (missing > 0) inventory.add(id, missing)
    }
    if (inventory.count('hatchet') === 0) inventory.add('hatchet', 1)
    if (inventory.count('spear') === 0) inventory.add('spear', 1)
    if (inventory.count('saddle') < 5) inventory.add('saddle', 5 - inventory.count('saddle'))
  }
  const setCreative = (on: boolean): void => {
    creative = on
    hud.setCreative(on)
    if (on) {
      grantCreativeKit()
      hud.toast('Creative mode — double-tap SPACE to fly (space up · shift down)')
    } else {
      player.flying = false
      hud.toast('Survival mode')
    }
  }
  if (creative) {
    hud.setCreative(true)
  }
  let lastSpaceAt = 0
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyT') daynight.setTime(daynight.time + 1 / 24)
    if (e.code === 'KeyC') setCreative(!creative)
    if (e.code === 'KeyF' && !riding) {
      if (inventory.remove('berry', 1)) {
        playerHp = Math.min(100, playerHp + 15)
        hud.toast(`Ate a berry (+15 ♥ → ${Math.ceil(playerHp)})`)
      } else {
        hud.toast('No berries — punch a bush')
      }
    }
    if (e.code === 'Space' && !e.repeat) {
      const now = performance.now()
      if (creative && !riding && now - lastSpaceAt < 300) {
        player.flying = !player.flying
        hud.toast(player.flying ? 'Flight ON' : 'Flight off')
      }
      lastSpaceAt = now
    }
    if (e.code === 'KeyN') {
      const f = feetPos()
      const gate = worldMeta?.ruinSites.find((r) => r.tag === 'caldera-gate')
      const target = keystones.collectedCount < keystones.total ? keystones.nearestMissing(f.x, f.z) : doorOpen && !beaconLit ? beaconSite : gate ?? null
      if (target) {
        const d = Math.hypot(target.x - f.x, target.z - f.z)
        const ang = ((Math.atan2(-(target.x - f.x), -(target.z - f.z)) * 180) / Math.PI + 360) % 360
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
        const label = keystones.collectedCount < keystones.total ? 'keystone' : doorOpen && !beaconLit ? 'the beacon' : 'the caldera gate'
        hud.toast(`Wayfinder: ${label} ${dirs[Math.round(ang / 45) % 8]} · ${Math.round(d)}m`)
      }
    }
    if (e.code === 'KeyE') interact()
    if (e.code === 'Tab') {
      e.preventDefault()
      hud.togglePanel()
    }
    if (/^Digit[1-9]$/.test(e.code)) hud.selectSlot(Number(e.code.slice(5)) - 1)
  })
  addEventListener('mousedown', (e) => {
    if (e.button === 0 && input.pointerLocked) swing()
  })

  // --- save loop ---
  const collectSave = (): SaveFile => {
    // While riding, the player's own body is PARKED at y=-520 — saving that
    // position stranded reloads under the world, falling forever (user-hit).
    // Save the actual play position (mount feet) instead.
    const f = feetPos()
    return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    time: daynight.time,
    days: daynight.elapsedDays,
    player: { x: f.x, y: f.y + 1.0, z: f.z, hp: playerHp },
    creative,
    inventory: inventory.serialize(),
    pieces: building.serialize(),
    deadNodes: scatter.serialize(),
    dinos: dinos.map((d) => d.serialize()),
    keystones: keystones.serialize(),
    doorOpen,
    beaconLit,
    }
  }
  setInterval(() => void saveGame(collectSave()), 30_000)
  addEventListener('pagehide', () => void saveGame(collectSave()))

  addEventListener('resize', () => {
    cam.camera.aspect = innerWidth / innerHeight
    cam.camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
  })

  // --- debug/E2E API: the gate drives the same verbs the input layer calls ---
  let debugIntent: { vx: number; vz: number } | null = null
  /** QA free camera: when set, the render camera detaches from the player. */
  let freeCam: { x: number; y: number; z: number; yaw: number; pitch: number } | null = null
  const dbg = {
    setFreeCam: (x: number, y: number, z: number, yaw: number, pitch: number) => {
      freeCam = { x, y, z, yaw, pitch }
    },
    clearFreeCam: () => {
      freeCam = null
    },
    setTime: (t: number) => daynight.setTime(t),
    teleport: (x: number, z: number) => {
      if (riding?.mover) riding.mover.teleport(x, heightAt(x, z) + 1.4, z)
      else player.mover.teleport(x, heightAt(x, z) + 1.2, z)
      cam.snap()
    },
    setCam: (yaw: number, pitch: number) => { cam.yaw = yaw; cam.pitch = pitch },
    setIntent: (vx: number, vz: number) => { debugIntent = vx || vz ? { vx, vz } : null },
    player: () => ({ ...(riding?.mover ? riding.mover.position : player.mover.position) }),
    groundAt: (x: number, z: number) => heightAt(x, z),
    /** QA: where the PHYSICS ground is under (x,z) — must agree with groundAt */
    physicsGroundAt: (x: number, z: number) => {
      const hit = physics.world.castRay(new RAPIER.Ray({ x, y: 400, z }, { x: 0, y: -1, z: 0 }), 1000, true)
      return hit ? 400 - hit.timeOfImpact : null
    },
    /** QA: hide/show whole layers to attribute what's on screen */
    setLayer: (name: 'water' | 'scatter' | 'terrain', visible: boolean) => {
      const g = name === 'water' ? water.group : name === 'scatter' ? scatter.group : terrain.group
      g.visible = visible
    },
    fps: () => hud.fps,
    /** ms per frame spent in JS (sim+update) vs the render call — tells CPU-bound from GPU-bound */
    perf: () => ({ update: +perfUpdate.toFixed(2), render: +perfRender.toFixed(2), dinos: +perfSec.dinos.toFixed(2), scatter: +perfSec.scatter.toFixed(2), grass: +perfSec.grass.toFixed(2), terrain: +perfSec.terrain.toFixed(2), physics: +perfSec.physics.toFixed(2) }),
    terrainWorker: () => terrain.workerState(),
    /** QA: fog distance multiplier (aerials use 6) */
    setFog: (scale: number) => { daynight.fogScale = scale },
    scene,
    setLod: (bands: { far?: number; mid?: number; cover?: number }) => { const r = setLodBands(bands); lastVisX = Infinity; return r },
    /** QA: what the camera is about to draw — visible, in-frustum meshes per scene group (≈ draw calls before multi-material splits) */
    drawAudit: () => {
      const c = cam.camera
      c.updateMatrixWorld()
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse))
      const out: Record<string, { meshes: number; calls: number; tris: number }> = {}
      const walk = (o: THREE.Object3D, family: string) => {
        if (!o.visible) return
        const fam = o.parent === scene ? (o.name || ((o as THREE.Mesh).isMesh ? 'loose-mesh' : 'dino/other')) : family
        if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry) {
          const m = o as THREE.Mesh
          const inView = !m.frustumCulled || frustum.intersectsObject(m)
          if (inView) {
            const mats = Array.isArray(m.material) ? m.material.length : 1
            const geo = m.geometry
            const triCount = (geo.index ? geo.index.count : geo.attributes.position.count) / 3
            const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1
            const row = (out[fam] ??= { meshes: 0, calls: 0, tris: 0 })
            row.meshes++
            row.calls += mats
            row.tris += triCount * inst
          }
        }
        for (const c of o.children) walk(c, fam)
      }
      for (const c of scene.children) walk(c, c.name || 'dino/other')
      for (const r of Object.values(out)) r.tris = Math.round(r.tris)
      return out
    },
    setPixelRatio: (r: number) => { adaptive = false; pixelRatio = r; renderer.setPixelRatio(r); renderer.setSize(innerWidth, innerHeight) },
    pixelRatio: () => pixelRatio,
    setAdaptive: (on: boolean) => { adaptive = on },
    /** QA: shadow cadence + map size */
    setShadow: (every: number, size?: number) => {
      shadowEvery = Math.max(1, every)
      if (size) { daynight.setShadowSize(size) }
    },
    /** frame-time stats (ms) since the last call — the jitter meter */
    frameStats: () => {
      const a = frameTimes.slice().sort((p, q) => p - q)
      frameTimes.length = 0
      const pick = (f: number) => a.length ? +a[Math.min(a.length - 1, Math.floor(f * a.length))].toFixed(1) : 0
      const worst = worstFrame
      worstFrame = null
      return { n: a.length, p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), max: a.length ? +a[a.length - 1].toFixed(1) : 0, over25: a.filter((v) => v > 25).length, worst }
    },
    renderInfo: () => ({
      calls: renderer.info.render.calls,
      tris: renderer.info.render.triangles,
      geoms: renderer.info.memory.geometries,
      progs: renderer.info.programs?.length ?? 0,
    }),
    ready: false,
    game: {
      swimming: () => player.swimming,
      waterLevelAt: (x: number, z: number) => water.waterLevelAt(x, z),
      waterSpheres: () =>
        water.group.children.map((c) => {
          const g = (c as THREE.Mesh).geometry
          g.computeBoundingSphere()
          const s = g.boundingSphere!
          const pos = g.getAttribute('position')
          let nan = 0
          for (let i = 0; i < pos.count; i++) {
            if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) nan++
          }
          return { radius: +s.radius.toFixed(1), center: s.center.toArray().map((v) => +v.toFixed(0)), nan, culled: (c as THREE.Mesh).frustumCulled }
        }),
      waterNoCull: () => water.group.children.forEach((c) => ((c as THREE.Mesh).frustumCulled = false)),
      waterVertsNear: (x: number, z: number, r: number) => {
        const found: number[][] = []
        water.group.children.forEach((c, ci) => {
          const pos = (c as THREE.Mesh).geometry.getAttribute('position')
          if (!pos) return
          const wp = new THREE.Vector3()
          for (let i = 0; i < pos.count && found.length < 8; i++) {
            wp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(c.matrixWorld)
            if (Math.hypot(wp.x - x, wp.z - z) < r) found.push([ci, +wp.x.toFixed(1), +wp.y.toFixed(1), +wp.z.toFixed(1)])
          }
        })
        return found
      },
      scatterDebug: () => scatter.debugSummary(),
      nodesNear: (x: number, z: number, r: number) => scatter.nodesNear(x, z, r),
      floaters: (t: number) => scatter.floaters(t),
      whatIsThere: (nx: number, ny: number) => {
        raycaster.setFromCamera(new THREE.Vector2(nx, ny), cam.camera)
        const hits = raycaster.intersectObjects(scene.children, true)
        return hits.slice(0, 3).map((h) => {
          const chain: string[] = []
          let o: THREE.Object3D | null = h.object
          while (o && chain.length < 5) {
            chain.push(`${o.type}:${o.name || '?'}`)
            o = o.parent
          }
          const ident = h.instanceId != null ? scatter.identify(h.object, h.instanceId) : null
          return {
            d: +h.distance.toFixed(1),
            y: +h.point.y.toFixed(1),
            inst: h.instanceId ?? null,
            key: ident?.key ?? null,
            node: ident ? { y: +ident.node.y.toFixed(1), scale: +ident.node.scale.toFixed(1), ground: +heightAt(ident.node.x, ident.node.z).toFixed(1) } : null,
            chain: chain.join(' < '),
          }
        })
      },
      nearestNodeInfo: (kind: string) => {
        const from = feetPos()
        let best: { x: number; z: number; scale: number; d: number } | null = null
        for (const n of scatter.nodes) {
          if (!n.alive || n.kind !== kind) continue
          const d = Math.hypot(n.x - from.x, n.z - from.z)
          if (!best || d < best.d) best = { x: n.x, z: n.z, scale: n.scale, d }
        }
        return best
      },
      colliderInfo: () => ({ world: physics.world.colliders.len(), trunks: scatter.trunkColliderCount() }),
      pathTo: (x: number, z: number) => {
        const from = feetPos()
        const p = findPath(from.x, from.y, from.z, x, heightAt(x, z), z)
        return p ? p.length : -1
      },
      probeSwing: () => {
        raycaster.setFromCamera(new THREE.Vector2(0, 0), cam.camera)
        const node = scatter.raycast(raycaster, feetPos(), REACH + 1.2)
        const dino = nearestDino(REACH, (d) => d.state !== 'ko' && d.state !== 'tamed')
        return {
          node: node ? { kind: node.kind, x: +node.x.toFixed(1), z: +node.z.toFixed(1) } : null,
          dino: dino ? dino.species.id : null,
          held: inventory.held,
          ray: { o: raycaster.ray.origin.toArray().map((v) => +v.toFixed(1)), d: raycaster.ray.direction.toArray().map((v) => +v.toFixed(2)) },
        }
      },
      waterSolidRed: () => {
        water.group.children.forEach((c) => {
          const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial
          m.transparent = false
          m.opacity = 1
          m.depthWrite = true
          m.color.set(0xff0000)
          m.needsUpdate = true
        })
      },
      waterDebug: () =>
        water.group.children.map((c) => {
          const m = c as THREE.Mesh
          m.geometry.computeBoundingBox()
          const b = m.geometry.boundingBox!
          return {
            visible: m.visible,
            pos: { x: +m.position.x.toFixed(0), y: +m.position.y.toFixed(1), z: +m.position.z.toFixed(0) },
            box: { min: b.min.toArray().map((v) => +v.toFixed(1)), max: b.max.toArray().map((v) => +v.toFixed(1)) },
          }
        }),
      riverFlowAt: (x: number, z: number) => water.riverFlowAt(x, z),
      swing,
      interact,
      craft: (id: ItemId) => inventory.craftById(id),
      select: (i: number) => hud.selectSlot(i),
      selectItem: (id: ItemId) => {
        const slot = inventory.hotbar.indexOf(id)
        if (slot < 0) return false
        hud.selectSlot(slot)
        return true
      },
      give: (id: ItemId, n: number) => inventory.add(id, n),
      count: (id: ItemId) => inventory.count(id),
      hp: () => playerHp,
      riding: () => riding !== null,
      pieces: () => building.pieces.length,
      dinoStates: () => dinos.map((d) => ({ state: d.state, torpor: d.torpor, saddled: d.saddled })),
      dinoCalib: () => dinos.map((d) => ({ sp: d.species.id, ...d.debugCalib })),
      /** QA: draw state of the nearest dino of a species */
      dinoInfo: (id: string) => { const d = nearestDino(Infinity, (x) => x.species.id === id); return d ? d.drawInfo() : null },
      /** QA: every loaded dino's rendered height vs its species height — offenders beyond ±15% */
      sizeAudit: (tolerance = 0.15) => {
        const out: { sp: string; want: number; got: number; dormant: boolean }[] = []
        for (const d of dinos) {
          const got = d.measuredHeight()
          if (got === null) continue
          if (Math.abs(got - d.species.height) / d.species.height > tolerance) out.push({ sp: d.species.id, want: d.species.height, got: +got.toFixed(2), dormant: d.dormant })
        }
        return out
      },
      nearestNodeDist: () => {
        const from = feetPos()
        let best = Infinity
        for (const n of scatter.nodes) {
          if (!n.alive) continue
          const d = Math.hypot(n.x - from.x, n.z - from.z)
          if (d < best) best = d
        }
        return best
      },
      /** Teleport beside the nearest alive node of a kind and aim at it. */
      gotoNearest: (kind: string) => {
        const from = feetPos()
        let best: { x: number; y: number; z: number; scale: number } | null = null
        let bd = Infinity
        for (const n of scatter.nodes) {
          if (!n.alive || n.kind !== kind) continue
          const d = Math.hypot(n.x - from.x, n.z - from.z)
          if (d >= bd) continue
          // a dino standing by the node would eat the swings (they take priority)
          if (nearestDino(REACH + 6, () => true, n.x, n.z)) continue
          bd = d; best = n
        }
        if (!best) return false
        const px = best.x
        const pz = best.z + 2.4
        player.mover.teleport(px, heightAt(px, pz) + 1.2, pz)
        cam.yaw = Math.atan2(-(best.x - px), -(best.z - pz))
        // aim at the node's mid-height. The center-screen ray pivots through
        // the follow point (the head), so the relevant run is head→node
        // horizontal distance (2.4 m), not camera→node.
        const aimY = best.y + Math.min(best.scale * 0.45, 1.5)
        const headY = heightAt(px, pz) + 1.55
        cam.pitch = THREE.MathUtils.clamp(Math.atan2(aimY - headY, 2.4), -0.9, 0.35)
        cam.snap()
        return true
      },
      /** Teleport beside the nearest dino matching a state. */
      /** QA: stand at the nearest dino in `state` (optionally of one species —
       *  with 1500 wild dinos the nearest idle one is as likely a trike) */
      gotoDino: (state: string, species?: string) => {
        const d = nearestDino(Infinity, (x) => x.state === state && (!species || x.species.id === species))
        if (!d) return false
        const px = d.object.position.x
        const pz = d.object.position.z + 2.2
        player.mover.teleport(px, heightAt(px, pz) + 1.2, pz)
        cam.yaw = 0
        cam.snap()
        return true
      },
      /** QA: stand `dist` m south of the nearest dino of a species, facing it */
      gotoSpecies: (id: string, dist = 8) => {
        const d = nearestDino(Infinity, (x) => x.species.id === id)
        if (!d) return null
        const px = d.object.position.x
        const pz = d.object.position.z + dist
        player.mover.teleport(px, heightAt(px, pz) + 1.2, pz)
        cam.yaw = 0
        cam.snap()
        return { x: d.object.position.x, z: d.object.position.z, state: d.state, dormant: d.dormant }
      },
      lookAtNearestNode: () => {
        const from = feetPos()
        let best: { x: number; y: number; z: number } | null = null
        let bd = Infinity
        for (const n of scatter.nodes) {
          if (!n.alive) continue
          const d = Math.hypot(n.x - from.x, n.z - from.z)
          if (d < bd) { bd = d; best = n }
        }
        if (!best) return false
        const head = feetPos().setY(feetPos().y + 1.55)
        cam.yaw = Math.atan2(-(best.x - head.x), -(best.z - head.z))
        cam.pitch = Math.atan2(best.y + 1 - head.y, Math.hypot(best.x - head.x, best.z - head.z)) * 0.8
        return bd
      },
      setCreative: (on: boolean) => setCreative(on),
      keystoneCount: () => keystones.collectedCount,
      doorOpen: () => doorOpen,
      grantAllKeystones: () => {
        for (const k of keystones.sites) {
          if (!k.collected) keystones.collectNear(k.x, k.z, 5)
        }
        return keystones.collectedCount
      },
      keystoneSites: () => keystones.sites.map((k) => ({ tag: k.tag, x: k.x, z: k.z, collected: k.collected })),
      /** where the caldera-gate slab stands (gates/QA read the world, not constants) */
      gateSite: () => ({ x: gateSite.x, z: gateSite.z }),
      beaconSite: () => ({ x: beaconSite.x, z: beaconSite.z, y: beacon.groundY }),
      beaconLit: () => beaconLit,
      ravinePath: () => worldMeta!.ravine.path,
      spawn: () => ({ x: SPAWN.x, z: SPAWN.z }),
      flying: () => player.flying,
      poseInfo: () => player.poseInfo(),
      setFlying: (on: boolean) => { player.flying = on },
      save: async () => {
        await saveGame(collectSave())
        return true
      },
      wipeAndReload: async () => {
        const { wipeSave } = await import('./save')
        await wipeSave()
        location.reload()
      },
    },
  }
  ;(window as unknown as { __g: typeof dbg }).__g = dbg

  // --- shader warm-up ---
  // three.js compiles a program the first time a material/object combination
  // is drawn; on this scene (instanced props of 20 kinds, 11 skinned species,
  // mid twins, impostor cards, grass, water) that was a 100–150 ms stall the
  // first time each came into view — felt as a hard hitch on the first turn
  // or the first walk out of the meadow (M18). Compile everything up front:
  // every hidden cell made visible, one rig of each species attached, one
  // compile pass + one shadow-mapped frame for the depth variants.
  {
    const t0 = performance.now()
    const toggled: THREE.Object3D[] = []
    scene.traverse((o) => { if (!o.visible) { o.visible = true; toggled.push(o) } })
    const detach: (() => void)[] = []
    const seen = new Set<string>()
    for (const d of dinos) {
      if (seen.has(d.species.id)) continue
      const undo = d.attachForWarmup()
      if (undo) { seen.add(d.species.id); detach.push(undo) }
    }
    renderer.compile(scene, cam.camera)
    renderer.shadowMap.needsUpdate = true
    renderer.render(scene, cam.camera)
    // textures upload on first DRAW, not compile — anything frustum-culled in
    // that one frame would still stall later. Push every texture up now.
    const uploadTextures = (root: THREE.Object3D) => {
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material
        if (!m) return
        for (const mat of Array.isArray(m) ? m : [m]) {
          for (const v of Object.values(mat as unknown as Record<string, unknown>)) {
            if (v && (v as THREE.Texture).isTexture) renderer.initTexture(v as THREE.Texture)
          }
        }
      })
    }
    uploadTextures(scene)
    for (const undo of detach) undo()
    for (const o of toggled) o.visible = false
    // species that finish loading later: compile + upload as each arrives (the
    // rig is attached to its dino at this point; a shadow-mapped frame with
    // the light's box moved onto it compiles the skinned depth variant too)
    Dino.onFirstRig = (id, model) => {
      const t = performance.now()
      const saved = daynight.shadowFocus()
      model.updateMatrixWorld(true)
      const p = new THREE.Vector3()
      model.getWorldPosition(p)
      daynight.focusShadow(p.x, p.z)
      renderer.compile(scene, cam.camera)
      renderer.shadowMap.needsUpdate = true
      renderer.render(scene, cam.camera)
      daynight.focusShadow(saved.x, saved.z)
      uploadTextures(model)
      if (import.meta.env.DEV) console.log(`warm ${id}: ${(performance.now() - t).toFixed(0)} ms`)
    }
    console.log(`shader warm-up: ${renderer.info.programs?.length ?? '?'} programs in ${(performance.now() - t0).toFixed(0)} ms`)
  }

  // --- main loop ---
  let accumulator = 0
  let last = performance.now()
  let frameCount = 0
  let perfUpdate = 0
  let perfRender = 0
  let shadowEvery = 1
  const awake: Dino[] = []
  let lastVisX = Infinity
  let lastVisZ = Infinity
  const perfSec = { dinos: 0, scatter: 0, grass: 0, terrain: 0, physics: 0 }
  /** this frame's raw section times + the worst frame since the last read (the hitch hunt) */
  const frameSec = { dinos: 0, scatter: 0, grass: 0, terrain: 0, physics: 0, update: 0, render: 0, newProgs: 0, newTex: 0 }
  let worstFrame: { ms: number; sec: typeof frameSec; z: number } | null = null
  // frame-time histogram for the jitter hunt: max / p95 since the last read
  const frameTimes: number[] = []

  function frame(now: number): void {
    requestAnimationFrame(frame)
    if (document.hidden) {
      last = now
      return
    }
    const t0 = performance.now()
    frameTimes.push(now - last)
    if (frameTimes.length > 2000) frameTimes.splice(0, 1000)
    let dt = (now - last) / 1000
    last = now
    dt = Math.min(dt, 0.1)
    swingT -= dt
    camKick = Math.max(0, camKick - dt * 0.3)
    if (playerHp < 100) playerHp = Math.min(100, playerHp + dt * 1.5)

    const focus = riding?.mover ? riding.mover.position : player.mover.position

    accumulator += dt
    const tP0 = performance.now()
    while (accumulator >= FIXED_DT) {
      physics.ensureTerrainAround(focus.x, focus.z)
      if (riding?.mover) {
        // rider intent → the dino's mover (the shared-controller payoff)
        const m = riding.mover
        let fwd = 0
        let strafe = 0
        if (input.down('KeyW')) fwd -= 1
        if (input.down('KeyS')) fwd += 1
        if (input.down('KeyA')) strafe -= 1
        if (input.down('KeyD')) strafe += 1
        if (debugIntent) {
          m.intent.vx = debugIntent.vx
          m.intent.vz = debugIntent.vz
        } else {
          const len = Math.hypot(fwd, strafe)
          if (len > 0) {
            const speed = input.down('ShiftLeft') || input.down('ShiftRight')
              ? riding.species.runSpeed
              : riding.species.walkSpeed * 2
            const sin = Math.sin(cam.yaw)
            const cos = Math.cos(cam.yaw)
            m.intent.vx = ((strafe * cos + fwd * sin) / len) * speed
            m.intent.vz = ((fwd * cos - strafe * sin) / len) * speed
          } else {
            m.intent.vx = 0
            m.intent.vz = 0
          }
        }
        if (input.down('Space')) m.intent.jump = true
        if (m.intent.vx || m.intent.vz) riding.setHeading(Math.atan2(m.intent.vx, m.intent.vz))
        m.update(FIXED_DT, physics.world.gravity.y)
      } else {
        const feet = player.mover.position
        const wl = water.waterLevelAt(feet.x, feet.z)
        const flow = wl !== null ? water.riverFlowAt(feet.x, feet.z) : null
        player.fixedUpdate(FIXED_DT, input, cam.yaw, physics.world.gravity.y, wl, flow, debugIntent ?? undefined)
      }
      physics.step()
      accumulator -= FIXED_DT
    }
    perfSec.physics = perfSec.physics * 0.95 + (performance.now() - tP0) * 0.05
    frameSec.physics = performance.now() - tP0
    const alpha = accumulator / FIXED_DT

    // THE JITTER FIX: everything the eye follows — the camera target, the
    // ridden dino — samples the mover BETWEEN physics steps (prev→current by
    // alpha), like the player model already did. Raw step positions advance
    // 0, 1 or 2 steps a frame as the accumulator drifts, and that quantised
    // motion scales with speed: walking shimmered, riding stuttered, flying
    // shook (user report).
    Dino.renderAlpha = alpha
    player.render(alpha, dt) // runs while riding too (seat pose + mixer)
    player.setHeldItem(inventory.held)
    const pFeet = feetPos()
    const renderFeet = (): THREE.Vector3 => {
      const m = riding?.mover ?? player.mover
      const p = new THREE.Vector3().lerpVectors(m.prevPosition, m.position, alpha)
      p.y -= m.feetOffset
      return p
    }
    const tD0 = performance.now()
    // dormant dinos only check for waking every 8th frame (staggered): 1500
    // distance tests a frame were a millisecond of nothing happening
    for (const d of dinos) {
      if (d.dormant && ((frameCount + d.index) & 7) !== 0) continue
      d.update(dt, pFeet, hurtPlayer)
    }
    perfSec.dinos = perfSec.dinos * 0.95 + (performance.now() - tD0) * 0.05
    frameSec.dinos = performance.now() - tD0
    // the AWAKE set once per frame — the pair loops below are n² and 1500²
    // with a `continue` per dormant dino was still a million iterations
    awake.length = 0
    for (const d of dinos) if (!d.dormant && d.object.visible) awake.push(d)
    // pack aggro: a wild raptor entering aggro pulls packmates in range
    for (const d of awake) {
      if (d.state !== 'aggro') continue
      for (const o of awake) {
        if (o === d || o.state === 'tamed' || o.state === 'ko') continue
        if (o.species.id === d.species.id && o.object.position.distanceTo(d.object.position) < d.species.packRange) {
          o.joinPack()
        }
      }
    }
    // dino-dino separation + player-dino body push (soft, gameplay-level)
    for (let i = 0; i < awake.length; i++) {
      const a = awake[i]
      for (let j = i + 1; j < awake.length; j++) {
        const b = awake[j]
        const dx = b.object.position.x - a.object.position.x
        const dz = b.object.position.z - a.object.position.z
        const d2 = Math.hypot(dx, dz)
        const min = (a.species.height + b.species.height) * 0.55
        if (d2 > 0.01 && d2 < min) {
          // the ridden mount is kinematic — its whole push goes to the other dino
          const push = ((min - d2) / d2) * 0.5
          const aRidden = a === riding
          const bRidden = b === riding
          if (!aRidden) {
            const k = bRidden ? 2 : 1
            a.object.position.x -= dx * push * k
            a.object.position.z -= dz * push * k
          }
          if (!bRidden) {
            const k = aRidden ? 2 : 1
            b.object.position.x += dx * push * k
            b.object.position.z += dz * push * k
          }
        }
      }
      if (!riding && a.state !== 'ko') {
        const dx = player.mover.position.x - a.object.position.x
        const dz = player.mover.position.z - a.object.position.z
        const d2 = Math.hypot(dx, dz)
        const min = a.species.height * 0.6 + 0.45
        if (d2 > 0.01 && d2 < min) {
          const px = player.mover.position
          player.mover.teleport(a.object.position.x + (dx / d2) * min, px.y, a.object.position.z + (dz / d2) * min)
        }
      }
    }
    let tS = performance.now()
    scatter.ensureCollidersAround(focus.x, focus.z, physics)
    // LOD bands and cover culling re-evaluate when the viewer has moved 3 m
    // (12K prop groups a frame was 2 ms of the same answer)
    {
      const vx = freeCam ? freeCam.x : focus.x, vz = freeCam ? freeCam.z : focus.z
      if (Math.hypot(vx - lastVisX, vz - lastVisZ) > 3) {
        lastVisX = vx; lastVisZ = vz
        scatter.updateVisibility(vx, vz)
      }
    }
    perfSec.scatter = perfSec.scatter * 0.95 + (performance.now() - tS) * 0.05
    frameSec.scatter = performance.now() - tS
    tS = performance.now()
    grass.update(freeCam ? freeCam.x : focus.x, freeCam ? freeCam.z : focus.z)
    perfSec.grass = perfSec.grass * 0.95 + (performance.now() - tS) * 0.05
    frameSec.grass = performance.now() - tS
    water.update(dt)
    daynight.camera = cam.camera
    daynight.setFocus(focus.x, focus.z)
    daynight.advance(dt)
    skyExtras.update(dt, cam.camera, daynight.keyDir, daynight.nightness, daynight.keyColor, daynight.fogFar)
    ambience.update(dt, daynight.time)
    tS = performance.now()
    terrain.update(freeCam ? freeCam.x : focus.x, freeCam ? freeCam.z : focus.z)
    perfSec.terrain = perfSec.terrain * 0.95 + (performance.now() - tS) * 0.05
    frameSec.terrain = performance.now() - tS

    // camera follows whoever is being driven (or the QA free camera)
    if (freeCam) {
      cam.camera.position.set(freeCam.x, freeCam.y, freeCam.z)
      const cp = Math.cos(freeCam.pitch)
      cam.camera.lookAt(
        freeCam.x - Math.sin(freeCam.yaw) * cp,
        freeCam.y + Math.sin(freeCam.pitch),
        freeCam.z - Math.cos(freeCam.yaw) * cp,
      )
    } else {
      const camTargetFeet = renderFeet()
      cam.update(input, camTargetFeet, dt)
      cam.camera.position.y += camKick
      if (riding) cam.camera.position.addScaledVector(cam.camera.getWorldDirection(new THREE.Vector3()), -2.2)
    }

    // ghost preview when holding a placeable
    const held = inventory.held
    building.updateGhost(held && ITEMS[held].placeable ? (held as PieceKind) : null, held && ITEMS[held].placeable ? updateAim() : null)

    keystones.update(dt)
    beacon.update(dt, cam.camera.position)
    if (doorAnim > 0) {
      doorAnim -= dt
      doorMesh.position.y = Math.max(doorGroundY - 8.5, doorMesh.position.y - dt * 4)
    }
    // context prompt
    const fk = feetPos()
    const nearKey = keystones.sites.find((k) => !k.collected && Math.hypot(k.x - fk.x, k.z - fk.z) < 5)
    const nearGate = !doorOpen && Math.hypot(fk.x - gateSite.x, fk.z - gateSite.z) < 8
    const nearBeacon = !beaconLit && Math.hypot(fk.x - beaconSite.x, fk.z - beaconSite.z) < 11
    if (riding) hud.prompt('E — dismount')
    else if (nearBeacon) hud.prompt(keystones.collectedCount >= keystones.total ? 'E — light the beacon' : 'the brazier is cold')
    else if (nearGate) hud.prompt(keystones.collectedCount >= keystones.total ? 'E — set the keystones' : `sealed — ${keystones.total - keystones.collectedCount} keystones missing`)
    else if (nearKey) hud.prompt('E — take the keystone')
    else {
      const ko = nearestDino(INTERACT_RANGE, (d) => d.state === 'ko')
      const tame = nearestDino(INTERACT_RANGE, (d) => d.state === 'tamed')
      if (ko) hud.prompt(`E — feed ${ITEMS[ko.species.tameFood].icon} (${Math.min(100, Math.round(ko.tameProgress))}%)`)
      else if (tame && !tame.saddled) hud.prompt(inventory.count('saddle') > 0 ? 'E — saddle' : 'tamed — craft a saddle to ride')
      else if (tame) hud.prompt('E — ride')
      else {
        const wild = nearestDino(14, (d) => d.state !== 'tamed' && d.state !== 'ko')
        if (wild) hud.prompt(`${wild.species.name} · ♥${Math.max(0, Math.ceil(wild.hp))} · 😴${Math.round(wild.torpor)}/${wild.species.torporMax}`)
        else hud.prompt(null)
      }
    }

    hud.tick(dt, focus.x, focus.y, focus.z, daynight.time, playerHp, (-cam.yaw * 180) / Math.PI)
    frameCount++
    // shadows EVERY frame: the every-third-frame update was the jitter — a
    // frame with the shadow pass was ~5 ms heavier than its neighbours, so at
    // the vsync edge every third frame missed and motion strobed 16/16/33.
    // The cost is made steady instead (smaller map, casters only near).
    if (frameCount % shadowEvery === 0) renderer.shadowMap.needsUpdate = true
    const t1 = performance.now()
    const progsBefore = renderer.info.programs?.length ?? 0
    const texBefore = renderer.info.memory.textures
    renderer.render(scene, cam.camera)
    const t2 = performance.now()
    frameSec.newProgs = (renderer.info.programs?.length ?? 0) - progsBefore
    frameSec.newTex = renderer.info.memory.textures - texBefore
    perfUpdate = perfUpdate * 0.95 + (t1 - t0) * 0.05
    perfRender = perfRender * 0.95 + (t2 - t1) * 0.05
    frameSec.update = t1 - t0
    frameSec.render = t2 - t1
    if (!worstFrame || t2 - t0 > worstFrame.ms) worstFrame = { ms: t2 - t0, sec: { ...frameSec }, z: feetPos().z }
    adaptResolution(dt * 1000)
    dbg.ready = true
  }
  requestAnimationFrame(frame)

  // ADAPTIVE RESOLUTION: the render is fill-bound on a Retina display (the
  // user's 2000×1500 CSS-px window at 1.3× is 5M pixels of cutout foliage,
  // twice) and the frame rate dropped hard whenever the view filled with
  // forest. Watch the frame time; step the pixel ratio down toward 0.7 when a
  // second of frames runs long, back up when it runs short. Rare steps (the
  // buffer reallocation is itself a hitch), hysteresis between the bands.
  const PR_CAP = Math.min(devicePixelRatio, 1.3)
  const PR_MIN = Math.min(0.7, PR_CAP)
  let pixelRatio = PR_CAP
  let prAccum = 0
  let prN = 0
  let prCooldown = 4 // seconds; the first seconds after load are noise
  let adaptive = true
  function adaptResolution(frameMs: number): void {
    if (!adaptive) return
    prAccum += frameMs
    prN++
    prCooldown -= frameMs / 1000
    if (prCooldown > 0 || prN < 45) return
    const avg = prAccum / prN
    prAccum = 0
    prN = 0
    let next = pixelRatio
    if (avg > 19.5) next = Math.max(PR_MIN, pixelRatio * 0.85)
    else if (avg < 15.5 && pixelRatio < PR_CAP) next = Math.min(PR_CAP, pixelRatio * 1.08)
    if (Math.abs(next - pixelRatio) < 0.01) { prCooldown = 1; return }
    prCooldown = next < pixelRatio ? 2 : 3.5 // climb back slowly
    pixelRatio = next
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(innerWidth, innerHeight)
  }

  // periodic node respawns
  setInterval(() => scatter.tickRespawns(physics), 1000)
}

void boot()

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
import { Dino, clipNamesByModel, type Senses } from './dinos'
import { SPECIES } from './species'
import { Scatter, setLodBands, type ScatterNode } from './scatter'
import { Building, type PieceKind } from './building'
import { Ruins } from './ruins'
import { Caves } from './caves'
import { Keystones } from './keystones'
import { Beacon } from './beacon'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { WorldBorder } from './border'
import { HitFx, type ChipKind } from './hit-fx'
import { Kit, ITEM_MODEL } from './kit'
import { loadStoneTexture } from './stone-material'
import { DinoImpostors } from './dino-impostors'
import { Survival, FOODS, type FoodId } from './survival'
import { Onboarding } from './onboarding'
import { Engrams, ENGRAMS } from './engrams'
import { Wayfinder } from './wayfinder'
import { Inventory } from './inventory'
import { Chests } from './chests'
import { ITEMS, RECIPES, type ItemId } from './items'
import { Hud } from './hud'
import { MapView } from './map'
import { HELD_SIZE } from './player'
import { saveGame, loadGame, SAVE_VERSION, type SaveFile } from './save'
import { heightAt, loadHeightmap, worldMeta, SPAWN, skyViewAt, normalAt, biomeAt, BIOME, forestKindAt, forestMaskAt, FOREST_KIND } from './heightmap'
import { loadNavmesh, findPath, beginNavFrame, navStats, setNavBudget } from './navmesh'
import { gridBytes } from './heightmap'
import { terrainEvicted, setTerrainCacheTtl } from './terrain'
import { groundColorProbe } from './terrain-paint'
import { nearestObstacle } from './obstacles'
import { advanceWind, windTime, windScale } from './wind'
import { WaterSystem } from './water'
import { Waterfalls } from './waterfall'
import { wildPopulation } from './population'
import { GrassField } from './grass'
import { SkyExtras } from './sky-extras'
import { Ambience } from './ambience'
import { GpuTimer } from './gpu-timer'
import { Sfx } from './sfx'
import { SettingsPanel } from './settings'
import { Post } from './post'
import { groundKindAt, groundHexAt } from './terrain-paint'
import { warmRoots } from './uploads'
import { LightRig } from './lights'

/** kinds that throw wood chips rather than leaves */
const WOODY = new Set(['tree', 'elder', 'redwood', 'pine', 'deadtree', 'palm', 'willow', 'log', 'sticks'])

const SWING_COOLDOWN = 0.45
const REACH = 3.2
const INTERACT_RANGE = 3.8

async function boot(): Promise<void> {
  // The boot card (index.html #boot). Every first-sight cost — shader
  // compiles, texture uploads, the eleven rigs — is paid behind it, so the
  // first frame the player sees is a warm one (M33).
  const bootEl = document.getElementById('boot')
  const bootLine = document.getElementById('boot-line')
  const bootBar = bootEl?.querySelector('#boot-bar i') as HTMLElement | null
  const bootStage = (text: string, pct: number): void => {
    if (bootLine) bootLine.textContent = text
    if (bootBar) bootBar.style.width = `${pct}%`
  }
  bootStage('reading the island…', 6)
  await loadHeightmap() // everything below samples heightAt
  await loadNavmesh()
  bootStage('finding the paths…', 14)
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
  // With a composer in the way, renderer.info resets at every PASS — so a read
  // after the frame reported one draw call (the last full-screen quad) and the
  // F3 panel and the settings gate both believed it (M42). Reset once a frame
  // instead, and the counters cover the scene plus its post passes.
  renderer.info.autoReset = false

  // F3: real GPU milliseconds (the JS render timer measures submit, not draw)
  const gpuTimer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext)
  let perfHud = false
  /** the world is up and the boot card is gone — see the keydown handler */
  let bootDone = false
  let speciesWarmed = 0
  let gpuProbe = false
  let paused = false
  let frozen = false
  const extraLights: THREE.PointLight[] = []

  const scene = new THREE.Scene()
  // THE FILL BUDGET: three point lights for the whole island, following the
  // three nearest fires/halo/beacon. Added before anything else compiles —
  // the shader light count must be settled before the warm-up (M31).
  const lights = new LightRig()
  scene.add(lights.group)
  const daynight = new DayNight(renderer, scene)
  const terrain = new Terrain()
  scene.add(terrain.group)
  terrain.group.name = 'terrain'

  const water = new WaterSystem()
  water.build()
  scene.add(water.group)
  water.group.name = 'water'

  const waterfalls = new Waterfalls()
  waterfalls.build(worldMeta?.falls ?? [])
  scene.add(waterfalls.group)
  waterfalls.group.name = 'waterfalls'

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
  const survival = new Survival()
  survival.restore(save?.survival)
  // THE RUINS ARE THE TECH TREE (M68): the homestead tier is found, not
  // levelled into. A save written before tablets existed keeps everything it
  // could already make — see Engrams.restore.
  // THE WAYFINDER (M71): on the WET SAND, not in the meadow you wake in.
  // Dropped a few steps from spawn it was invisible in knee-high grass at 17 m
  // — a relic nobody can see is not a relic. The tideline (M65's shellbed
  // band, z >= 1620 here) is bare pale sand, and it is where a player goes
  // first anyway, because they are thirsty. You wake, you walk to the water,
  // and the thing that washed up with you is lying there.
  const wayfinder = new Wayfinder(SPAWN.x + 9, SPAWN.z + 72, lights)
  const engrams = new Engrams()
  engrams.restore(save?.engrams as string[] | undefined, !!save && save.engrams === undefined)
  engrams.onLearn = (e) => {
    hud.toast(`🗿 ${e.line}  —  you can make a ${ITEMS[e.recipe].name.toLowerCase()} now.`, 7)
    sfx.play('ui-confirm', { volume: 0.7 })
    hud.hint('TAB to open the pack — the new recipe is in it.')
  }
  const onboarding = new Onboarding()
  onboarding.restore(save?.hints)

  const scatter = new Scatter()
  bootStage('growing the forest…', 26)
  await scatter.load(renderer)
  const grass = new GrassField()
  scene.add(grass.group)
  grass.group.name = 'grass'
  const skyExtras = new SkyExtras()
  scene.add(skyExtras.group)
  skyExtras.group.name = 'skyExtras'
  const ambience = new Ambience()
  // audio needs a gesture: the first click / key starts the soundscape
  const sfx = new Sfx()
  // WHAT THE ANIMALS SOUND LIKE. dinos.ts says what happened ('call', 'roar',
  // 'hurt', 'die', 'eat'); the sample and the pitch are chosen here, from the
  // species — a rex speaks a fifth below a raptor, and carries twice as far.
  // a body hitting the ground: a heavy thud pitched to its size, and dust
  let thudCount = 0
  Dino.onThud = (d) => {
    thudCount++
    const p = d.object.position
    const big = d.species.height
    sfx.play('hit-flesh', { at: { x: p.x, y: p.y, z: p.z }, range: 90 + big * 20, volume: 0.9, rate: Math.max(0.45, 1.2 - big * 0.11) })
    sfx.play('step-dirt', { at: { x: p.x, y: p.y, z: p.z }, range: 70, volume: 0.7, rate: Math.max(0.4, 0.9 - big * 0.06) })
    hitFx.burst(p.x, p.y + 0.25, p.z, big > 3)
    // the ground shakes when something big lands on it, if you are close
    const dp = feetPos().distanceTo(p)
    if (dp < 40) shakeCamera(Math.min(0.3, (big / 6) * (1 - dp / 40) ** 2 * 0.5), 0, 1)
  }
  Dino.onVoice = (voice, d) => {
    const p = d.object.position
    const big = d.species.height
    const rate = THREE.MathUtils.clamp(1.55 - big * 0.16, 0.55, 1.45)
    const range = 60 + big * 22
    const carnivore = d.species.diet === 'carnivore'
    const at = { x: p.x, y: p.y + big * 0.6, z: p.z }
    switch (voice) {
      case 'call':
        sfx.play(carnivore ? 'dino-call' : 'dino-grunt', { at, range: range * 0.8, rate, volume: 0.5, cooldown: 1.2 })
        break
      case 'roar':
        sfx.play(d.species.alpha ? 'alpha-roar' : carnivore ? 'dino-roar' : 'dino-call', { at, range, rate, volume: 0.85, cooldown: 0.8 })
        break
      case 'hurt':
        sfx.play('dino-hurt', { at, range: range * 0.7, rate, volume: 0.7, cooldown: 0.25 })
        break
      case 'die':
        sfx.play('dino-die', { at, range, rate: rate * 0.9, volume: 0.9 })
        break
      case 'eat':
        sfx.play('eat', { at, range: 30, rate, volume: 0.4, cooldown: 1 })
        break
    }
  }
  const startAudio = () => { ambience.start(); if (ambience.context && ambience.bus) sfx.start(ambience.context, ambience.bus); window.removeEventListener('pointerdown', startAudio); window.removeEventListener('keydown', startAudio) }
  window.addEventListener('pointerdown', startAudio)
  window.addEventListener('keydown', startAudio)
  scene.add(scatter.group)
  scatter.group.name = 'scatter'
  if (save) scatter.restore(save.deadNodes as { id: number; respawnAt: number }[])

  // the stone texture first: every stone material (ruins, the beacon, the
  // door) samples it, and a sampler bound null at first compile stays black
  await loadStoneTexture()
  const ruins = new Ruins()
  bootStage('raising the ruins…', 44)
  await ruins.build(physics)
  scene.add(ruins.group)
  ruins.group.name = 'ruins'

  const keystones = new Keystones(lights)
  keystones.build()
  scene.add(keystones.group)
  wayfinder.build()
  wayfinder.group.name = 'wayfinder'
  scene.add(wayfinder.group)
  if (save?.wayfinderTaken) wayfinder.take()
  keystones.group.name = 'keystones'
  if (save?.keystones) keystones.restore(save.keystones as string[])
  keystones.onCollect = () => {
    ambience.chime(keystones.collectedCount, keystones.needed)
    sfx.play('ui-confirm', { volume: 0.5 })
    hud.glow()
  }

  // the caldera door: a stone slab sealing the gate arch until all five
  // keystones are set (the arc's lock)
  const gateSite = worldMeta!.ruinSites.find((r) => r.tag === 'caldera-gate')!
  // the slab stands IN the Ravine's mouth, 36 m north of the site, where the
  // slot's rock walls rise on both sides — sized past the 16 m slot (18 × 17)
  // so its edges sit inside the walls. (It hung in a free-standing arch 14 m
  // out on the apron before, and the slot ran on angled beside it: you just
  // walked round — user screenshot 23, M19.) Two invisible jambs bridge any
  // sliver between slab and wall.
  const doorZ = gateSite.z - 36
  const doorGroundY = heightAt(gateSite.x, doorZ)
  // the slab sits INSIDE the arch's 13 m span (11 × 13.5, a metre behind the
  // arch face) in a dark bronze-wood — the 18 m grey block that stuck out past
  // the arch read as a wall bolted onto the mountain (user screenshot 25); the
  // rock itself now meets the arch's piers (the Ravine's 6.5 m throat)
  // the slab: vertical timbers (a lighter, grained wood — the flat dark slab
  // read as a black hole inside the arch from the apron, M27) with bronze
  // studs and a centre seam on the SOUTH face, the one the player approaches
  const doorWood = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.85, metalness: 0.05 })
  const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(11, 13.5, 1.4), doorWood)
  doorMesh.position.set(gateSite.x, doorGroundY + 6.4, doorZ - 1.0)
  {
    const plank = new THREE.MeshStandardMaterial({ color: 0x8c6a45, roughness: 0.9 })
    for (let i = 0; i < 7; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.35, 13.2, 0.18), i % 2 ? plank : doorWood)
      p.position.set(-4.5 + i * 1.5, 0, 0.75)
      doorMesh.add(p)
    }
    const stud = new THREE.MeshStandardMaterial({ color: 0xa8843c, roughness: 0.4, metalness: 0.7 })
    for (const [sx, sy] of [[-3.6, 4.2], [3.6, 4.2], [-3.6, -4.0], [3.6, -4.0], [-3.6, 0.1], [3.6, 0.1]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.3), stud)
      b.position.set(sx, sy, 0.9)
      doorMesh.add(b)
    }
    for (const sy of [4.2, -4.0]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.5, 0.22), stud)
      band.position.set(0, sy, 0.9)
      doorMesh.add(band)
    }
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 12.8, 0.2), stud)
    seam.position.set(0, -0.2, 0.92)
    doorMesh.add(seam)
  }
  doorMesh.castShadow = true
  doorMesh.receiveShadow = true
  scene.add(doorMesh)
  let doorOpen = save?.doorOpen ?? false
  let doorAnim = 0
  const doorCollider = physics.world.createCollider(
    RAPIER.ColliderDesc.cuboid(5.5, 6.75, 0.7).setTranslation(gateSite.x, doorGroundY + 6.4, doorZ - 1.0),
  )
  // the arch's piers and the rock beyond them: solid from the slab's edge outward
  for (const side of [-1, 1]) {
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(3.2, 14, 1.4).setTranslation(gateSite.x + side * 8.6, doorGroundY + 10, doorZ - 1.0))
  }
  if (doorOpen) {
    doorMesh.position.y = doorGroundY - 8.2
    physics.world.removeCollider(doorCollider, false)
  }

  // THE BEACON — the arc's end, on the crater bench at the top of the Ravine
  const beaconSite = worldMeta!.ruinSites.find((r) => r.tag === 'crater-beacon')!
  const beacon = new Beacon(beaconSite.x, heightAt(beaconSite.x, beaconSite.z), beaconSite.z, lights)
  scene.add(beacon.group)
  beacon.group.name = 'beacon'
  physics.world.createCollider(RAPIER.ColliderDesc.cylinder(1.4, 7.4).setTranslation(beaconSite.x, beacon.groundY + 1.4, beaconSite.z))
  physics.world.createCollider(RAPIER.ColliderDesc.cylinder(3.5, 1.6).setTranslation(beaconSite.x, beacon.groundY + 2.7 + 3.5, beaconSite.z))
  let beaconLit = save?.beaconLit ?? false
  if (beaconLit) beacon.light(true)

  // the mid-band dino sprites (captured per species as rigs arrive)
  const dinoImpostors = new DinoImpostors()
  scene.add(dinoImpostors.group)
  dinoImpostors.group.name = 'dinoImpostors'
  Dino.impostors = dinoImpostors

  // hit feedback: blood on every landed blow
  const hitFx = new HitFx()
  scene.add(hitFx.group)
  hitFx.group.name = 'hitfx'

  // the world border: walls at 1.96 km, a hex veil over the last 120 m
  const border = new WorldBorder(physics)
  scene.add(border.group)
  border.group.name = 'border'

  // the kit: downloaded item/buildable models + the icons rendered from them
  const kit = new Kit()
  bootStage('packing the kit…', 56)
  await kit.load()
  kit.captureIcons(renderer)
  // the look, finished in post — see post.ts (and PERFORMANCE.md: this is the
  // headroom the M31-M41 rounds bought, spent deliberately)
  const post = new Post(renderer, scene, cam.camera)
  // the dark places (PLAN beat 4): the terrain is the floor, this is the roof
  let caveDark = 0
  /** seconds since the Wayfinder's HUD bearing was last recomputed (M71) */
  let wayTick = 0
  /** 0..1, how far under the water the CAMERA is (M67) */
  let submerged = 0
  let humid = 0
  const caves = new Caves()
  caves.build()
  scene.add(caves.group)
  caves.group.name = 'caves'
  const chests = new Chests()
  if (save) chests.restore(save.chests as Parameters<Chests['restore']>[0])
  const building = new Building(physics, kit, lights)
  scene.add(building.group)
  building.group.name = 'building'
  if (save) building.restore(save.pieces as ReturnType<Building['serialize']>)

  if (save) daynight.setTime(save.time)
  if (save?.days) daynight.elapsedDays = save.days as number

  // --- dinos ---
  const dinos: Dino[] = []
  /** ONE EAGER CLONE PER SPECIES, the rest on approach (M61). The load-time
   *  warm-up needs a rig of every species to compile its shaders, calibrate its
   *  scale and capture its impostor card — but only ONE. The other ~1500 ask
   *  for theirs when the player comes within 380 m, which most of them never
   *  do: 180 MB of `Bone` objects that used to be built at load. */
  const eagerSpecies = new Set<string>()
  const spawnDino = (speciesId: string, x: number, z: number): Dino => {
    const d = new Dino(SPECIES[speciesId] ?? SPECIES.raptor, x, z, dinos.length)
    dinos.push(d)
    scene.add(d.object)
    Dino.scene = scene
    if (!eagerSpecies.has(d.species.id)) {
      eagerSpecies.add(d.species.id)
      d.ensureRig()
    }
    return d
  }
  // TAMED dinos persist from the save; the WILD roster always spawns fresh —
  // otherwise old saves keep their old (smaller) populations forever and
  // roster growth never reaches returning players (user: "still no dinos")
  if (save) {
    for (const row of save.dinos as ReturnType<Dino['serialize']>[]) {
      if (!row.alive || row.state !== 'tamed') continue
      const d = spawnDino(row.species, row.x, row.z)
      d.ensureRig() // a tame is at your shoulder; it never waits for the ring
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
  // THE GATEKEEPER: the alpha rex on the causeway before the caldera door —
  // once slain it stays slain (saved)
  let alphaSlain = save?.alphaSlain ?? false
  const gateSiteForAlpha = worldMeta!.ruinSites.find((r) => r.tag === 'caldera-gate')!
  const gatekeeper: Dino | null = alphaSlain ? null : spawnDino('alpharex', gateSiteForAlpha.x + 3, gateSiteForAlpha.z + 44)

  /** Craft, checking the homestead tier: a saddle or a chest wants a workbench
   *  in reach. The panel greys those out, but the gate belongs here — the debug
   *  API and any future hotkey come through this door too (M39). */
  const craftItem = (id: ItemId): boolean => {
    const r = RECIPES.find((x) => x.output === id)
    if (!r) return false
    const f = feetPos()
    if (r.learned && !engrams.knows(id)) {
      hud.toast('You do not know how to make that yet — the ruins remember.')
      sfx.play('ui-error', { volume: 0.5 })
      return false
    }
    if (r.bench && !building.nearBench(f.x, f.z)) {
      hud.toast(`${ITEMS[id].name} needs a workbench in reach.`)
      sfx.play('ui-error', { volume: 0.4 })
      return false
    }
    if (!inventory.craftById(id)) return false
    hud.toast(`Crafted ${ITEMS[id].name}`)
    sfx.play('craft', { volume: 0.5 })
    return true
  }
  // the tool in your hand is a real object now (M48)
  player.heldFactory = (id) => {
    const file = ITEM_MODEL[id]
    const size = HELD_SIZE[id]
    if (!file || !size) return null
    try { return kit.instance(file, { height: size }) } catch { return null }
  }
  const hud = new Hud(document.getElementById('hud')!, inventory, (id) => { craftItem(id) }, kit.icons)
  // the inventory releases the mouse (the panel has buttons); Tab or Esc or a
  // click on the world closes it and re-locks the pointer (user: "inventory
  // not closeable, mouse doesn't appear")
  // --- settings (O) ---
  const settings = new SettingsPanel(document.getElementById('hud')!)
  const applySettings = (v = settings.values): void => {
    if (v.renderScale > 0) { adaptive = false; pixelRatio = v.renderScale; renderer.setPixelRatio(v.renderScale); renderer.setSize(innerWidth, innerHeight) }
    else adaptive = true
    post.setQuality(v.effects)
    post.setAo(v.ao)
    { const s2 = renderer.getDrawingBufferSize(new THREE.Vector2()); post.setSize(s2.x, s2.y) }
    daynight.setShadowSize(v.shadowSize)
    grass.setEnabled(v.grass, scene)
    setLodBands({ far: 120 * v.drawDistance, mid: 260 * v.drawDistance, cover: 90 * v.drawDistance })
    scatter.updateVisibility(cam.camera.position.x, cam.camera.position.z, true)
    ambience.setVolume(v.volume)
    sfx.setVolume(v.volume)
    cam.sensitivity = v.sensitivity
    if (cam.camera.fov !== v.fov) { cam.camera.fov = v.fov; cam.camera.updateProjectionMatrix() }
  }
  /** one door into the settings, for the key and the gear alike */
  const openSettings = (): void => {
    if (hud.panelOpen) hud.togglePanel()
    settings.toggle()
  }
  hud.onGear = openSettings
  settings.onApply = (v) => { applySettings(v); sfx.play('ui-click', { volume: 0.3 }) }
  settings.onToggle = (open) => {
    hud.root?.classList.toggle('panel-open', open || hud.panelOpen)
    if (open) { document.exitPointerLock?.(); sfx.play('ui-open', { volume: 0.45 }) }
    else { sfx.play('ui-close', { volume: 0.45 }); renderer.domElement.requestPointerLock() }
  }

  onboarding.show = (text) => hud.hint(text)
  onboarding.hint('wake')
  hud.panelContext = () => {
    const f = feetPos()
    const chest = building.chestNear(f.x, f.z)
    return {
      bench: building.nearBench(f.x, f.z),
      knows: (id: ItemId) => engrams.knows(id),
      chest: chest ? chests.contents(Chests.key(chest.gx, chest.gz)) : null,
    }
  }
  hud.onChestMove = (id, dir, all) => {
    const f = feetPos()
    const chest = building.chestNear(f.x, f.z)
    if (!chest) return
    const key = Chests.key(chest.gx, chest.gz)
    if (dir === 'in') {
      const want = all ? inventory.count(id) : 1
      const fits = chests.put(key, id, want)
      if (!fits) { hud.toast('The chest is full.'); return }
      inventory.remove(id, fits)
    } else {
      const want = all ? Infinity : 1
      const got = chests.take(key, id, want === Infinity ? 9999 : want)
      if (got) inventory.add(id, got)
    }
    hud.refreshPanel()
  }
  const mapView = new MapView(document.getElementById('hud')!, building, scatter)
  hud.onUi = (what) => sfx.play(what === 'open' ? 'ui-open' : what === 'close' ? 'ui-close' : 'ui-click', { volume: what === 'click' ? 0.3 : 0.45 })
  hud.onPanelToggle = (open) => {
    if (open) document.exitPointerLock()
    else renderer.domElement.requestPointerLock()
  }
  addEventListener('keydown', (e) => { if (e.code === 'Escape' && hud.panelOpen) hud.togglePanel() })
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || !mapView.open) return
    mapView.toggle()
    renderer.domElement.requestPointerLock()
  })
  /** the mouse is captured: there is no cursor on screen, so nothing is clickable */
  const syncLockClass = (): void => {
    document.body.classList.toggle('locked', !!document.pointerLockElement)
  }
  document.addEventListener('pointerlockchange', () => {
    // Esc in pointer lock exits the lock: show the cursor, and close the panel if it was open
    if (!document.pointerLockElement && hud.panelOpen) { /* keep it open — the user pressed Tab */ }
    // the gear only offers itself when there is a pointer to click it with
    syncLockClass()
  })
  syncLockClass()
  const vignette = document.createElement('div')
  vignette.id = 'hud-vignette'
  document.body.appendChild(vignette)
  const status = document.getElementById('status')!
  status.textContent = `core loop · three r${THREE.REVISION}`

  // --- interaction state ---
  let riding: Dino | null = null
  let swingT = 0
  // CAMERA SHAKE. `camKick` was a 5 cm vertical nudge and it was the entire
  // impact feedback in the game. A shake is a decaying tremor with a direction
  // — a chop kicks back along the swing, a bite kicks from where it came, a
  // felled tree thumps the whole frame — and it must be FRAME-RATE INDEPENDENT
  // (a per-frame random offset reads as noise at 60 fps and as a stutter at
  // 30), so it is sampled from smooth noise on a clock (M49).
  let camKick = 0
  const shake = { amp: 0, t: 0, dirX: 0, dirY: 0 }
  /** @param amp metres of tremor at its peak · dir where the blow came FROM */
  const shakeCamera = (amp: number, dirX = 0, dirY = 1): void => {
    // a bigger shake overrides a smaller one instead of stacking into nausea
    if (amp <= shake.amp * 0.8) return
    shake.amp = Math.min(0.42, amp)
    shake.t = 0
    const len = Math.hypot(dirX, dirY) || 1
    shake.dirX = dirX / len
    shake.dirY = dirY / len
  }
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

  /** water you can reach from here: a surface within 1.6 m of the feet, at the feet or a step ahead */
  const nearWaterFor = (feet: THREE.Vector3): boolean => {
    const fwdX = -Math.sin(cam.yaw), fwdZ = -Math.cos(cam.yaw)
    for (const r of [0, 1.5, 3, 4.5]) {
      const wl = water.waterLevelAt(feet.x + fwdX * r, feet.z + fwdZ * r)
      if (wl !== null && wl > feet.y - 2.2 && wl < feet.y + 1.2) return true
    }
    return false
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

  let god = false // QA: the taming gate punches a raptor that punches back
  /** Every tame within earshot goes for whatever just went for you (M36). */
  const rallyTames = (foe: Dino | null | undefined): void => {
    if (!foe) return
    const f = feetPos()
    for (const d of dinos) {
      if (d.state !== 'tamed' || d.ridden || d === foe) continue
      if (d.object.position.distanceTo(f) > 45) continue
      d.guard(foe)
    }
  }

  const hurtPlayer = (damage: number, from?: Dino): void => {
    rallyTames(from)
    if (creative || god) return
    if (damage > 0) {
      sfx.play('player-hurt', { volume: 0.7, cooldown: 0.5 })
      const f2 = feetPos()
      const fx = from ? f2.x - from.object.position.x : 0
      shakeCamera(Math.min(0.34, 0.1 + damage * 0.012), fx, 0.7)
    }
    playerHp -= damage
    vignette.classList.add('hurt')
    setTimeout(() => vignette.classList.remove('hurt'), 220)
    if (playerHp <= 0) {
      // WHERE YOU WAKE UP (PLAN decision 11): the last bedroll you laid down,
      // or the beach you washed up on. Death costs the walk back and a day's
      // meals — not your pack; a corpse bag to recover comes later.
      if (riding) dismount()
      const bed = building.lastBedroll()
      const wx = bed ? bed.x : SPAWN.x
      const wz = bed ? bed.z + 1.4 : SPAWN.z
      player.mover.teleport(wx, heightAt(wx, wz) + 1.2, wz)
      playerHp = 60
      survival.food = Math.min(survival.food, 40)
      survival.water = Math.min(survival.water, 40)
      hud.toast(bed ? 'You wake on your bedroll, cold and hungry.' : 'You died. Washed back ashore.')
      sfx.play('ui-error', { volume: 0.4 })
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
        hud.toast(placed === 'bedroll' ? 'A bed of straw and hide — you will wake here.' : `Placed ${ITEMS[placed].name}`)
        sfx.play('place', { volume: 0.7 })
        return true
      }
      sfx.play('ui-error', { volume: 0.35 })
      return false
    }

    player.playSwing(held)
    sfx.play(held === 'spear' || held === 'hatchet' ? 'blade' : 'hit-punch', { volume: held ? 0.5 : 0.35, rate: held ? 1 : 1.25 })
    if (!held) onboarding.hint('punch')
    // a carcass in reach: a blade harvests it (meat, hide)
    if (held === 'hatchet' || held === 'spear') {
      const carcass = nearestDino(REACH + 1.5, (d) => d.state === 'dead' && d.harvestLeft > 0)
      if (carcass) {
        const got = carcass.harvest()
        if (got) {
          inventory.add('rawmeat', got.rawmeat)
          if (got.hide) inventory.add('hide', got.hide)
          if (got.fur) inventory.add('fur', got.fur)
          const cp = carcass.object.position
          hitFx.burst(cp.x, cp.y + carcass.species.height * 0.3, cp.z, false)
          sfx.play('hit-flesh', { volume: 0.55, at: { x: cp.x, y: cp.y, z: cp.z } })
          hud.toast(`${ITEMS.rawmeat.icon} +${got.rawmeat} raw meat${got.hide ? ` · ${ITEMS.hide.icon} +1 hide` : ''}${got.fur ? ` · ${ITEMS.fur.icon} +${got.fur} fur` : ''}${carcass.harvestLeft ? '' : ' — the carcass is spent'}`)
          return true
        }
      }
    }
    // dino in reach and roughly ahead? spear damages, fists build torpor
    const target = nearestDino(REACH, (d) => d.state !== 'ko' && d.state !== 'tamed' && d.state !== 'dead')
    if (target) {
      const from = feetPos()
      if (creative) target.takeHit(0, 999, from.x, from.z) // creative: instant KO
      else if (held === 'spear') target.takeHit(12, 5, from.x, from.z)
      else if (held === 'hatchet') target.takeHit(7, 4, from.x, from.z)
      else target.takeHit(2, 8, from.x, from.z) // fists: ~20 punches to KO
      const tp = target.object.position
      hitFx.burst(tp.x, tp.y + target.species.height * 0.5, tp.z, held === 'spear')
      sfx.play('hit-flesh', { volume: 0.8, at: { x: tp.x, y: tp.y + 1, z: tp.z } })
      shakeCamera(held === 'spear' ? 0.1 : 0.07, 0, 0.8)
      rallyTames(target) // your animals join in
      hud.toast(target.state === 'ko' ? `${target.species.name} knocked out!` : target.state === 'dead' ? `${target.species.name} killed` : `Hit ${target.species.name} (torpor ${Math.round(target.torpor)}/${target.species.torporMax})`)
      return true
    }

    // resource node under the crosshair (reach measured from the player)
    raycaster.setFromCamera(new THREE.Vector2(0, 0), cam.camera)
    const node = scatter.raycast(raycaster, feetPos(), REACH + 1.2)
    if (node) {
      const isWood = node.kind === 'tree' || node.kind === 'pine'
      const stone = node.kind === 'rock' || node.kind === 'boulder' || node.kind === 'outcrop'
      sfx.play(isWood ? (held === 'hatchet' ? 'chop' : 'hit-wood') : stone ? 'hit-stone' : 'pick', {
        volume: 0.7, at: { x: node.x, y: node.y + 1, z: node.z },
      })
      // CHIPS off the thing you hit, thrown back toward you (M48b)
      {
        const f = feetPos()
        const chipKind: ChipKind = stone ? 'stone' : WOODY.has(node.kind) ? 'wood' : 'leaf'
        // strike height: a trunk is hit at chest height, cover at the ground
        const hy = node.y + (WOODY.has(node.kind) || stone ? Math.min(1.6, node.scale * 0.12) : 0.3)
        hitFx.chip(chipKind, node.x, hy, node.z, f.x - node.x, f.z - node.z, node.hp <= 1)
        const back = new THREE.Vector3(f.x - node.x, 0, f.z - node.z).normalize()
        shakeCamera(stone ? 0.07 : WOODY.has(node.kind) ? 0.06 : 0.025, -back.x, 0.6)
      }
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

  /** Sleep the night off at a bedroll. Costs the hours it skips — the drains
   *  run for the whole night, so you wake rested and hungry (M37). */
  const restAtBed = (): boolean => {
    const f = feetPos()
    const bed = building.bedrollNear(f.x, f.z)
    if (!bed) return false
    // BY DAY THIS VERB DOES NOT EXIST. Returning true here swallowed the E
    // press, so a bedroll laid beside a campfire meant you could not cook,
    // drink, take a keystone or mount while standing on it (M38 review).
    if (daynight.nightness < 0.3) return false
    const hostile = nearestDino(45, (d) => d.state === 'aggro' || d.state === 'hunt')
    if (hostile) { hud.toast(`You cannot sleep — a ${hostile.species.name} is close.`); return true }
    const DAWN = 0.27
    const frac = ((DAWN - daynight.time) % 1 + 1) % 1
    daynight.setTime(DAWN)
    daynight.elapsedDays += frac
    survival.sprinting = false
    survival.moving = false
    const hp = survival.update(frac * DAY_LENGTH_S, creative) // the night's meals, taken
    playerHp = Math.max(1, Math.min(100, playerHp + 45 + hp))
    hud.toast(`You sleep until dawn. ♥ ${Math.ceil(playerHp)} · food ${Math.round(survival.food)} · water ${Math.round(survival.water)}`)
    sfx.play('ui-confirm', { volume: 0.4 })
    ambience.swell()
    return true
  }

  const interact = (): boolean => {
    if (riding) {
      dismount()
      return true
    }
    if (restAtBed()) return true
    // the caldera door
    const f0 = feetPos()
    if (!doorOpen && Math.hypot(f0.x - gateSite.x, f0.z - doorZ) < 11) {
      if (keystones.enough) {
        doorOpen = true
        doorAnim = 4
        sfx.play('door-open', { volume: 0.9 })
        sfx.play('creak', { volume: 0.8, rate: 0.6 })
        physics.world.removeCollider(doorCollider, false)
        hud.toast('The keystones flare — the caldera gate grinds open.')
        return true
      }
      hud.toast(`The gate is sealed. ${keystones.needed - keystones.collectedCount} more keystones (${keystones.collectedCount}/${keystones.needed}) — N to seek.`)
      return true
    }
    // the beacon
    if (!beaconLit && Math.hypot(f0.x - beaconSite.x, f0.z - beaconSite.z) < 11) {
      if (keystones.enough) {
        beaconLit = true
        beacon.light()
        ambience.swell()
        hud.toast('The keystones burn — the beacon takes.')
        const tamed = dinos.filter((d) => d.state === 'tamed').length
        setTimeout(() => hud.credits([
          `${keystones.collectedCount} of ${keystones.total} keystones found · ${keystones.needed} opened the caldera door`,
          alphaSlain ? 'the Gatekeeper slain on its causeway' : 'the Gatekeeper still walks its causeway',
          `${tamed} dino${tamed === 1 ? '' : 's'} tamed · ${building.count()} pieces built`,
          `${Math.round(daynight.elapsedDays * 10) / 10} island days lived (one is ${Math.round(DAY_LENGTH_S / 60)} real minutes)`,
          // CC-BY asks for attribution where the work is used, and the repo's
          // ASSETS.md is not where a player is (M38 review). The CC0 packs are
          // named too, because they earned it.
          'models Kenney · Quaternius · KayKit · Poly by Google · Zsky · J-Toastie — sound Kenney · opengameart CC0 creature SFX',
        ]), 2800)
        return true
      }
      hud.toast(`The brazier is cold — it wants the fire of ${keystones.needed} keystones.`)
      return true
    }
    // keystones (the arc's thread)
    // the Wayfinder, lying in the sand
    if (wayfinder.takeNear(f0.x, f0.z)) {
      inventory.add('wayfinder', 1)
      sfx.play('ui-confirm', { volume: 0.8 })
      hud.toast('🧭 A bronze rose, half-buried. It turns toward something inland.', 6)
      hud.hint('N asks the Wayfinder where to go. Leave it in a chest to go your own way.')
      return true
    }
    const got = keystones.collectNear(f0.x, f0.z, 4, f0.y + 1.3)
    if (got) {
      const n = keystones.collectedCount
      hud.toast(n >= keystones.needed
        ? `Keystone ${n}/${keystones.total} — enough for the caldera gate (N to point the way)`
        : `Keystone ${n}/${keystones.total} · ${keystones.needed - n} more open the gate (${got.tag})`)
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
    // a tame in reach comes first (saddle / mount) — a campfire beside it
    // would otherwise catch the E as "cook"
    const tameFirst = nearestDino(INTERACT_RANGE, (d) => d.state === 'tamed')
    // cook: raw meat at a campfire
    if (!tameFirst && inventory.count('rawmeat') > 0 && building.nearFire(f0.x, f0.z)) {
      const n = Math.min(5, inventory.count('rawmeat'))
      inventory.remove('rawmeat', n)
      inventory.add('cookedmeat', n)
      hud.toast(`Cooked ${n} meat ${ITEMS.cookedmeat.icon}`)
      return true
    }
    // drink: any water within reach of the feet
    if (!tameFirst && nearWaterFor(f0)) {
      sfx.play('drink', { volume: 0.7 })
      const got = survival.drink()
      hud.toast(got > 0.5 ? `Drank · water ${Math.round(survival.water)}` : 'Not thirsty')
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
  /**
   * A COMPASS POINT FROM (fx,fz) TO (tx,tz).
   *
   * This used to be inline in the Wayfinder as `atan2(-dx, -dz)`, which
   * measures the bearing ANTICLOCKWISE from north: east and west came out
   * swapped and it had been sending players the wrong way since it was
   * written (M68). North is -z and east is +x, so the clockwise bearing is
   * atan2(+dx, -dz). It lives here as one function so the gate can check the
   * maths that the game actually uses rather than a copy of it.
   */
  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const compass = (fx: number, fz: number, tx: number, tz: number): string => {
    const ang = ((Math.atan2(tx - fx, -(tz - fz)) * 180) / Math.PI + 360) % 360
    return COMPASS[Math.round(ang / 45) % 8]
  }

  /**
   * WHAT THE WAYFINDER IS POINTING AT, or null when there is nothing left to
   * seek. Extracted from the N key in M71 so the live HUD bearing and the
   * key's toast cannot drift apart — the same class of bug as the compass
   * itself, which pointed east for west for months because the maths had no
   * second reader.
   */
  const wayfinderTarget = (): { x: number; z: number; label: string } | null => {
    const f = feetPos()
    const gate = worldMeta?.ruinSites.find((r) => r.tag === 'caldera-gate')
    // A TABLET YOU HAVE NOT READ OUTRANKS A KEYSTONE (M68) — but only while it
    // is genuinely nearer. The tablets are what open the game up (a bed, a
    // bench, a saddle); the keystones are the arc's thread, and someone
    // hunting stones should not be sent 2 km sideways for a recipe.
    const tablet = engrams.nearestUnread(f.x, f.z, (tag) => {
      const r = worldMeta!.ruinSites.find((q) => q.tag === tag)
      return r ? { x: r.x, z: r.z + 3.5 } : null
    })
    const stone = !keystones.enough ? keystones.nearestMissing(f.x, f.z) : null
    const stoneD = stone ? Math.hypot(stone.x - f.x, stone.z - f.z) : Infinity
    // OPENING vs ARC. Twelve keystones against seven tablets means a keystone
    // almost always wins on distance and the tablets would never be pointed at
    // — which defeats them, because a player who does not know they exist will
    // not go looking. While you are still in the opening (under three read) it
    // answers the question you actually have: a bed, a bench, a saddle. After
    // that it hands back to the arc and picks whichever is nearer.
    const useTablet = tablet !== null && (engrams.count < 3 || tablet.d < stoneD)
    if (useTablet) return { x: tablet!.x, z: tablet!.z, label: `a tablet (${ITEMS[tablet!.e.recipe].name.toLowerCase()})` }
    if (stone) return { x: stone.x, z: stone.z, label: 'keystone' }
    if (doorOpen && !beaconLit) return { x: beaconSite.x, z: beaconSite.z, label: 'the beacon' }
    if (gate) return { x: gate.x, z: gate.z, label: 'the caldera gate' }
    return null
  }

  let lastSpaceAt = 0
  addEventListener('keydown', (e) => {
    // NOTHING RESPONDS UNTIL THE WORLD IS UP. The boot card sits at z-index 20
    // and the settings panel at 12, so a curious player who pressed O while
    // "waking the animals…" was still on screen opened the panel BEHIND the
    // card, saw nothing happen, pressed O again to close it, and concluded
    // settings was broken (user-reported, reproduced M53). Swallowing input
    // during load is also just correct: a key press at a loading screen should
    // never quietly change state you cannot see.
    if (!bootDone) return
    if (e.code === 'F3') {
      e.preventDefault()
      perfHud = !perfHud
      if (!perfHud) hud.setPerf(null)
      return
    }
    // `code` is the physical key, so this also works on AZERTY; `key` covers
    // layouts where the O-labelled key sits elsewhere (Dvorak)
    if (e.code === 'KeyO' || e.key === 'o' || e.key === 'O') {
      // one sheet of paper at a time: the pack and the settings both used to
      // open ON TOP of the map, leaving two panels stacked over a dimmed
      // world with no way to tell which had the keyboard
      if (mapView.open) mapView.toggle()
      openSettings()
      return
    }
    if (settings.open) { if (e.code === 'Escape') settings.close(); return }
    if (e.code === 'Tab') {
      e.preventDefault()
      if (mapView.open) mapView.toggle()
      hud.togglePanel()
      if (hud.panelOpen) onboarding.hint('craft')
      return
    }
    // the panel is open: no gameplay keys (Esc closes it, above)
    if (hud.panelOpen) return
    if (e.code === 'KeyM') {
      // the sheet takes the pointer, the same way the pack does
      const open = mapView.toggle()
      sfx.play(open ? 'ui-open' : 'ui-close', { volume: 0.45 })
      if (open) document.exitPointerLock()
      else renderer.domElement.requestPointerLock()
      return
    }
    if (mapView.open) return // the map is up: no gameplay keys behind it
    if (e.code === 'KeyT') daynight.setTime(daynight.time + 1 / 24)
    if (e.code === 'KeyC') setCreative(!creative)
    if (e.code === 'KeyF' && !riding) {
      // eat the held food if it is one, else the best in the pack (cooked > berry > raw)
      const heldFood = inventory.held && inventory.held in FOODS ? (inventory.held as FoodId) : null
      const pick = heldFood ?? (['cookedmeat', 'berry', 'rawmeat'] as FoodId[]).find((f) => inventory.count(f) > 0) ?? null
      if (pick && inventory.remove(pick, 1)) {
        sfx.play('eat', { volume: 0.65 })
        const f = survival.eat(pick)
        playerHp = Math.max(1, Math.min(100, playerHp + f.hp))
        hud.toast(`Ate ${ITEMS[pick].name.toLowerCase()} ${ITEMS[pick].icon} · food ${Math.round(survival.food)} · ♥ ${Math.ceil(playerHp)}${pick === 'rawmeat' ? ' (raw — cook it at a fire)' : ''}`)
      } else {
        hud.toast('Nothing to eat — berries from bushes, meat from a carcass')
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
      // CARRYING IT IS THE WHOLE POINT (M71). Without the relic there is no
      // guidance at all — which is what makes leaving it in a chest a real
      // choice rather than a setting nobody would find.
      if (!inventory.count('wayfinder')) {
        hud.toast(wayfinder.isTaken ? 'You are not carrying the Wayfinder.' : 'You have no Wayfinder — something glints in the sand near where you woke.')
        return
      }
      const f = feetPos()
      const target = wayfinderTarget()
      if (target) {
        const d = Math.hypot(target.x - f.x, target.z - f.z)
        hud.toast(`Wayfinder: ${target.label} ${compass(f.x, f.z, target.x, target.z)} · ${Math.round(d)}m`)
      } else {
        hud.toast('The Wayfinder turns idly. There is nothing left to seek.')
      }
    }
    if (e.code === 'KeyE') interact()
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
    chests: chests.serialize(),
    dinos: dinos.map((d) => d.serialize()),
    keystones: keystones.serialize(),
    doorOpen,
    beaconLit,
    alphaSlain,
    survival: survival.serialize(),
    hints: onboarding.serialize(),
    engrams: engrams.serialize(),
    wayfinderTaken: wayfinder.isTaken,
    }
  }
  setInterval(() => void saveGame(collectSave()), 30_000)
  addEventListener('pagehide', () => void saveGame(collectSave()))

  addEventListener('resize', () => {
    cam.camera.aspect = innerWidth / innerHeight
    cam.camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
    const s2 = renderer.getDrawingBufferSize(new THREE.Vector2())
    post.setSize(s2.x, s2.y)
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
    /** QA: where the JS heap goes. Memory is a budget too, and until M57 the
     *  only number anyone had was `performance.memory` — one figure with no
     *  breakdown. Geometry is counted once per BufferGeometry, so shared
     *  geometry is not double-charged. */
    mem: () => {
      const seen = new Set<string>()
      const geoBytes = (g: THREE.BufferGeometry | undefined): number => {
        if (!g || seen.has(g.uuid)) return 0
        seen.add(g.uuid)
        let n = g.index?.array.byteLength ?? 0
        for (const a of Object.values(g.attributes)) n += (a as THREE.BufferAttribute).array?.byteLength ?? 0
        for (const list of Object.values(g.morphAttributes)) for (const a of list) n += a.array?.byteLength ?? 0
        return n
      }
      const walk = (root: THREE.Object3D): { geo: number; inst: number } => {
        let geo = 0, inst = 0
        root.traverse((o) => {
          const m = o as THREE.Mesh & { isInstancedMesh?: boolean; instanceMatrix?: THREE.BufferAttribute; instanceColor?: THREE.BufferAttribute }
          geo += geoBytes(m.geometry as THREE.BufferGeometry | undefined)
          if (m.isInstancedMesh) inst += (m.instanceMatrix?.array.byteLength ?? 0) + (m.instanceColor?.array.byteLength ?? 0)
        })
        return { geo, inst }
      }
      const inScene = walk(scene)
      let rootGeo = 0
      for (const r of warmRoots) rootGeo += walk(r).geo
      const grids = gridBytes()
      const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }
      const MB = (n: number) => +(n / 1e6).toFixed(1)
      return {
        heapMB: perf.memory ? MB(perf.memory.usedJSHeapSize) : 0,
        limitMB: perf.memory ? MB(perf.memory.jsHeapSizeLimit) : 0,
        sceneGeoMB: MB(inScene.geo),
        instanceMB: MB(inScene.inst),
        detachedRootGeoMB: MB(rootGeo),
        gridsMB: MB(Object.values(grids).reduce((a, b) => a + b, 0)),
        grids: Object.fromEntries(Object.entries(grids).map(([k, v]) => [k, MB(v)])),
        roots: warmRoots.length,
        terrainEvicted: terrainEvicted(),
      }
    },
    perf: () => ({ update: +perfUpdate.toFixed(2), render: +perfRender.toFixed(2), dinos: +perfSec.dinos.toFixed(2), scatter: +perfSec.scatter.toFixed(2), grass: +perfSec.grass.toFixed(2), terrain: +perfSec.terrain.toFixed(2), physics: +perfSec.physics.toFixed(2) }),
    terrainWorker: () => terrain.workerState(),
    /** QA: fog distance multiplier (aerials use 6) */
    setFog: (scale: number) => { daynight.fogScale = scale },
    scene,
    renderer,
    get cam() { return cam.camera },
    THREE,
    loaders: { GLTFLoader, MeshoptDecoder },
    /** QA: what's under a screen pixel (0..1 ndc coords) — object name/kind, material, distance */
    pick: (nx: number, ny: number) => {
      const rc = new THREE.Raycaster()
      rc.setFromCamera(new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)), cam.camera)
      const hits = rc.intersectObjects(scene.children, true).filter((h) => { let o: THREE.Object3D | null = h.object; while (o) { if (!o.visible) return false; o = o.parent } return (h.object as THREE.Mesh).isMesh })
      return hits.slice(0, 3).map((h) => {
        const o = h.object as THREE.Mesh
        const m = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial
        let fam: THREE.Object3D = o
        while (fam.parent && fam.parent !== scene) fam = fam.parent
        return { family: fam.name || fam.type, name: o.name, instanced: (o as THREE.InstancedMesh).isInstancedMesh ?? false, instanceId: h.instanceId, dist: +h.distance.toFixed(1), tris: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, mat: `${m.type} color=${m.color?.getHexString()} rough=${m.roughness} map=${!!m.map} vc=${!!m.vertexColors}` }
      })
    },
    setLod: (bands: { far?: number; mid?: number; cover?: number }) => { const r = setLodBands(bands); scatter.updateVisibility(cam.camera.position.x, cam.camera.position.z, true); return r },
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
    /** QA: the post stack, one layer at a time */
    post: () => post,
    /** QA: the day's baked environments and where the blend sits */
    envDebug: () => daynight.env.debug(),
    /** QA: the baked sky-view at a point (1 = open sky, 0 = a slot in a cliff) */
    skyView: (x: number, z: number) => skyViewAt(x, z),
    setPixelRatio: (r: number) => { adaptive = false; pixelRatio = r; renderer.setPixelRatio(r); renderer.setSize(innerWidth, innerHeight); const s2 = renderer.getDrawingBufferSize(new THREE.Vector2()); post.setSize(s2.x, s2.y) },
    pixelRatio: () => pixelRatio,
    setAdaptive: (on: boolean) => { adaptive = on },
    /** QA: stop the game loop so the GPU profiler owns the device */
    setPaused: (on: boolean) => { paused = on },
    /** QA: the upload warden's books — queued, uploaded, roots watched */
    uploads: () => ({ queued: uploadQueue.length, done: uploadsDone, roots: warmRoots.length }),
    /** QA: keep drawing, stop the world (dt = 0) — repeatable GPU profiles */
    setFrozen: (on: boolean) => { frozen = on },
    /** QA: time the GPU inside the real game loop (what the player actually
     *  pays — a paused profiler measures a machine with nothing else on it) */
    setGpuProbe: (on: boolean) => { gpuProbe = on },
    gpuMs: () => ({ supported: gpuTimer.supported, p10: +gpuTimer.pct(0.1).toFixed(2), median: +gpuTimer.median().toFixed(2), p95: +gpuTimer.pct(0.95).toFixed(2), max: +gpuTimer.max().toFixed(2) }),
    /** QA: park N extra point lights in the scene (intensity 0, out at sea).
     *  A point light costs every fragment whether it is lit or not, so this is
     *  the honest A/B for lever A: the same binary at 3 lights and at 10. */
    setExtraLights: (n: number) => {
      while (extraLights.length > n) { const l = extraLights.pop()!; scene.remove(l) }
      while (extraLights.length < n) {
        const l = new THREE.PointLight(0xffa25a, 0, 34, 1.6)
        l.position.set(2400, 40, 2400)
        scene.add(l)
        extraLights.push(l)
      }
      return extraLights.length
    },
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
      forests: () => worldMeta?.forests ?? [],
      normalY: (x: number, z: number) => normalAt(x, z, new THREE.Vector3()).y,
      /** QA (M69): what the CROSSHAIR is on right now — the exact raycast the
       *  swing uses, without swinging. The only way to tell "the player cannot
       *  aim at this" apart from "the swing is broken". */
      /** QA (M69): fire a ray from the camera STRAIGHT AT (x,y,z) rather than
       *  through the crosshair. If this hits and the crosshair does not, the
       *  problem is aim precision; if neither hits, the raycast is broken. */
      rayAt: (x: number, y: number, z: number) => {
        const from = cam.camera.position.clone()
        const dir = new THREE.Vector3(x, y, z).sub(from).normalize()
        const rc = new THREE.Raycaster(from, dir)
        const n = scatter.raycast(rc, feetPos(), REACH + 1.2)
        return n ? { kind: n.kind, alive: n.alive } : null
      },
      aimDebug: () => {
        raycaster.setFromCamera(new THREE.Vector2(0, 0), cam.camera)
        return scatter.raycastDebug(raycaster, feetPos(), REACH + 1.2)
      },
      aimNode: () => {
        raycaster.setFromCamera(new THREE.Vector2(0, 0), cam.camera)
        const n = scatter.raycast(raycaster, feetPos(), REACH + 1.2)
        return n ? { kind: n.kind, x: +n.x.toFixed(2), z: +n.z.toFixed(2), hp: n.hp, alive: n.alive } : null
      },
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
      /** QA: hit the nearest node of a kind N times, from anywhere (so the
       *  camera can stand back and watch a tree come down) */
      hitNode: (kind: string, times = 1, atX?: number, atZ?: number) => {
        const from = atX !== undefined && atZ !== undefined ? { x: atX, z: atZ } : feetPos()
        let best: ScatterNode | null = null
        let bd = Infinity
        for (const n of scatter.nodes) {
          if (!n.alive || n.kind !== kind) continue
          const d = Math.hypot(n.x - from.x, n.z - from.z)
          if (d < bd) { bd = d; best = n }
        }
        if (!best) return null
        // credit the yield exactly as a real swing does, or a gate checking
        // "did the chip land in the pack?" is testing the harness, not the game
        let got: Partial<Record<ItemId, number>> | null = null
        for (let i = 0; i < times && best.alive; i++) {
          const y = scatter.hit(best)
          if (y) {
            for (const [id, n] of Object.entries(y)) inventory.add(id as ItemId, n)
            got = y
          }
        }
        scatter.flushColliderDrops(physics)
        return { x: Math.round(best.x), z: Math.round(best.z), hp: best.hp, alive: best.alive, got }
      },
      hitsDebug: () => scatter.debugHits(),
      caves: () => caves.debug(),
      caveDefs: () => caves.defs.map((c) => ({ name: c.name, mouth: c.mouth, into: c.into, reach: c.reach, radius: c.radius, floorY: c.bakedFloorY })),
      inCave: () => { const f = feetPos(); return caves.inside(f.x, f.z)?.name ?? null },
      caveDark: () => +caveDark.toFixed(3),
      /** QA: a node's damage state — hp, and the tint the wound paints it */
      nodeState: (kind: string, x: number, z: number) => {
        let best = null as null | { hp: number; maxHp: number; tint: number; alive: boolean; d: number }
        for (const n of scatter.nodes) {
          if (n.kind !== kind) continue
          const d = Math.hypot(n.x - x, n.z - z)
          if (!best || d < best.d) best = { hp: n.hp, maxHp: n.maxHp, tint: +n.tint.toFixed(3), alive: n.alive, d }
        }
        if (!best) return null
        const wound = best.maxHp > 1 ? 1 - best.hp / best.maxHp : 0
        return { hp: best.hp, maxHp: best.maxHp, alive: best.alive, wound: +wound.toFixed(2), drawnTint: +(best.tint * (1 - wound * 0.3)).toFixed(3) }
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
      craft: (id: ItemId) => craftItem(id),
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
      /** QA: place a buildable at a world point (consumes the item) */
      /** QA (M66): drive the wind clock by hand, so a FROZEN world can be
       *  diffed against itself with only the wind moving */
      setWindTime: (t: number) => { windTime.value = t },
      /** QA: 0 switches the wind off with no recompile, for an honest A/B */
      setWindScale: (v: number) => { windScale.value = v },
      /** QA (M65): what the ANIMALS' obstacle hash knows is at (x,z) — the
       *  thing player structures and ruin columns never registered into */
      obstacleNear: (x: number, z: number, within = 6) => {
        const o = nearestObstacle(x, z, within)
        return o ? { x: +o.x.toFixed(1), z: +o.z.toFixed(1), d: +o.d.toFixed(2) } : null
      },
      placeAt: (id: string, x: number, z: number) => { if (!ITEMS[id as ItemId]?.placeable) return false; const ok = building.place(id as PieceKind, new THREE.Vector3(x, heightAt(x, z), z)); if (ok) inventory.remove(id as ItemId, 1); return !!ok },
      panelOpen: () => hud.panelOpen,
      iconCount: () => kit.icons.size,
      icon: (id: string) => kit.icons.get(id as ItemId) ?? null,
      dinoStates: () => dinos.map((d) => ({ state: d.state, torpor: d.torpor, saddled: d.saddled, guarding: d.guarding, hp: Math.round(d.hp), species: d.species.id, rideable: d.species.rideable })),
      /** QA: the awake ecology — who is doing what to whom */
      ecology: () => awake.filter((d) => d.state !== 'idle' && d.state !== 'wander').map((d) => ({ sp: d.species.id, state: d.state, hp: Math.round(d.hp), x: Math.round(d.object.position.x), z: Math.round(d.object.position.z), foe: d.currentFoe ? d.currentFoe.species.id : d.state === 'aggro' || d.state === 'hunt' ? 'player' : null })),
      /** QA: where dino #i stands */
      dinoHeight: (i: number) => dinos[i]?.measuredHeight() ?? null,
      dinoPos: (i: number) => { const d = dinos[i]; return d ? { x: d.object.position.x, y: d.object.position.y, z: d.object.position.z } : null },
      /** QA: light the beacon where it stands (the finale's showpiece) */
      lightBeacon: () => { beacon.light(true); beaconLit = true },
      /** QA: is ambient occlusion running? (it is opt-in — it costs 5-15 ms) */
      aoOn: () => settings.values.ao,
      /** QA: how many bodies have hit the ground (the thud fires with or without audio) */
      thuds: () => thudCount,
      /** QA: how far dino #i has rolled over (radians; the topple) */
      dinoRoll: (i: number) => dinos[i]?.object.rotation.z ?? 0,
      /** QA: kill dino #i, as a blow from the player would */
      killDino: (i: number) => { const f = feetPos(); dinos[i]?.kill(f.x, f.z) },
      /** QA: drop a wild dino of a species here */
      spawnDino: (id: string, x: number, z: number) => { const d = spawnDino(id, x, z); return d.index },
      dinoCalib: () => dinos.map((d) => ({ sp: d.species.id, ...d.debugCalib })),
      /** QA: every species' clip resolution + the model's full clip list */
      animAudit: () => {
        const out: Record<string, { clips: string[]; slots: Record<string, string | null>; height: number }> = {}
        for (const d of dinos) {
          if (out[d.species.id]) continue
          const slots = d.clipReport()
          if (Object.values(slots).every((v) => v === null)) continue // not loaded yet
          out[d.species.id] = { clips: clipNamesByModel.get(d.species.model) ?? [], slots, height: d.species.height }
        }
        return out
      },
      /** QA: per species, where the high parts (head) sit vs the heading — negative means the rig walks backwards */
      facingAudit: () => {
        const out: Record<string, number> = {}
        for (const d of dinos) { if (out[d.species.id] !== undefined) continue; const h = d.headSide(); if (h !== null) out[d.species.id] = +h.toFixed(2) }
        return out
      },
      /** QA: nearest dino of a species → its position and heading (for a side-on walking portrait) */
      dinoPose: (id: string) => { const d = nearestDino(Infinity, (x) => x.species.id === id); return d ? { x: d.object.position.x, y: d.object.position.y, z: d.object.position.z, heading: d.facing, state: d.state, speed: d.speedNow } : null },
      /** QA: material flags of one loaded rig per species */
      rigAlbedos: () => { const out: Record<string, string[]> = {}; for (const d of dinos) { if (out[d.species.id]) continue; const r = d.albedoReport(); if (r.length) out[d.species.id] = r } return out },
      rigMaterials: () => { const out: Record<string, string[]> = {}; for (const d of dinos) { if (out[d.species.id]) continue; const r = d.materialReport(); if (r.length) out[d.species.id] = r } return out },
      /** QA: draw state of the nearest dino of a species */
      /** QA: the terrain LOD cache's time-to-live, for A/B (M62) */
      setTerrainCacheTtl: (ms: number) => setTerrainCacheTtl(ms),
      /** QA (M60): mixers are built lazily; nothing drawable may be without one */
      anim: () => ({
        dinos: dinos.length,
        withRig: dinos.filter((d) => d.hasRig).length,
        withMixer: dinos.filter((d) => d.hasAnim).length,
        unanimated: dinos.filter((d) => d.unanimated).length,
        unrigged: dinos.filter((d) => d.unrigged).length,
      }),
      /** QA: what the path queries cost (tools/qa-trek.mjs) */
      nav: () => ({ ...navStats }),
      /** QA: the most expensive single dino update since the last read */
      worstDino: () => { const o = { ...dinoWorst }; dinoWorst.ms = 0; return o },
      setNavBudget: (n: number) => setNavBudget(n),
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
      /** QA: stand 2.2 m south of dino #index, facing it (the taming gate follows ONE animal) */
      gotoDinoIndex: (index: number) => {
        const d = dinos[index]
        if (!d || !d.object.visible) return false
        const px = d.object.position.x, pz = d.object.position.z + 2.2
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
      setGod: (on: boolean) => { god = on },
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
      gateSite: () => ({ x: gateSite.x, z: gateSite.z, doorZ }),
      beaconSite: () => ({ x: beaconSite.x, z: beaconSite.z, y: beacon.groundY }),
      beaconLit: () => beaconLit,
      alphaSlain: () => alphaSlain,
      survival: () => ({ ...survival.serialize(), winded: survival.winded }),
      setSurvival: (s: { food?: number; water?: number; stamina?: number; warmth?: number }) => { if (s.food !== undefined) survival.food = s.food; if (s.water !== undefined) survival.water = s.water; if (s.stamina !== undefined) survival.stamina = s.stamina; if (s.warmth !== undefined) survival.warmth = s.warmth },
      nearWater: () => nearWaterFor(feetPos()),
      nearFire: () => { const f = feetPos(); return building.nearFire(f.x, f.z) },
      hintsSeen: () => onboarding.serialize(),
      /** QA: take damage (the death/respawn path) */
      hurt: (n: number) => hurtPlayer(n),
      /** QA: every placed piece, kind and where (pieces land where you AIM,
       *  which is a few metres ahead of your feet — QA has to walk to them) */
      pieceList: () => building.serialize().map((p) => ({ kind: p.kind, x: p.gx * 3, z: p.gz * 3, y: p.baseY })),
      /** QA: what the chest you are standing at holds (null = no chest here) */
      chestAt: () => {
        const f = feetPos()
        const c = building.chestNear(f.x, f.z)
        return c ? chests.contents(Chests.key(c.gx, c.gz)) : null
      },
      /** QA: move something between the pack and that chest */
      chestMove: (id: ItemId, dir: 'in' | 'out', all = false) => hud.onChestMove?.(id, dir, all),
      /** QA (M68): the very function the Wayfinder points with */
      compass: (fx: number, fz: number, tx: number, tz: number) => compass(fx, fz, tx, tz),
      /** QA (M69): eat the best food in the pack, exactly as F does */
      eat: () => {
        const heldFood = inventory.held && inventory.held in FOODS ? (inventory.held as FoodId) : null
        const pick = heldFood ?? (['cookedmeat', 'berry', 'rawmeat'] as FoodId[]).find((f) => inventory.count(f) > 0) ?? null
        if (!pick || !inventory.remove(pick, 1)) return false
        const f = survival.eat(pick)
        playerHp = Math.max(1, Math.min(100, playerHp + f.hp))
        return true
      },
      /** QA (M71): the Wayfinder relic — where it lies and whether it is lifted */
      wayfinder: () => wayfinder.debug(),
      falls: () => waterfalls.debug(),
      map: () => mapView.debug(),
      toggleMap: () => mapView.toggle(),
      frogs: () => ambience.frogs,
      groundColorAt: (x: number, z: number) => groundColorProbe(x, z),
      forestAt: (x: number, z: number) => ({ mask: +forestMaskAt(x, z).toFixed(3), kind: forestKindAt(x, z) }),
      air: () => ({ humid: +daynight.humid.toFixed(3), submerged: +submerged.toFixed(3), fogFar: Math.round((scene.fog as THREE.Fog).far), fog: (scene.fog as THREE.Fog).color.getHexString() }),
      fallSound: () => ambience.fallLevel,
      /** QA (M71): what the relic is pointing at right now */
      wayfinderTarget: () => {
        const t = wayfinderTarget()
        if (!t) return null
        const f = feetPos()
        return { ...t, dir: compass(f.x, f.z, t.x, t.z), d: Math.round(Math.hypot(t.x - f.x, t.z - f.z)) }
      },
      /** QA: put an item out of the pack, as moving it into a chest does */
      take: (id: ItemId, n = 1) => inventory.remove(id, n),
      /** QA (M68): the tablets — what has been read, what is known */
      engrams: () => engrams.debug(),
      /** QA: where the tablets are, for the opening run (tools/qa-opening.mjs) */
      tabletSites: () => ENGRAMS.map((e) => {
        const r = worldMeta!.ruinSites.find((q) => q.tag === e.site)
        return r ? { tag: e.site, recipe: e.recipe, x: r.x, z: r.z + 3.5 } : null
      }).filter((v): v is { tag: string; recipe: ItemId; x: number; z: number } => v !== null),
      /** QA: grant every tablet, for checks that are about the tier and not
       *  about finding it (the homestead gate's bench/chest flow) */
      learnAll: () => { engrams.restore(undefined, true); hud.refreshPanel(); return engrams.debug() },
      /** QA: is a workbench in reach? */
      nearBench: () => { const f = feetPos(); return building.nearBench(f.x, f.z) },
      /** QA: where the bedroll is, and where the player would wake */
      bedroll: () => building.lastBedroll(),
      /** QA: what the mixer has actually played, and anything that failed to load */
      sfx: () => ({ ready: sfx.ready, plays: { ...sfx.plays }, missing: [...sfx.missing] }),
      ground: () => { const f = feetPos(); return groundKindAt(f.x, f.z) },
      groundHex: () => { const f = feetPos(); return groundHexAt(f.x, f.z) },
      /** the three point-light slots, who holds them, and the scene's REAL light count (lever A) */
      lights: () => {
        let n = 0
        scene.traverse((o) => { if ((o as THREE.PointLight).isPointLight) n++ })
        return { slots: lights.debug(), emitters: lights.emitterCount, scenePointLights: n }
      },
      alphaInfo: () => gatekeeper ? gatekeeper.drawInfo() : null,
      dinoCards: () => dinoImpostors.debug(),
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

  bootStage('lighting the world…', 68)
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
    // the day's eight environment maps, baked here so the first frame already
    // has the right sky in every reflection (M45)
    daynight.bakeEnvironments()
    // THE SCENE MUST BE IN ITS FINAL LIGHTING STATE BEFORE ANYTHING COMPILES.
    // `scene.environment` is part of every material's program cache key, and
    // DayNight only sets it on its first apply() — which happened in the first
    // frame, AFTER this warm-up. So the warm-up compiled ~100 programs against
    // a null environment and the game quietly recompiled each material the
    // moment it was first drawn: a 130-180 ms freeze on entering a region,
    // named after whatever tree or hide happened to appear there (M32). One
    // call, and they all compile here instead.
    daynight.setTime(daynight.time)
    // (The rigs are NOT waited for here. 31 MB of dino GLBs is the bulk of the
    // load; blocking the world on them cost four seconds and, measured, got
    // 0 of 12 species in on time. Species warm as they arrive instead — see
    // Dino.onFirstRig below, which compiles a rig while it is still hidden.)
    const toggled: THREE.Object3D[] = []
    const reattach = scatter.showAll()
    const reattachRuins = ruins.showAll()
    scene.traverse((o) => { if (!o.visible) { o.visible = true; toggled.push(o) } })
    const detach: (() => void)[] = [waterfalls.attachForWarmup()]
    const seen = new Set<string>()
    const warmRigs: [string, THREE.Object3D][] = []
    for (const d of dinos) {
      if (seen.has(d.species.id)) continue
      const undo = d.attachForWarmup()
      if (undo && d.rig) { seen.add(d.species.id); detach.push(undo); warmRigs.push([d.species.id, d.rig]) }
    }
    // TWICE, ONCE PER OUTPUT SURFACE. A material's program cache key carries
    // the BOUND RENDER TARGET's colour space and tone mapping, so one material
    // is two programs: one for the canvas (sRGB, ACES) and one for the
    // composer's linear HDR target. The warm-up drew to the canvas; the game
    // draws through the composer — so every material quietly compiled its
    // other half the first time it was seen in play. Same shape of bug as the
    // environment map in M32, found with tools/qa-compile.mjs (M54).
    renderer.setRenderTarget(post.composer.renderTarget1 as THREE.WebGLRenderTarget)
    renderer.compile(scene, cam.camera)
    renderer.setRenderTarget(null)
    renderer.compile(scene, cam.camera)
    // ONE ISLAND-WIDE SHADOW FRAME: the depth variant of a material compiles
    // when the material first enters the shadow box, and the box is 85 m — so
    // every region used to cost its own depth compiles as you walked into it
    // (M31). Widen the box to the whole island for this one frame.
    daynight.setShadowExtent(2100)
    renderer.shadowMap.needsUpdate = true
    renderer.render(scene, cam.camera)
    daynight.setShadowExtent(daynight.shadowReach)
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
    // and every species' mid-band impostor card, captured here rather than by
    // the first rig to arrive after the hook is installed — that capture
    // compiled the card's program in whatever frame it landed in (M33)
    for (const [id, model] of warmRigs) {
      const sp = SPECIES[id]
      if (sp && !sp.alpha) dinoImpostors.capture(renderer, id, model, sp.height, sp.facingOffset ?? 0)
      Dino.markWarmed(id)
    }
    renderer.compile(scene, cam.camera) // the card programs
    for (const undo of detach) undo()
    for (const o of toggled) o.visible = false
    reattach()
    reattachRuins()
    // species that finish loading later: compile + upload as each arrives (the
    // rig is attached to its dino at this point; a shadow-mapped frame with
    // the light's box moved onto it compiles the skinned depth variant too)
    // Each species arrives on its own (the clone pump feeds four rigs a
    // frame), and warming one used to cost a 200-900 ms freeze: two
    // renderer.compile() calls plus two full renders, all synchronous, in
    // whatever frame the GLB happened to finish in (M31 hitch hunt).
    // compileAsync() hands the work to the driver's parallel-compile
    // extension and returns a promise, so the shaders build while the game
    // keeps running; only the shadow frame and the impostor capture — one
    // render each — still land on the main thread.
    Dino.onFirstRig = (id, model, dino) => {
      const t = performance.now()
      model.updateMatrixWorld(true)
      // THE RIG IS HIDDEN UNTIL ITS SHADERS EXIST. renderer.compile(root, cam,
      // scene) compiles the materials under `root` against the LIVE scene's
      // lights, fog and environment — and it walks with traverse(), not
      // traverseVisible(), so a hidden rig still compiles. That is the whole
      // trick: the async compile can no longer lose the race to the first
      // frame that draws the animal, which is how a species used to cost a
      // 40-100 ms freeze the moment you met it (M33).
      model.visible = false
      // both output surfaces, as the boot warm-up does — the canvas and the
      // composer's linear target are two programs for the same material (M54)
      renderer.setRenderTarget(post.composer.renderTarget1 as THREE.WebGLRenderTarget)
      const offscreen = renderer.compileAsync(model as unknown as THREE.Scene, cam.camera, scene)
      renderer.setRenderTarget(null)
      void Promise.all([offscreen, renderer.compileAsync(model as unknown as THREE.Scene, cam.camera, scene)]).then(() => {
        model.visible = true
        // The DEPTH variant only compiles when the rig is actually drawn into
        // the shadow map — and at this moment the animal is almost always
        // dormant, which means its whole object is detached from the scene
        // (M24). So the shadow frame drew nothing and the depth program was
        // left to compile in play, the first time one woke near you: a 120 ms
        // freeze with no new material in sight (M33). Attach it for the frame.
        //
        // The attach used to be `const obj = model.parent; if (obj.parent ===
        // null) scene.add(obj)` — and by the time this promise resolved,
        // `setRig` had ALREADY detached the model from a dormant dino, so
        // `model.parent` was null, `obj` was null, and nothing was attached.
        // The shadow frame then drew no rig at all and the depth program was
        // left exactly where M33 thought it had removed it from: in play, at
        // ~150 ms of render in the frame the animal's shadow first appears
        // (M55, named by tools/qa-compile.mjs's onBeforeShadow hook).
        // `attachForWarmup()` has handled precisely this case since M34.
        const undoAttach = dino.attachForWarmup()
        const saved = daynight.shadowFocus()
        const p = new THREE.Vector3()
        model.getWorldPosition(p)
        daynight.focusShadow(p.x, p.z)
        renderer.shadowMap.needsUpdate = true
        renderer.render(scene, cam.camera) // compiles the skinned DEPTH variant
        daynight.focusShadow(saved.x, saved.z)
        undoAttach?.()
        uploadTextures(model)
        // and the species' cross-card impostor for the mid band — then compile
        // it too, or its first appearance is a new program mid-frame (M30 spin)
        const sp = SPECIES[id]
        if (sp && !sp.alpha) {
          dinoImpostors.capture(renderer, id, model, sp.height, sp.facingOffset ?? 0)
          void renderer.compileAsync(scene, cam.camera)
        }
        speciesWarmed++
        if (import.meta.env.DEV) console.log(`warm ${id}: ${(performance.now() - t).toFixed(0)} ms`)
      })
    }
    console.log(`shader warm-up: ${renderer.info.programs?.length ?? '?'} programs, ${seen.size} species ready in ${(performance.now() - t0).toFixed(0)} ms`)
  }

  // --- the boot card comes down when the island is warm ---
  // The eleven rigs are 31 MB and warm one at a time as they arrive; each one
  // compiles its shaders and uploads its skin the first time it is drawn. Those
  // used to land in the player's first minute as 40-100 ms freezes. Now the
  // card stays up until every species has been through that (or 12 s, because
  // a slow connection must still get to play), and `ready` — which every gate
  // and QA tool waits on — means "warm", not "the canvas exists".
  // not the Gatekeeper: it stands behind the caldera door, it shares the
  // T-Rex's rig (so its shaders are already built), and waiting for its clone
  // to reach the front of a 200-deep queue added five seconds to the load
  const speciesTotal = new Set(dinos.filter((d) => !d.species.alpha).map((d) => d.species.id)).size
  const bootDeadline = performance.now() + 12000
  const bootTick = (): void => {
    if (bootDone) return
    const done = speciesWarmed >= speciesTotal || performance.now() > bootDeadline
    bootStage(`waking the animals… ${Math.min(speciesWarmed, speciesTotal)}/${speciesTotal}`, 70 + 30 * Math.min(1, speciesWarmed / Math.max(1, speciesTotal)))
    if (!done) return
    bootDone = true
    // ONE LAST ISLAND-WIDE SHADOW FRAME, with a rig of every species attached.
    // A skinned material's DEPTH program only exists once it has been drawn
    // into the shadow map, and the load warm-up ran before any rig had loaded.
    // Everything that arrived since gets its depth variant here, behind the
    // card, instead of the first time an animal walks past you (M33).
    {
      const undo: (() => void)[] = []
      const seen = new Set<string>()
      for (const d of dinos) {
        if (seen.has(d.species.id)) continue
        seen.add(d.species.id)
        const u = d.attachForWarmup()
        if (u) undo.push(u)
      }
      // and every prop and ruin, not just the rigs: two depth programs were
      // still compiling at the wood line, and the load warm-up's own pass runs
      // before the terrain has streamed a single cell in (M36)
      undo.push(scatter.showAll(), ruins.showAll())
      // FROM FIVE PLACES, not one. A material compiles its depth program when
      // it is first drawn INTO THE SHADOW MAP, and the shadow camera is an
      // ortho box centred on the player — widening it to ±2100 m still centres
      // it on spawn, so casters in the far corners were never drawn and the
      // wood line kept its two compiles (M40). Five focus points cover the
      // island; each costs one render, behind the boot card.
      const saved = daynight.shadowFocus()
      daynight.setShadowExtent(1200)
      for (const [fx, fz] of [[0, 1560], [-286, 793], [-250, 1040], [300, -560], [-700, -400], [0, -1000]]) {
        daynight.focusShadow(fx, fz)
        renderer.shadowMap.needsUpdate = true
        renderer.render(scene, cam.camera)
      }
      daynight.setShadowExtent(daynight.shadowReach)
      daynight.focusShadow(saved.x, saved.z)
      renderer.shadowMap.needsUpdate = true
      renderer.render(scene, cam.camera)
      for (const u of undo) u()
    }
    bootEl?.classList.add('done')
    setTimeout(() => bootEl?.remove(), 900)
  }

  // --- THE UPLOAD WARDEN ---
  // A texture reaches the GPU the first time it is DRAWN, and that upload is
  // synchronous inside renderer.render(). Walking into a new region drew up to
  // 54 first-sight textures in a single frame — a 475 ms freeze, and the
  // sharpest of the "sharp frame drops" the user reported (M31 hitch hunt).
  // The load-time sweep above can only reach what has finished loading by
  // then; the ruins, the player rig and every species arrive after it.
  // So: sweep the scene every two seconds for textures the GPU has not seen,
  // and push at most two per frame — spread out, and long before anything
  // draws them. initTexture() on an already-resident texture is free.
  const uploadSeen = new WeakSet<THREE.Texture>()
  const uploadQueue: THREE.Texture[] = []
  let sweepAtFrame = 0
  let uploadsDone = 0
  function uploadWarden(frameNo: number): void {
    if (frameNo >= sweepAtFrame) {
      sweepAtFrame = frameNo + 45
      const sweep = (o: THREE.Object3D) => {
        const m = (o as THREE.Mesh).material
        if (!m) return
        for (const mat of Array.isArray(m) ? m : [m]) {
          for (const v of Object.values(mat as unknown as Record<string, unknown>)) {
            const t = v as THREE.Texture | null
            if (t && t.isTexture && !uploadSeen.has(t)) {
              uploadSeen.add(t)
              uploadQueue.push(t)
            }
          }
        }
      }
      scene.traverse(sweep)
      // and the off-scene roots: source GLBs, dormant rigs, distant ruins —
      // detached on purpose (M24), and exactly what lands on you later
      for (const root of warmRoots) root.traverse(sweep)
    }
    // the first sweep runs inside the load, where a stall costs nothing: drain
    // it whole. After that, two a frame (six if a batch has piled up).
    const budget = uploadsDone === 0 ? uploadQueue.length : uploadQueue.length > 12 ? 6 : 2
    for (let i = 0; i < budget && uploadQueue.length; i++) {
      renderer.initTexture(uploadQueue.shift()!)
      uploadsDone++
    }
  }

  // --- main loop ---
  let accumulator = 0
  let last = performance.now()
  let frameCount = 0
  let perfUpdate = 0
  let perfRender = 0
  let shadowEvery = 1
  const awake: Dino[] = []
  const sepBuckets = new Map<number, Dino[]>()
  let cardCamX = Infinity, cardCamZ = Infinity, cardCamYaw = 0
  const senses: Senses = { awake, onHit: (x, y, z, heavy) => hitFx.burst(x, y, z, heavy) }
  const perfSec = { dinos: 0, scatter: 0, grass: 0, terrain: 0, physics: 0 }
  /** this frame's raw section times + the worst frame since the last read (the hitch hunt) */
  const frameSec = { dinos: 0, dinoWorst: 0, nav: 0, scatter: 0, grass: 0, terrain: 0, physics: 0, uploads: 0, update: 0, render: 0, newProgs: 0, newTex: 0 }
  /** the single most expensive dino update since the last read (QA) */
  const dinoWorst = { ms: 0, species: '', state: '', dist: 0, dormant: false }
  let worstFrame: { ms: number; sec: typeof frameSec; z: number } | null = null
  // frame-time histogram for the jitter hunt: max / p95 since the last read
  const frameTimes: number[] = []

  function frame(now: number): void {
    requestAnimationFrame(frame)
    // paused: the GPU profiler drives its own renders and the game loop
    // competing for the same GPU made every measurement drift (M31)
    if (document.hidden || paused) {
      last = now
      return
    }
    renderer.info.reset()
    const t0 = performance.now()
    frameTimes.push(now - last)
    if (frameTimes.length > 2000) frameTimes.splice(0, 1000)
    let dt = (now - last) / 1000
    last = now
    dt = Math.min(dt, 0.1)
    // FROZEN (QA): keep rendering, stop the world. A herd walking through the
    // frame moved the GPU median by several milliseconds between reads and made
    // every profile unrepeatable (M31). dt = 0 freezes physics, AI, animation,
    // the sun and the water without touching what is drawn.
    if (frozen) dt = 0
    swingT -= dt
    camKick = Math.max(0, camKick - dt * 0.3)
    if (shake.amp > 0.0005) { shake.t += dt; if (shake.t > 0.35) shake.amp = 0 }
    if (playerHp < 100 && survival.food > 20 && survival.water > 20) playerHp = Math.min(100, playerHp + dt * 1.5)

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
    // the frame's path-query allowance is handed out fresh (navmesh.ts)
    beginNavFrame()
    // and the frame's allowance for building animation mixers ahead of the
    // wake radius (dinos.ts, M60)
    Dino.animBudget = 2
    // WHICH ANIMAL COST THE FRAME. `dinos` spikes to 25-40 ms while walking
    // (M55, tools/qa-trek.mjs) and the section timer cannot say whether that
    // is one animal doing something expensive or forty doing a little. One
    // clock per update answers it; 80 performance.now() calls a frame is
    // nothing against the thing being measured.
    let worstOne = 0
    let worstWho: Dino | null = null
    for (const d of dinos) {
      if (d.dormant && ((frameCount + d.index) & 7) !== 0) continue
      const t = performance.now()
      d.update(dt, pFeet, hurtPlayer, senses)
      const ms = performance.now() - t
      if (ms > worstOne) { worstOne = ms; worstWho = d }
    }
    if (worstOne > dinoWorst.ms) {
      dinoWorst.ms = worstOne
      dinoWorst.species = worstWho?.species.id ?? ''
      dinoWorst.state = worstWho?.state ?? ''
      dinoWorst.dist = Math.round(worstWho ? worstWho.object.position.distanceTo(pFeet) : 0)
      dinoWorst.dormant = worstWho?.dormant ?? false
    }
    hitFx.update(dt)
    perfSec.dinos = perfSec.dinos * 0.95 + (performance.now() - tD0) * 0.05
    frameSec.dinos = performance.now() - tD0
    frameSec.nav = navStats.frameMs
    frameSec.dinoWorst = worstOne
    // the AWAKE set once per frame — the pair loops below are n² and 1500²
    // with a `continue` per dormant dino was still a million iterations
    awake.length = 0
    for (const d of dinos) if (!d.dormant && d.object.visible) awake.push(d)
    // herds: every half second each herbivore learns where its kind stands (60 m)
    if (frameCount % 30 === 0) {
      for (const a of awake) {
        if (a.species.diet !== 'herbivore') continue
        let sx = 0, sz = 0, n = 0
        for (const b of awake) {
          if (b === a || b.species !== a.species || b.state === 'dead') continue
          if (a.object.position.distanceTo(b.object.position) < 60) { sx += b.object.position.x; sz += b.object.position.z; n++ }
        }
        if (n) { a.herdX = sx / n; a.herdZ = sz / n } else { a.herdX = NaN; a.herdZ = NaN }
      }
    }
    // pack aggro: a wild raptor entering aggro pulls packmates in range
    for (const d of awake) {
      if (d.state !== 'aggro') continue
      for (const o of awake) {
        if (o === d || o.state === 'tamed' || o.state === 'ko' || o.state === 'dead') continue
        if (o.species.id === d.species.id && o.object.position.distanceTo(d.object.position) < d.species.packRange) {
          o.joinPack(d.currentFoe)
        }
      }
    }
    // dino-dino separation + player-dino body push (soft, gameplay-level).
    // Pairs come from a 12 m bucket grid over the awake set: the plain n²
    // loop was ~10K hypots a frame at the wood line (the `frame` self-time
    // in the M25 profile); two animals more than 12 m apart never touch
    sepBuckets.clear()
    for (const d of awake) {
      const k = ((Math.floor(d.object.position.x / 12) + 4096) << 13) | (Math.floor(d.object.position.z / 12) + 4096)
      const list = sepBuckets.get(k)
      if (list) list.push(d); else sepBuckets.set(k, [d])
    }
    for (let i = 0; i < awake.length; i++) {
      const a = awake[i]
      const bx = Math.floor(a.object.position.x / 12) + 4096, bz = Math.floor(a.object.position.z / 12) + 4096
      for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
        const list = sepBuckets.get(((bx + ox) << 13) | (bz + oz))
        if (!list) continue
        for (const b of list) {
        if (b.index <= a.index) continue // each pair once
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
    scatter.pumpColliders(physics)
    scatter.updateHits(dt) // the wobble when you hit something, and felled trees going over
    advanceWind(dt) // the one clock every wind-bent material shares (M66)
    wayfinder.update(dt)
    // THE LIVE BEARING (M71): twice a second, and only while the relic is in
    // the pack. Stow it in a chest and the line goes away — which is what
    // "leave it behind to go pure sandbox" looks like on screen.
    wayTick += dt
    if (wayTick >= 0.5) {
      wayTick = 0
      if (!inventory.count('wayfinder')) hud.setWayfinder(null)
      else {
        const t = wayfinderTarget()
        const wf = feetPos()
        hud.setWayfinder(t ? `🧭 ${compass(wf.x, wf.z, t.x, t.z)} ${Math.round(Math.hypot(t.x - wf.x, t.z - wf.z))}m` : '🧭 —')
      }
    }
    // LOD bands and cover culling re-evaluate when the viewer has moved 3 m
    // (12K prop groups a frame was 2 ms of the same answer)
    {
      const vx = freeCam ? freeCam.x : focus.x, vz = freeCam ? freeCam.z : focus.z
      // every frame: scatter starts a sweep when the viewer has moved 3 m and
      // spreads it over the next four frames (M33)
      scatter.updateVisibility(vx, vz)
    }
    perfSec.scatter = perfSec.scatter * 0.95 + (performance.now() - tS) * 0.05
    frameSec.scatter = performance.now() - tS
    tS = performance.now()
    grass.update(freeCam ? freeCam.x : focus.x, freeCam ? freeCam.z : focus.z)
    perfSec.grass = perfSec.grass * 0.95 + (performance.now() - tS) * 0.05
    frameSec.grass = performance.now() - tS
    water.update(dt)
    ambience.falls(waterfalls.update(dt, cam.camera.position))
    daynight.camera = cam.camera
    daynight.setFocus(focus.x, focus.z)
    daynight.advance(dt)
    skyExtras.update(dt, cam.camera, daynight.keyDir, daynight.nightness, daynight.keyColor, daynight.fogFar)
    mapView.update(dt, focus, cam.yaw, creative)
    ambience.setPlace(humid, forestKindAt(focus.x, focus.z) === FOREST_KIND.PINE ? Math.max(0, Math.min(1, (forestMaskAt(focus.x, focus.z) + 0.35) / 0.6)) : 0)
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
      // the shake: two out-of-phase sines decaying over ~0.35 s, pushed along
      // the blow's direction and across it, in CAMERA space so it reads the
      // same whichever way you are facing
      if (shake.amp > 0.0005) {
        const k = shake.amp * Math.max(0, 1 - shake.t / 0.35) ** 2
        const a = Math.sin(shake.t * 62) * k
        const b2 = Math.sin(shake.t * 41 + 1.7) * k
        const right = new THREE.Vector3().setFromMatrixColumn(cam.camera.matrixWorld, 0)
        const up = new THREE.Vector3().setFromMatrixColumn(cam.camera.matrixWorld, 1)
        cam.camera.position.addScaledVector(right, a * shake.dirX + b2 * 0.4)
        cam.camera.position.addScaledVector(up, b2 * shake.dirY + a * 0.3)
        cam.camera.rotateZ(a * 0.06)
      }
      if (riding) cam.camera.position.addScaledVector(cam.camera.getWorldDirection(new THREE.Vector3()), -2.2)
    }

    // ghost preview when holding a placeable
    const held = inventory.held
    building.updateGhost(held && ITEMS[held].placeable ? (held as PieceKind) : null, held && ITEMS[held].placeable ? updateAim() : null)

    // survival: drains, stamina, starvation
    player.sprintAllowed = survival.canSprint
    survival.sprinting = !riding && player.sprinting
    survival.moving = riding ? Math.hypot(riding.mover?.intent.vx ?? 0, riding.mover?.intent.vz ?? 0) > 0.1 : player.moving
    // INSIDE (M51): the cave takes the sky away, over about a second, so
    // walking into one dims rather than pops. It also drives the hint and the
    // reason a torch is worth carrying.
    {
      const cf0 = feetPos()
      const wantIn = caves.inside(cf0.x, cf0.z) ? 1 : 0
      caveDark += (wantIn - caveDark) * Math.min(1, dt * 2.2)
      daynight.interior = caveDark
    }
    // UNDER THE WATER (M67): the same shape as the cave — a lerp, so surfacing
    // is a lift rather than a pop. Driven by the CAMERA, not the player: you
    // see what the camera sees, and in third person the two differ by metres.
    {
      const cp = cam.camera.position
      const level = water.waterLevelAt(cp.x, cp.z)
      const wantUnder = level !== null && cp.y < level - 0.12 ? 1 : 0
      submerged += (wantUnder - submerged) * Math.min(1, dt * 6)
      if (submerged < 0.002) submerged = 0
      daynight.submerged = submerged
      skyExtras.setSubmerged(submerged > 0.5)
      // THE MARSH AIR (M73). Same lerp, driven by the camera for the same
      // reason. `biomeAt` is a single byte-grid tap, so this is cheaper than
      // the water query already above it.
      const wantHumid = biomeAt(cp.x, cp.z) === BIOME.SWAMP ? 1 : 0
      humid += (wantHumid - humid) * Math.min(1, dt * 1.2)
      if (humid < 0.002) humid = 0
      daynight.humid = humid
    }
    // THE TABLETS (M68): read themselves when you stand close enough. Cheap —
    // seven distance tests, only until all seven are read — and checked on the
    // same cadence as everything else that watches where you are standing.
    if (frameCount % 12 === 0 && engrams.count < engrams.total) {
      const ef = feetPos()
      engrams.update(ef.x, ef.z, (tag) => {
        const r = worldMeta!.ruinSites.find((q) => q.tag === tag)
        return r ? { x: r.x, z: r.z + 3.5 } : null
      })
    }
    // the cold (M50): how high, how dark, and what is keeping it off you
    {
      const cf = feetPos()
      survival.altitude = cf.y
      survival.nightness = daynight.nightness
      survival.nearFire = building.nearFire(cf.x, cf.z, 7) || (beaconLit && Math.hypot(cf.x - beaconSite.x, cf.z - beaconSite.z) < 30)
      survival.hasCoat = inventory.count('furcoat') > 0
    }
    const starve = survival.update(dt, creative)
    if (starve < 0) {
      playerHp = Math.max(0, playerHp + starve)
      if (playerHp <= 0) hurtPlayer(1) // the respawn path
    }
    keystones.update(dt, feetPos().setY(feetPos().y + 1.3))
    building.update(dt, cam.camera.position)
    ruins.update(cam.camera.position.x, cam.camera.position.z)
    // the dino cards face the camera: re-yaw when it has moved 2 m or turned 3°
    if (Math.hypot(cam.camera.position.x - cardCamX, cam.camera.position.z - cardCamZ) > 2 || Math.abs(cam.yaw - cardCamYaw) > 0.05) {
      cardCamX = cam.camera.position.x; cardCamZ = cam.camera.position.z; cardCamYaw = cam.yaw
      dinoImpostors.face(cardCamX, cardCamZ, (id) => dinos[id].facing + (dinos[id].species.facingOffset ?? 0))
    }
    if (gatekeeper && !alphaSlain && gatekeeper.state === 'dead') {
      alphaSlain = true
      hud.toast('The Gatekeeper falls. The causeway is yours.')
      ambience.swell()
    }
    beacon.update(dt, cam.camera.position)
    // the point-light slots follow the nearest fires — ranked from the player,
    // never from the camera (which orbits him when you turn)
    lights.update(dt, focus)
    {
      const fb = feetPos()
      border.update(dt, fb)
      // belt and braces behind the border colliders (a teleport, a mount)
      if (WorldBorder.clamp(fb) && !riding) player.mover.teleport(fb.x, player.mover.position.y, fb.z)
    }
    if (doorAnim > 0) {
      doorAnim -= dt
      doorMesh.position.y = Math.max(doorGroundY - 8.2, doorMesh.position.y - dt * 4)
    }
    // context prompt
    const fk = feetPos()
    const nearKey = keystones.sites.find((k) => !k.collected && Math.hypot(k.x - fk.x, k.z - fk.z) < 5)
    const nearGate = !doorOpen && Math.hypot(fk.x - gateSite.x, fk.z - doorZ) < 11
    const nearBeacon = !beaconLit && Math.hypot(fk.x - beaconSite.x, fk.z - beaconSite.z) < 11
    // onboarding: hints fire once, when the thing they explain first appears
    // (the checks run once a second, and only for hints not yet seen)
    onboarding.update(dt)
    if (!creative && frameCount % 60 === 0) {
      const seen = onboarding.hasSeen
      if (!seen('hungry') && survival.food < 40) onboarding.hint('hungry')
      if (!seen('thirsty') && survival.water < 40) onboarding.hint('thirsty')
      if (!seen('stamina') && survival.winded) onboarding.hint('stamina')
      if (!seen('cold') && survival.cold) onboarding.hint('cold')
      if (!seen('cave') && caveDark > 0.5) onboarding.hint('cave')
      if (!seen('night') && daynight.nightness > 0.7) onboarding.hint('night')
      if (!seen('raptor') && nearestDino(30, (d) => d.species.id === 'raptor' && d.state !== 'tamed' && d.state !== 'dead')) onboarding.hint('raptor')
      if (!seen('carcass') && nearestDino(INTERACT_RANGE + 2, (d) => d.state === 'dead')) onboarding.hint('carcass')
      if (!seen('ko') && nearestDino(INTERACT_RANGE + 2, (d) => d.state === 'ko')) onboarding.hint('ko')
      if (!seen('saddle') && nearestDino(INTERACT_RANGE + 2, (d) => d.state === 'tamed' && !d.saddled)) onboarding.hint('saddle')
      if (!seen('keystone-near') && keystones.sites.some((k) => !k.collected && Math.hypot(k.x - fk.x, k.z - fk.z) < 14)) onboarding.hint('keystone-near')
      if (!seen('gate-sight') && Math.hypot(fk.x - gateSite.x, fk.z - gateSite.z) < 90) onboarding.hint('gate-sight')
      if (!seen('bush') && scatter.nodesNear(fk.x, fk.z, 5).bush) onboarding.hint('bush')
    }
    const atBed = building.bedrollNear(fk.x, fk.z) !== null
    const atChest = building.chestNear(fk.x, fk.z) !== null
    const canCook = inventory.count('rawmeat') > 0 && building.nearFire(fk.x, fk.z)
    const canDrink = !riding && nearWaterFor(fk) && survival.water < 99
    if (riding) hud.prompt('E — dismount')
    // the prompt must match what E actually does: by day the bedroll is not a verb
    else if (atBed && daynight.nightness >= 0.3) hud.prompt('E — sleep until dawn')
    else if (atChest) hud.prompt('TAB — the chest')
    else if (canCook) hud.prompt('E — cook the meat')
    else if (canDrink) hud.prompt('E — drink')
    else if (nearBeacon) hud.prompt(keystones.enough ? 'E — light the beacon' : 'the brazier is cold')
    else if (nearGate) hud.prompt(keystones.enough ? 'E — set the keystones' : `sealed — ${keystones.collectedCount}/${keystones.needed} keystones`)
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

    // --- sound ---
    sfx.listener(cam.camera)
    footsteps(dt)
    {
      // the nearest fire crackles; the beacon roars when it is lit
      const fires = building.firePositions()
      if (fires.length) {
        let best = fires[0]
        let bd = Infinity
        for (const f of fires) {
          const d = (f.x - focus.x) ** 2 + (f.z - focus.z) ** 2
          if (d < bd) { bd = d; best = f }
        }
        if (bd < 22 * 22) sfx.crackle(best, dt)
      }
    }
    player.setHeldItem(riding ? null : inventory.held)
    hud.tick(dt, focus.x, focus.y, focus.z, daynight.time, playerHp, (-cam.yaw * 180) / Math.PI, { ...survival.serialize(), winded: survival.winded, warmth: survival.warmth, cold: survival.cold })
    if (perfHud) perfTick(dt)
    frameCount++
    const tW = performance.now()
    uploadWarden(frameCount)
    frameSec.uploads = performance.now() - tW
    // shadows EVERY frame: the every-third-frame update was the jitter — a
    // frame with the shadow pass was ~5 ms heavier than its neighbours, so at
    // the vsync edge every third frame missed and motion strobed 16/16/33.
    // The cost is made steady instead (smaller map, casters only near).
    if (frameCount % shadowEvery === 0) renderer.shadowMap.needsUpdate = true
    const t1 = performance.now()
    const progsBefore = renderer.info.programs?.length ?? 0
    const texBefore = renderer.info.memory.textures
    if (perfHud || gpuProbe) { gpuTimer.poll(); gpuTimer.begin() }
    if (post.enabled) {
      post.gradeFor(daynight.nightness, daynight.keyColor)
      post.air_update(cam.camera, daynight.keyDir, (scene.fog as THREE.Fog).color, daynight.keyColor, daynight.nightness)
      post.render()
    } else {
      renderer.render(scene, cam.camera)
    }
    if (perfHud || gpuProbe) gpuTimer.end()
    const t2 = performance.now()
    frameSec.newProgs = (renderer.info.programs?.length ?? 0) - progsBefore
    frameSec.newTex = renderer.info.memory.textures - texBefore
    perfUpdate = perfUpdate * 0.95 + (t1 - t0) * 0.05
    perfRender = perfRender * 0.95 + (t2 - t1) * 0.05
    frameSec.update = t1 - t0
    frameSec.render = t2 - t1
    if (!worstFrame || t2 - t0 > worstFrame.ms) worstFrame = { ms: t2 - t0, sec: { ...frameSec }, z: feetPos().z }
    adaptResolution(dt * 1000)
    bootTick()
    dbg.ready = bootDone
  }
  requestAnimationFrame(frame)

  // FOOTSTEPS. A step every stride's worth of ground covered — not on a timer,
  // so they stay in step whatever the speed — and the sample is chosen by what
  // the terrain is actually painted with underfoot (`groundKindAt`), so walking
  // from the meadow into the wood goes soft and the beach crunches.
  let strideLeft = 0
  let lastFootX = 0
  let lastFootZ = 0
  function footsteps(dt: number): void {
    void dt
    const body = riding?.mover ?? player.mover
    const p = body.position
    const moved = Math.hypot(p.x - lastFootX, p.z - lastFootZ)
    lastFootX = p.x
    lastFootZ = p.z
    if (moved > 8) return // a teleport, not a walk
    const airborne = player.flying || player.swimming || (!riding && !player.mover.grounded)
    if (airborne || moved < 0.0005) { return }
    strideLeft -= moved
    if (strideLeft > 0) return
    if (riding) {
      // a mount is heavier and slower-footed than a person
      strideLeft = 3.2
      sfx.play('step-dirt', { volume: 0.5, rate: 0.62 })
      hitFx.dust(p.x, p.y + 0.05, p.z, groundHexAt(p.x, p.z), true) // a mount kicks up more
      return
    }
    strideLeft = player.sprinting ? 2.05 : 1.55
    const kind = groundKindAt(p.x, p.z)
    sfx.play(`step-${kind}` as const, { volume: player.sprinting ? 0.42 : 0.3, rate: player.sprinting ? 1.08 : 1 })
    // dust at the foot, in the ground's own colour — sand puffs, wet swamp does not
    if (!player.swimming && kind !== 'snow') {
      hitFx.dust(p.x, p.y + 0.06, p.z, groundHexAt(p.x, p.z), player.sprinting)
    }
  }

  // THE F3 READOUT (PERFORMANCE.md's instrument). Refreshed twice a second.
  // GPU ms is the number that matters: everything else in this panel explains
  // it. A player on another machine screenshots this and we learn what their
  // hardware actually does — which is why the GPU's name is on it.
  let perfAccum = 0
  /** Chrome-only, and deliberately blunt: used / limit, in MB. */
  function jsHeapLine(): string {
    const m = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory
    if (!m) return 'not reported by this browser'
    return `${Math.round(m.usedJSHeapSize / 1e6)} / ${Math.round(m.jsHeapSizeLimit / 1e6)} MB`
  }

  function perfTick(dt: number): void {
    perfAccum += dt
    if (perfAccum < 0.5) return
    perfAccum = 0
    const gpu = gpuTimer.median()
    const px = renderer.getDrawingBufferSize(new THREE.Vector2())
    const cards = Object.values(dinoImpostors.debug()).reduce((a, b) => a + b, 0)
    hud.setPerf([
      ['fps', String(hud.fps)],
      ['GPU', gpuTimer.supported ? `${gpu.toFixed(1)} ms  (max ${gpuTimer.max().toFixed(0)})` : 'no timer ext'],
      ['CPU update / draw', `${perfUpdate.toFixed(1)} / ${perfRender.toFixed(1)} ms`],
      ['', ''],
      ['draw calls', String(renderer.info.render.calls)],
      ['triangles', `${(renderer.info.render.triangles / 1e6).toFixed(2)} M`],
      ['pixels', `${px.x}×${px.y} @${pixelRatio.toFixed(2)} (${(px.x * px.y / 1e6).toFixed(1)} Mpx)`],
      ['lights lit/slots', `${lights.debug().filter((l) => l.intensity > 0).length} lit · ${lights.slots} slots · ${lights.emitterCount} sources`],
      ['dinos awake / cards', `${awake.length} / ${cards}`],
      // memory is a budget too, and a player reporting a stuttery machine can
      // now say whether it is close to the tab's ceiling (M57)
      ['JS heap', jsHeapLine()],
      ['', ''],
      ['gpu', GpuTimer.rendererName(renderer.getContext() as WebGL2RenderingContext)],
    ])
  }

  // ADAPTIVE RESOLUTION: the render is fill-bound on a Retina display (the
  // user's 2000×1500 CSS-px window at 1.3× is 5M pixels of cutout foliage,
  // twice) and the frame rate dropped hard whenever the view filled with
  // forest. Watch the frame time; step the pixel ratio down toward 0.7 when a
  // second of frames runs long, back up when it runs short. Rare steps (the
  // buffer reallocation is itself a hitch), hysteresis between the bands.
  // (floor raised 0.7 → 1.0 CSS px: 0.7 was visibly soft — user, M19 — and
  // the scale only steps down under a real, sustained drop now)
  const PR_CAP = Math.min(devicePixelRatio, 1.3)
  const PR_MIN = Math.min(1.0, PR_CAP)
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
    if (avg > 22) next = Math.max(PR_MIN, pixelRatio * 0.88)
    else if (avg < 16 && pixelRatio < PR_CAP) next = Math.min(PR_CAP, pixelRatio * 1.08)
    if (Math.abs(next - pixelRatio) < 0.01) { prCooldown = 1; return }
    prCooldown = next < pixelRatio ? 2 : 3.5 // climb back slowly
    pixelRatio = next
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(innerWidth, innerHeight)
    { const s2 = renderer.getDrawingBufferSize(new THREE.Vector2()); post.setSize(s2.x, s2.y) }
  }

  // The player's own settings, applied once everything they touch exists —
  // `adaptive` and `pixelRatio` are declared above this point, and reading them
  // any earlier is a temporal-dead-zone crash that takes the whole boot with it.
  applySettings()

  // periodic node respawns
  setInterval(() => scatter.tickRespawns(physics), 1000)
}

void boot()

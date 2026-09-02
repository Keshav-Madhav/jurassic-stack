// Jurassic Stack — M4: the core loop. Gather → craft → build → tame → ride,
// on the M3 graybox island, with save/load. Fixed 60 Hz simulation, render-
// rate AI/animation, DOM HUD, and a __g.game debug API that the E2E gate
// drives through the same functions the input handlers call.
import * as THREE from 'three'
import { Terrain } from './terrain'
import { Physics, FIXED_DT } from './physics'
import { Input } from './input'
import { Player } from './player'
import { ThirdPersonCamera } from './camera'
import { DayNight } from './daynight'
import { Dino } from './dinos'
import { SPECIES } from './species'
import { Scatter } from './scatter'
import { Building, type PieceKind } from './building'
import { Ruins } from './ruins'
import { Inventory } from './inventory'
import { ITEMS, type ItemId } from './items'
import { Hud } from './hud'
import { saveGame, loadGame, SAVE_VERSION, type SaveFile } from './save'
import { heightAt, loadHeightmap, SPAWN } from './heightmap'
import { loadNavmesh, findPath } from './navmesh'
import { WaterSystem } from './water'

const SWING_COOLDOWN = 0.45
const REACH = 3.2
const INTERACT_RANGE = 3.8

async function boot(): Promise<void> {
  await loadHeightmap() // everything below samples heightAt
  await loadNavmesh()
  const app = document.getElementById('app')!
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(innerWidth, innerHeight)
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)) // 2x retina fill cost was a top lag source
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  app.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const daynight = new DayNight(renderer, scene)
  const terrain = new Terrain()
  scene.add(terrain.group)

  const water = new WaterSystem()
  water.build()
  scene.add(water.group)

  const physics = new Physics()
  await physics.init()

  const save = await loadGame()

  const spawnPos = save
    ? new THREE.Vector3(save.player.x, save.player.y + 0.5, save.player.z)
    : new THREE.Vector3(SPAWN.x, heightAt(SPAWN.x, SPAWN.z) + 1.2, SPAWN.z)
  const player = new Player(physics, spawnPos)
  void player.load() // async; capsule-less until the Barbarian arrives
  scene.add(player.object)
  let playerHp = save?.player.hp ?? 100

  const input = new Input(renderer.domElement)
  const cam = new ThirdPersonCamera(innerWidth / innerHeight)
  cam.yaw = 0

  const inventory = new Inventory()
  if (save) inventory.restore(save.inventory as ReturnType<Inventory['serialize']>)

  const scatter = new Scatter()
  await scatter.load()
  scene.add(scatter.group)
  if (save) scatter.restore(save.deadNodes as { id: number; respawnAt: number }[])

  const ruins = new Ruins()
  await ruins.build(physics)
  scene.add(ruins.group)

  const building = new Building(physics)
  scene.add(building.group)
  if (save) building.restore(save.pieces as ReturnType<Building['serialize']>)

  if (save) daynight.setTime(save.time)

  // --- dinos ---
  const dinos: Dino[] = []
  const spawnDino = (x: number, z: number): Dino => {
    const d = new Dino(SPECIES.raptor, x, z, dinos.length)
    dinos.push(d)
    scene.add(d.object)
    void d.load()
    return d
  }
  if (save) {
    for (const row of save.dinos as ReturnType<Dino['serialize']>[]) {
      if (!row.alive) continue
      const d = spawnDino(row.x, row.z)
      d.hp = row.hp
      d.saddled = row.saddled
      d.tameProgress = row.tame
      if (row.state === 'tamed') d.state = 'tamed'
    }
  } else {
    spawnDino(SPAWN.x + 26, SPAWN.z - 30)
    spawnDino(SPAWN.x - 40, SPAWN.z - 55)
    spawnDino(120, 420)
    spawnDino(-200, 260)
    spawnDino(60, 80)
    spawnDino(-320, -60)
    spawnDino(240, -140)
  }

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

  const nearestDino = (range: number, filter: (d: Dino) => boolean): Dino | null => {
    const from = feetPos()
    let best: Dino | null = null
    let bd = range
    for (const d of dinos) {
      if (!d.object.visible || d === riding || !filter(d)) continue
      const dist = d.object.position.distanceTo(from)
      if (dist < bd) {
        bd = dist
        best = d
      }
    }
    return best
  }

  const hurtPlayer = (damage: number): void => {
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
    if (swingT > 0 || riding) return false
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
      if (held === 'spear') target.takeHit(12, 5, from.x, from.z)
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
      const hits = held === 'hatchet' && isWood ? 2 : 1
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
    // feed a KO'd dino
    const ko = nearestDino(INTERACT_RANGE, (d) => d.state === 'ko')
    if (ko) {
      if (!inventory.remove(ko.species.tameFood, 1)) {
        hud.toast(`Need ${ITEMS[ko.species.tameFood].name}s to tame`)
        return false
      }
      const tamed = ko.feed()
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
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyT') daynight.setTime(daynight.time + 1 / 24)
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
  const collectSave = (): SaveFile => ({
    version: SAVE_VERSION,
    savedAt: Date.now(),
    time: daynight.time,
    player: { x: player.mover.position.x, y: player.mover.position.y, z: player.mover.position.z, hp: playerHp },
    inventory: inventory.serialize(),
    pieces: building.serialize(),
    deadNodes: scatter.serialize(),
    dinos: dinos.map((d) => d.serialize()),
  })
  setInterval(() => void saveGame(collectSave()), 30_000)
  addEventListener('pagehide', () => void saveGame(collectSave()))

  addEventListener('resize', () => {
    cam.camera.aspect = innerWidth / innerHeight
    cam.camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
  })

  // --- debug/E2E API: the gate drives the same verbs the input layer calls ---
  let debugIntent: { vx: number; vz: number } | null = null
  const dbg = {
    setTime: (t: number) => daynight.setTime(t),
    teleport: (x: number, z: number) => { player.mover.teleport(x, heightAt(x, z) + 1.2, z); cam.snap() },
    setCam: (yaw: number, pitch: number) => { cam.yaw = yaw; cam.pitch = pitch },
    setIntent: (vx: number, vz: number) => { debugIntent = vx || vz ? { vx, vz } : null },
    player: () => ({ ...(riding?.mover ? riding.mover.position : player.mover.position) }),
    groundAt: (x: number, z: number) => heightAt(x, z),
    fps: () => hud.fps,
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
          if (d < bd) { bd = d; best = n }
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
      gotoDino: (state: string) => {
        const d = nearestDino(Infinity, (x) => x.state === state)
        if (!d) return false
        const px = d.object.position.x
        const pz = d.object.position.z + 2.2
        player.mover.teleport(px, heightAt(px, pz) + 1.2, pz)
        cam.yaw = 0
        cam.snap()
        return true
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

  // --- main loop ---
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
    dt = Math.min(dt, 0.1)
    swingT -= dt
    camKick = Math.max(0, camKick - dt * 0.3)
    if (playerHp < 100) playerHp = Math.min(100, playerHp + dt * 1.5)

    const focus = riding?.mover ? riding.mover.position : player.mover.position

    accumulator += dt
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
    const alpha = accumulator / FIXED_DT

    player.render(alpha, dt) // runs while riding too (seat pose + mixer)
    player.setHeldItem(inventory.held)
    const pFeet = feetPos()
    for (const d of dinos) d.update(dt, pFeet, hurtPlayer)
    // pack aggro: a wild raptor entering aggro pulls packmates in range
    for (const d of dinos) {
      if (d.state !== 'aggro' || !d.object.visible) continue
      for (const o of dinos) {
        if (o === d || o.state === 'tamed' || o.state === 'ko' || !o.object.visible) continue
        if (o.species.id === d.species.id && o.object.position.distanceTo(d.object.position) < d.species.packRange) {
          o.joinPack()
        }
      }
    }
    // dino-dino separation + player-dino body push (soft, gameplay-level)
    for (let i = 0; i < dinos.length; i++) {
      const a = dinos[i]
      if (!a.object.visible || a === riding) continue
      for (let j = i + 1; j < dinos.length; j++) {
        const b = dinos[j]
        if (!b.object.visible || b === riding) continue
        const dx = b.object.position.x - a.object.position.x
        const dz = b.object.position.z - a.object.position.z
        const d2 = Math.hypot(dx, dz)
        const min = 1.6
        if (d2 > 0.01 && d2 < min) {
          const push = ((min - d2) / d2) * 0.5
          a.object.position.x -= dx * push
          a.object.position.z -= dz * push
          b.object.position.x += dx * push
          b.object.position.z += dz * push
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
    scatter.ensureCollidersAround(focus.x, focus.z, physics)
    scatter.updateVisibility(focus.x, focus.z)
    water.update(dt)
    daynight.setFocus(focus.x, focus.z)
    daynight.advance(dt)
    terrain.update(focus.x, focus.z)

    // camera follows whoever is being driven
    const camTargetFeet = pFeet.clone()
    cam.update(input, camTargetFeet, dt)
    cam.camera.position.y += camKick
    if (riding) cam.camera.position.addScaledVector(cam.camera.getWorldDirection(new THREE.Vector3()), -2.2)

    // ghost preview when holding a placeable
    const held = inventory.held
    building.updateGhost(held && ITEMS[held].placeable ? (held as PieceKind) : null, held && ITEMS[held].placeable ? updateAim() : null)

    // context prompt
    if (riding) hud.prompt('E — dismount')
    else {
      const ko = nearestDino(INTERACT_RANGE, (d) => d.state === 'ko')
      const tame = nearestDino(INTERACT_RANGE, (d) => d.state === 'tamed')
      if (ko) hud.prompt(`E — feed ${ITEMS[ko.species.tameFood].icon} (${Math.min(100, Math.round(ko.tameProgress))}%)`)
      else if (tame && !tame.saddled) hud.prompt(inventory.count('saddle') > 0 ? 'E — saddle' : 'tamed — craft a saddle to ride')
      else if (tame) hud.prompt('E — ride')
      else hud.prompt(null)
    }

    hud.tick(dt, focus.x, focus.y, focus.z, daynight.time, playerHp)
    renderer.render(scene, cam.camera)
    dbg.ready = true
  }
  requestAnimationFrame(frame)

  // periodic node respawns
  setInterval(() => scatter.tickRespawns(physics), 1000)
}

void boot()

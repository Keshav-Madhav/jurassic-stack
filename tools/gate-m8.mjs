// M8 opener gate: keystones exist at the five pre-caldera ruin sites, collect
// works, persists through save/reload, and the wayfinder targets sanely.
import { chromium } from 'playwright-core'
import { wipeAndReload } from './_page.mjs'
const url = process.argv[2] ?? 'http://localhost:4173'
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => { console.error('page error:', e.message); failed = true })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await wipeAndReload(page)
await page.waitForTimeout(1500)
const g = (expr) => page.evaluate(expr)

const sites = await g('window.__g.game.keystoneSites()')
// 13 since M51: twelve on the ruins and one at the back of a cave
check(sites.length === 13, `13 keystone sites (${sites.map((s) => s.tag).join(', ')})`)
check(sites.filter((s) => s.tag.startsWith('cave-')).length === 1, 'one of them is in a cave')
check((await g('window.__g.game.keystoneCount()')) === 0, 'none collected on fresh save')

// collect the beach one
const beach = sites.find((s) => s.tag === 'beach-statue')
await page.evaluate((b) => window.__g.teleport(b.x, b.z + 2), beach)
await page.waitForTimeout(400)
await g('window.__g.game.interact()')
await page.waitForTimeout(200)
check((await g('window.__g.game.keystoneCount()')) === 1, 'collected the beach keystone')
await g('window.__g.game.interact()')
check((await g('window.__g.game.keystoneCount()')) === 1, 'no double-collect')

// persists
await g('window.__g.game.save()')
await page.waitForTimeout(200)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(800)
check((await g('window.__g.game.keystoneCount()')) === 1, 'keystone survived reload')
const after = await g('window.__g.game.keystoneSites()')
check(after.find((s) => s.tag === 'beach-statue').collected === true, 'correct site marked collected')

// --- the caldera door ---
check(!(await g('window.__g.game.doorOpen()')), 'door sealed initially')
// stand 7 m south of the caldera-gate slab, wherever the bake put it
await page.evaluate(() => {
  const gt = window.__g.game.gateSite()
  window.__g.teleport(gt.x, (gt.doorZ ?? gt.z - 19) + 7)
})
await page.waitForTimeout(400)
await g('window.__g.game.interact()')
check(!(await g('window.__g.game.doorOpen()')), 'door refuses with missing keystones')
await g('window.__g.game.grantAllKeystones()')
check((await g('window.__g.game.keystoneCount()')) === 13, 'all keystones granted (debug)')
await g('window.__g.game.interact()')
await page.waitForTimeout(300)
check(await g('window.__g.game.doorOpen()'), 'door opens with all five')
await g('window.__g.game.save()')
await page.waitForTimeout(200)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(800)
check(await g('window.__g.game.doorOpen()'), 'open door survives reload')

// --- M19: the door cannot be walked round, the cone cannot be climbed ---
// (user screenshot 23: the arch stood out on the apron and the slot ran on
// beside it). From either side of the mouth, push north for 12 s: the player
// must not get past the slab's line
for (const dx of [-16, 16]) {
  await page.evaluate(([dx]) => { const gt = window.__g.game.gateSite(); window.__g.teleport(gt.x + dx, gt.doorZ + 14); window.__g.setIntent(0, -9) }, [dx])
  await page.waitForTimeout(12000)
  const p = await page.evaluate(() => { window.__g.setIntent(0, 0); return window.__g.player() })
  const gt = await g('window.__g.game.gateSite()')
  check(p.z > gt.doorZ - 2, `pushing north beside the door (x${dx > 0 ? '+' : ''}${dx}) stays outside: z=${p.z.toFixed(0)} vs door ${gt.doorZ}`)
}
// the cone: sprint west at the mountain from its east foot for 25 s — the
// escarpment must hold the player under 200 m
for (const [label, sx, sz] of [['east', 620, -1250], ['west', -620, -1250], ['north', 0, -1850], ['south-west', -440, -810]]) {
  await page.evaluate(([sx, sz]) => { window.__g.game.setCreative(false); window.__g.game.setFlying(false); window.__g.teleport(sx, sz); const d = Math.hypot(sx, sz + 1250); window.__g.setIntent(-9 * sx / d, -9 * (sz + 1250) / d) }, [sx, sz])
  await page.waitForTimeout(22000)
  const climber = await page.evaluate(() => { window.__g.setIntent(0, 0); return window.__g.player() })
  check(climber.y < 200, `the cone cannot be climbed from the ${label}: reached y=${climber.y.toFixed(0)} at (${climber.x.toFixed(0)},${climber.z.toFixed(0)})`)
}

// --- M17: the Ravine and the Beacon ---
// the ravine floor is real ground the whole way up: ground height climbs
// monotonically (±1 m ripple) from the door to the bench, never a cliff step
const climb = await page.evaluate(() => {
  const g = window.__g
  const path = g.game.ravinePath()
  const out = []
  for (let i = 0; i < path.length - 1; i++) for (let t = 0; t < 1; t += 0.1) out.push(g.groundAt(path[i].x + (path[i + 1].x - path[i].x) * t, path[i].z + (path[i + 1].z - path[i].z) * t))
  let worstDrop = 0, worstStep = 0
  for (let i = 1; i < out.length; i++) { worstDrop = Math.max(worstDrop, out[i - 1] - out[i]); worstStep = Math.max(worstStep, out[i] - out[i - 1]) }
  return { start: out[0], end: out[out.length - 1], worstDrop, worstStep, n: out.length }
})
check(climb.end - climb.start > 90 && climb.worstDrop < 1.5 && climb.worstStep < 6, `ravine climbs ${climb.start.toFixed(0)}→${climb.end.toFixed(0)} m, worst drop ${climb.worstDrop.toFixed(2)}, worst step ${climb.worstStep.toFixed(2)} (per ~5 m)`)
check(!(await g('window.__g.game.beaconLit()')), 'beacon cold with the door just opened')
// a fresh save: the beacon must refuse without the keystones
await wipeAndReload(page)
await page.waitForTimeout(800)
await page.evaluate(() => { const b = window.__g.game.beaconSite(); window.__g.teleport(b.x, b.z + 9) })
await page.waitForTimeout(400)
await g('window.__g.game.interact()')
check(!(await g('window.__g.game.beaconLit()')), 'beacon refuses without keystones')
await g('window.__g.game.grantAllKeystones()')
await g('window.__g.game.interact()')
await page.waitForTimeout(300)
check(await g('window.__g.game.beaconLit()'), 'beacon lights with all five')
await page.waitForTimeout(3200)
check(await page.evaluate(() => { const el = document.getElementById('hud-credits'); return el && !el.hidden && el.classList.contains('show') && el.textContent.includes('beacon is lit') }), 'credits card shows after the lighting')
await page.waitForTimeout(1800) // the card arms its dismiss after the fade-in
await page.keyboard.press('KeyF')
await page.waitForTimeout(1200)
check(await page.evaluate(() => document.getElementById('hud-credits').hidden), 'credits card dismisses on a key')
await g('window.__g.game.save()')
await page.waitForTimeout(200)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(800)
check(await g('window.__g.game.beaconLit()'), 'lit beacon survives reload')

// --- M51: the caves (PLAN beat 4) ---
{
  const defs = await page.evaluate(() => window.__g.game.caveDefs())
  check(defs.length === 3, `three caves are carved (${defs.map((d) => d.name).join(', ')})`)
  const d0 = defs[0]
  const yaw = Math.atan2(-d0.into.x, -d0.into.z)
  const go = async (along) => {
    await page.evaluate(([mx, mz, ix, iz, a, y]) => {
      const g = window.__g
      g.setTime(0.5); g.game.setGod(true)
      g.teleport(mx + ix * a, mz + iz * a); g.setCam(y, 0.03)
    }, [d0.mouth.x, d0.mouth.z, d0.into.x, d0.into.z, along, yaw])
    await page.waitForTimeout(2500)
    return page.evaluate(() => ({ inCave: window.__g.game.inCave(), y: window.__g.player().y, dark: window.__g.game.caveDark() }))
  }
  const out = await go(-40)
  check(out.inCave === null, 'outside the mouth you are not in a cave')
  check(out.dark < 0.1, `and the world is lit (interior ${out.dark.toFixed(2)})`)
  const inn = await go(46)
  check(inn.inCave === d0.name, `walking in puts you inside (${inn.inCave})`)
  check(inn.y < out.y - 4, `and below the ground you came from (${inn.y.toFixed(1)} vs ${out.y.toFixed(1)} m)`)
  check(inn.dark > 0.85, `the cave is DARK (interior ${inn.dark.toFixed(2)})`)
  // nothing grows under a roof
  const flora = await page.evaluate(([x, z]) => window.__g.game.nodesNear(x, z, 18), [d0.mouth.x + d0.into.x * d0.reach, d0.mouth.z + d0.into.z * d0.reach])
  check(Object.keys(flora).length === 0, `nothing grows in the chamber (${JSON.stringify(flora)})`)
  // and one cave keeps a keystone
  const ks = await page.evaluate(() => window.__g.game.keystoneSites())
  check(ks.some((k) => k.tag.startsWith('cave-')), `a cave holds a keystone (${ks.filter((k) => k.tag.startsWith('cave-')).map((k) => k.tag).join()})`)
}

// GRASS THAT KNOWS WHAT IT IS GROWING IN (M56). The dunes used to grow the
// same lush meadow blade as the spawn valley — the loudest thing wrong in the
// walk shots. Read the tint the field actually wrote to the GPU rather than
// judging a screenshot: `instanceColor` multiplies a green card texture, so a
// dry tuft is one whose red and blue are lifted well clear of its green.
const tuftTint = async (x, z) => {
  await page.evaluate(([px, pz]) => { window.__g.game.setGod(true); window.__g.teleport(px, pz) }, [x, z])
  await page.waitForTimeout(5000)
  return page.evaluate(([px, pz]) => {
    const grass = window.__g.scene.getObjectByName('grass')
    if (!grass) return null
    let n = 0, r = 0, g = 0, b = 0
    grass.traverse((o) => {
      if (!o.isInstancedMesh || !o.instanceColor || !o.visible) return
      const c = o.instanceColor.array, m = o.instanceMatrix.array
      for (let i = 0; i < o.count; i++) {
        if (Math.hypot(m[i * 16 + 12] - px, m[i * 16 + 14] - pz) > 40) continue
        r += c[i * 3]; g += c[i * 3 + 1]; b += c[i * 3 + 2]; n++
      }
    })
    return n ? { n, r: r / n, g: g / n, b: b / n } : null
  }, [x, z])
}
const dune = await tuftTint(-900, 1250)
const meadow = await tuftTint(-250, 1040)
check(!!dune && dune.n > 50, `the dunes grow some grass at all (${dune?.n ?? 0} tufts)`)
check(!!meadow && meadow.n > 500, `the plain grows a lot of it (${meadow?.n ?? 0} tufts)`)
if (dune && meadow) {
  check(dune.r / dune.g > 2, `a dune tuft is straw, not meadow (red/green ${(dune.r / dune.g).toFixed(2)})`)
  check(dune.b / dune.g > 1.2, `and desaturated, not acid (blue/green ${(dune.b / dune.g).toFixed(2)})`)
  check(meadow.r / meadow.g < 1.2 && meadow.b / meadow.g < 1, `the plain is still green (red/green ${(meadow.r / meadow.g).toFixed(2)}, blue/green ${(meadow.b / meadow.g).toFixed(2)})`)
}

// THE TERRAIN LOD CACHE GIVES ITS MEMORY BACK (M62). Every (chunk, LOD) pair
// used to be cached for the life of the session — 1024 chunks × a quarter of a
// megabyte at LOD0 — so touring the island grew the heap without bound. Fine
// LODs are freed after two minutes unused now. The gate runs with a short TTL
// so it does not have to wait, and checks the two things that matter: the
// geometry count comes back DOWN, and the sweep is not thrashing the builder.
{
  await page.evaluate(() => { window.__g.game.setGod(true); window.__g.game.setTerrainCacheTtl(8000) })
  let peak = 0
  for (const [x, z] of [[0, 1560], [-286, 793], [700, 900], [300, -560], [-700, -400]]) {
    await page.evaluate(([px, pz]) => window.__g.teleport(px, pz), [x, z])
    await page.waitForTimeout(6000)
    peak = Math.max(peak, await page.evaluate(() => window.__g.renderer.info.memory.geometries))
  }
  await page.waitForTimeout(14000) // sit still: everything left behind goes stale
  const after = await page.evaluate(() => window.__g.renderer.info.memory.geometries)
  const t = await page.evaluate(() => window.__g.mem().terrainEvicted)
  check(t.count > 0, `the terrain cache frees what it is done with (${t.count} chunk LODs, ${t.mb} MB)`)
  // NB the gate runs with an 8 s TTL so it need not wait two minutes, which
  // means the sweep is already freeing THROUGHOUT the tour — the live count
  // never climbs to what it would reach unevicted, so the thing to assert is
  // that a real share of it has been handed back and that it is not still
  // growing once you stand still.
  check(t.count > after * 0.2, `and a real share of the live count has been handed back (${t.count} freed vs ${after} live)`)
  check(after <= peak, `and it is not still growing while you stand still (peak ${peak} → ${after})`)
  // an eviction scheme that immediately rebuilds what it freed is worse than
  // none: the first cut evicted by DISTANCE and rebuilt 40% of it (M62)
  check(t.rebuilt < Math.max(20, t.count * 0.25), `without thrashing the builder (${t.rebuilt} rebuilt of ${t.count})`)
}

// THE WET GROUND (M65, user-reported: "not enough rocks pebbles ... on land or
// even underwater"). A global `h < SEA_LEVEL + 1.1` floor in scatter's place()
// excluded EVERY kind from the tideline and the whole seabed, so the spawn
// beach — the first thing a player ever sees — was a featureless orange plane
// and the sea floor was bare brown.
{
  const nodesAt = async (x, z) => {
    await page.evaluate(([px, pz]) => { window.__g.game.setGod(true); window.__g.teleport(px, pz) }, [x, z])
    await page.waitForTimeout(4000)
    return page.evaluate(([px, pz]) => ({ h: +window.__g.groundAt(px, pz).toFixed(1), n: window.__g.game.nodesNear(px, pz, 40) }), [x, z])
  }
  const beach = await nodesAt(0, 1640)
  const shingle = (beach.n.shellbed ?? 0) + (beach.n.shorestone ?? 0)
  check(beach.h < 2.4, `the spawn beach is the wet band (${beach.h} m)`)
  check(shingle > 40, `and it has shingle on it (${shingle} pieces within 40 m)`)
  const sea = await nodesAt(0, 1720)
  check(sea.h < 0, `the sea floor is below the water (${sea.h} m)`)
  check((sea.n.seastone ?? 0) > 20, `the sea floor has shingle (${sea.n.seastone ?? 0})`)
  check((sea.n.kelp ?? 0) > 10, `and kelp growing on it (${sea.n.kelp ?? 0})`)
  // ...and none of it strays onto dry land, which would put kelp in a meadow
  const plain = await nodesAt(-250, 1040)
  const strays = (plain.n.kelp ?? 0) + (plain.n.seastone ?? 0)
  check(strays === 0, `and none of it grows inland (${strays} at the plain, ${plain.h} m)`)
}

// THE WAYFINDER POINTS THE RIGHT WAY (M68). It read `atan2(-dx, -dz)`, which
// measures the bearing ANTICLOCKWISE from north — east and west came out
// swapped, and it had been sending players the wrong way since it was written.
// A compass that is confidently wrong is worse than no compass. This checks
// the very function the Wayfinder points with, so it cannot drift from it.
{
  const c = (fx, fz, tx, tz) => page.evaluate(([a, b2, d, e]) => window.__g.game.compass(a, b2, d, e), [fx, fz, tx, tz])
  // north is -z, east is +x
  check((await c(0, 0, 100, 0)) === 'E', `+x is EAST (got ${await c(0, 0, 100, 0)})`)
  check((await c(0, 0, -100, 0)) === 'W', `-x is WEST (got ${await c(0, 0, -100, 0)})`)
  check((await c(0, 0, 0, -100)) === 'N', `-z is NORTH (got ${await c(0, 0, 0, -100)})`)
  check((await c(0, 0, 0, 100)) === 'S', `+z is SOUTH (got ${await c(0, 0, 0, 100)})`)
  check((await c(0, 0, 100, -100)) === 'NE', `+x -z is NE (got ${await c(0, 0, 100, -100)})`)
  check((await c(0, 0, -100, 100)) === 'SW', `-x +z is SW (got ${await c(0, 0, -100, 100)})`)
  // and the real toast agrees with it end to end. NB the Wayfinder is a
  // carried relic since M71, so this has to be holding one — pressing N
  // empty-handed correctly refuses now.
  await page.evaluate(() => { window.__g.game.setGod(true); window.__g.game.give('wayfinder', 1); window.__g.teleport(-120, 1500) })
  await page.waitForTimeout(1500)
  await page.keyboard.press('KeyN')
  await page.waitForTimeout(350)
  const said = await page.evaluate(() => document.getElementById('hud-toast')?.textContent ?? '')
  check(/Wayfinder: .+ (N|NE|E|SE|S|SW|W|NW) · \d+m/.test(said), `the Wayfinder still reads out a bearing ("${said}")`)
}

// THE WAYFINDER IS AN ITEM YOU CAN PUT DOWN (M71). PLAN has always described
// it as a relic — "carry it = guided playthrough; leave it in a chest = pure
// sandbox" — and it was the N key and a toast since M20: always on, impossible
// to put down, and therefore not a choice at all. These checks are that
// sentence, in order.
{
  await wipeAndReload(page)
  await page.waitForTimeout(3000)
  const hudLine = () => page.evaluate(() => {
    const el = document.getElementById('hud-wayfinder')
    return el && !el.hidden ? el.textContent : null
  })
  const toast = () => page.evaluate(() => document.getElementById('hud-toast')?.textContent ?? '')

  // a fresh island: the relic is on the beach and you are not carrying it.
  // ...and PROVE the island is fresh first (M73). This block used to inherit
  // the previous one's `give('wayfinder', 1)` whenever the reload had not
  // landed yet, and then reported it as five separate Wayfinder failures —
  // "no bearing on the HUD", "N guides you nowhere", "pressing E takes it"
  // — none of which was about the Wayfinder at all.
  check((await page.evaluate(() => window.__g.game.count('wayfinder'))) === 0,
    'the island really is wiped: an empty pack before any of this')
  const relic = await page.evaluate(() => window.__g.game.wayfinder())
  check(relic.taken === false, 'a fresh island has the Wayfinder still lying where it washed up')
  const spawn = await page.evaluate(() => window.__g.game.spawn())
  const away = Math.hypot(relic.x - spawn.x, relic.z - spawn.z)
  check(away > 20 && away < 140, `it is a short walk from where you wake, not underfoot (${Math.round(away)} m)`)
  check((await hudLine()) === null, 'and no bearing on the HUD until you hold it')
  await page.keyboard.press('KeyN')
  await page.waitForTimeout(400)
  check((await toast()).includes('no Wayfinder'), 'N without the relic guides you nowhere')

  // pick it up
  await page.evaluate(() => { const g = window.__g; g.game.setGod(true); const w = g.game.wayfinder(); g.teleport(w.x, w.z + 1.5) })
  await page.waitForTimeout(2000)
  await page.evaluate(() => window.__g.game.interact())
  await page.waitForTimeout(900)
  check((await page.evaluate(() => window.__g.game.count('wayfinder'))) === 1, 'walking up to it and pressing E takes it')
  check((await page.evaluate(() => window.__g.game.wayfinder().taken)) === true, 'and it is gone from the sand')
  await page.waitForTimeout(700)
  const carried = await hudLine()
  check(!!carried && /🧭\s+(N|NE|E|SE|S|SW|W|NW)\s+\d+m/.test(carried), `carrying it puts a live bearing on the HUD ("${carried}")`)

  // ...and the HUD and the key cannot disagree, because they read one function
  await page.keyboard.press('KeyN')
  await page.waitForTimeout(400)
  const said = await toast()
  const t = await page.evaluate(() => window.__g.game.wayfinderTarget())
  check(said.includes(t.dir) && said.includes(String(t.d)), `the key agrees with the HUD (${t.dir} ${t.d}m)`)

  // STOW IT — the sandbox switch, and the whole point of making it an item
  await page.evaluate(() => window.__g.game.take('wayfinder', 1))
  await page.waitForTimeout(900)
  check((await hudLine()) === null, 'stowing it in a chest takes the bearing off the HUD')
  await page.keyboard.press('KeyN')
  await page.waitForTimeout(400)
  check((await toast()).includes('not carrying'), 'and N goes quiet — the island stops telling you where to go')
}

// THE INTERIORS (M73). PLAN's last content line is "waterfalls + swamp/pine
// interiors", and the flora has been placed since M10f — so what these check
// is not "is anything there" but "does being in there feel like anywhere".
// Both failures they guard were measured, not imagined: the pine floor was
// the Southwood's floor exactly, and standing in the middle of the marsh you
// could see 1500 m to the far hills.
{
  const at = async (x, z, wait = 2200) => {
    await page.evaluate(([xx, zz]) => {
      const g = window.__g
      g.setTime(0.5); g.game.setGod(true); g.teleport(xx, zz)
      g.setFreeCam(xx, g.groundAt(xx, zz) + 1.7, zz, 0.4, 0.02)
    }, [x, z])
    await page.waitForTimeout(wait)
    return page.evaluate(() => window.__g.game.air())
  }
  // the plains: open country, the view runs to the horizon
  const plains = await at(-250, 1040)
  check(plains.humid === 0 && plains.fogFar > 1200, `on the plains the view is open (fog far ${plains.fogFar} m)`)
  // the marsh: close, and the air takes a colour
  const marsh = await at(760, 700, 7000)
  check(marsh.humid > 0.9, `the swamp closes in around you (humid ${marsh.humid})`)
  check(marsh.fogFar < 400, `and you cannot see the far hills any more (fog far ${marsh.fogFar} m, was ${plains.fogFar})`)
  check(marsh.fog !== plains.fog, `the air itself takes the marsh's colour (#${plains.fog} → #${marsh.fog})`)
  // ...and it LIFTS on the way out rather than sticking (the cave/underwater bug shape)
  const out = await at(-250, 1040, 7000)
  check(out.humid < 0.05 && out.fogFar > 1200, `and walking out of it gives the view back (fog far ${out.fogFar} m)`)

  // THE PINE FLOOR IS NOT A BROADLEAF FLOOR. Sampled through the same
  // function the terrain mesh is painted with, so this is the ground the
  // player actually sees, not a parallel guess.
  const floor = await page.evaluate(() => {
    const g = window.__g
    // UNDER THE CANOPY ONLY. The first cut averaged a 120 m box and got
    // 0.031 vs 0.032 — a check that passes by a hair is not a check. Half
    // that box is glade, edge and open ground, where both woods correctly
    // paint the same lawn; the claim is about the ground under closed trees,
    // so that is what gets sampled.
    const mean = (x, z, r = 90) => {
      let R = 0, G = 0, B = 0, n = 0
      for (let dz = -r; dz <= r; dz += 10) for (let dx = -r; dx <= r; dx += 10) {
        if (g.game.forestAt(x + dx, z + dz).mask < 0.3) continue
        const c = g.game.groundColorAt(x + dx, z + dz)
        R += c[0]; G += c[1]; B += c[2]; n++
      }
      return n ? [R / n, G / n, B / n, n] : null
    }
    return { pine: mean(385, -652), leaf: mean(50, 1193) }
  })
  const green = (c) => c[1] - (c[0] + c[2]) / 2
  check(floor.pine && floor.leaf && floor.pine[3] > 40 && floor.leaf[3] > 40,
    `both woods have closed canopy to sample (${floor.pine?.[3]} pine cells, ${floor.leaf?.[3]} leaf)`)
  check(green(floor.pine) < green(floor.leaf) * 0.72,
    `the pine floor is needles, not lawn (greenness ${green(floor.pine).toFixed(3)} vs the Southwood's ${green(floor.leaf).toFixed(3)})`)
  check(floor.pine[0] > floor.pine[2], 'and it is rust-brown — more red in it than blue')
}

await browser.close()
console.log(failed ? '\nGATE FAILED' : '\nGATE PASSED')
process.exit(failed ? 1 : 0)

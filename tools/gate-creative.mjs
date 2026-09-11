// Creative-mode gate: resources granted, god mode, flight up/steer/land,
// one-hit harvest, instant-KO + instant-tame, survival untouched after toggle-off.
//   node tools/gate-creative.mjs [url]
import { chromium } from 'playwright-core'
import { wipeAndReload } from './_page.mjs'
const url = process.argv[2] ?? 'http://localhost:4173'
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => { console.error('page error:', e.message); failed = true })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await wipeAndReload(page)
await page.waitForTimeout(1500)
const g = (expr) => page.evaluate(expr)

await g('window.__g.game.setCreative(true)')
check((await g('window.__g.game.count("wood")')) === 999, `creative kit granted (wood=${await g('window.__g.game.count("wood")')})`)

// flight: rise, hold, land
const y0 = (await g('window.__g.player()')).y
await g('window.__g.game.setFlying(true)')
await page.keyboard.down('Space')
await page.waitForTimeout(1500)
await page.keyboard.up('Space')
const y1 = (await g('window.__g.player()')).y
check(y1 > y0 + 5, `flew up ${(y1 - y0).toFixed(1)}m`)
check(await g('window.__g.game.flying()'), 'still flying at altitude')
await g('window.__g.setIntent(0, -12)') // steer while airborne
await page.waitForTimeout(1500)
await g('window.__g.setIntent(0, 0)')
const p2 = await g('window.__g.player()')
const spawnZ = (await g('window.__g.game.spawn()')).z
check(Math.abs(p2.z - spawnZ) > 8, `steered in flight (z=${p2.z.toFixed(0)})`)
await page.keyboard.down('ShiftLeft')
await page.waitForTimeout(3500)
await page.keyboard.up('ShiftLeft')
check(!(await g('window.__g.game.flying()')), 'auto-landed on ground contact')

// one-hit harvest (select an EMPTY slot first: the creative kit auto-slots
// placeables into slot 0, and swinging a placeable places instead of harvesting)
await g('window.__g.game.select(8)')
await g('window.__g.teleport(-700, 1000)') // the desert: far from all dino spawns (swing prioritizes dinos)
await page.waitForTimeout(400)
await g('window.__g.game.gotoNearest("tree")')
await page.waitForTimeout(900) // camera snap needs a rendered frame before the aim ray is valid
// ASSERT THE AIM BEFORE THE SWING. This read "one-hit tree harvest" failed
// whenever the walk-up left the trunk off the crosshair, which says nothing
// about whether a creative swing fells a tree — the M69 lesson, that a bot
// which cannot aim looks exactly like a game that cannot harvest.
// ...and if a bush is in the way (the desert grew undergrowth when the
// woods were re-traced in M79), sweep the look until the TRUNK is what the
// crosshair is on, the way a person does — `aimNode` is exactly the
// instrument M69 added for this.
let aimed = await g('window.__g.game.aimNode()')
if (!aimed || aimed.kind !== 'tree') {
  const t = await g('window.__g.game.nearestNodeInfo("tree")')
  for (let pitch = -0.9; pitch <= 0.3 && (!aimed || aimed.kind !== 'tree'); pitch += 0.06) {
    await page.evaluate(([tx, tz, pi]) => {
      const w = window.__g, p = w.player()
      w.setCam(Math.atan2(-(tx - p.x), -(tz - p.z)), pi)
    }, [t.x, t.z, pitch])
    await page.waitForTimeout(90)
    aimed = await g('window.__g.game.aimNode()')
  }
}
check(!!aimed && aimed.kind === 'tree', `a tree is under the crosshair (${aimed ? aimed.kind : 'nothing'})`)
const w0 = await g('window.__g.game.count("wood")')
await g('window.__g.game.swing()')
await page.waitForTimeout(400)
check((await g('window.__g.game.count("wood")')) > w0, 'one-hit tree harvest')

// instant KO + instant tame.
// SPAWN THE ANIMAL, do not take whatever is nearest. This walked up to the
// closest idle dino in the desert and then assumed it could be RIDDEN — and
// `sauropelta.rideable` is false, correctly, so the moment M75's reshaped
// ground changed which animal was nearest the mount check started failing
// on a game that was behaving perfectly. The gate now picks a rideable
// species on purpose and says so.
const mount = await page.evaluate(() => {
  const gg = window.__g, p = gg.player()
  return gg.game.spawnDino('raptor', p.x + 4, p.z - 3)
})
await page.waitForTimeout(600)
check(
  (await page.evaluate((i) => window.__g.game.dinoStates()[i]?.rideable, mount)) === true,
  'the animal chosen for the ride test is a rideable species',
)
await page.evaluate((i) => window.__g.game.gotoDinoIndex(i), mount)
await page.waitForTimeout(300)
await g('window.__g.game.swing()')
await page.waitForTimeout(300)
check((await page.evaluate((i) => window.__g.game.dinoStates()[i].state, mount)) === 'ko', 'creative punch = instant KO')
await page.evaluate((i) => window.__g.game.gotoDinoIndex(i), mount)
await g('window.__g.game.interact()')
await page.waitForTimeout(300)
check((await page.evaluate((i) => window.__g.game.dinoStates()[i].state, mount)) === 'tamed', 'creative feed = instant tame')

// THE REGRESSION THAT SHIPPED: save while MOUNTED, reload, must spawn sane
// (the parked player body at y=-520 used to get saved → eternal falling)
await g('window.__g.game.gotoDino("tamed")')
await page.waitForTimeout(600)
// E on a tame is SADDLE first, then MOUNT, then DISMOUNT — so the number of
// presses this needs depends on whether the tame came out saddled, and the
// old code waited a flat 300 ms between them to decide. When the machine is
// busy `riding()` has not flipped yet, the guard fires one more press, and
// that press DISMOUNTS: the check then reads false having been mounted a
// moment earlier. Press, then WAIT FOR THE FACT, and only press again if
// the wait genuinely ran out.
let riding = false
for (let attempt = 0; attempt < 4 && !riding; attempt++) {
  // ...and WALK BACK TO IT each time. A tame wanders, so a long poll between
  // presses is its own trap: the first fix here waited 2.5 s for `riding()`
  // to flip after the saddle press, by which time the bird had strolled out
  // of reach and the mount press hit nothing.
  await page.evaluate((i) => window.__g.game.gotoDinoIndex(i), mount)
  await page.waitForTimeout(250)
  await g('window.__g.game.interact()')
  riding = await page
    .waitForFunction('window.__g.game.riding() === true', null, { timeout: 900 })
    .then(() => true)
    .catch(() => false)
}
check(riding, 'mounted for save-while-riding test')
await g('window.__g.game.save()')
await page.waitForTimeout(200)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(800)
const pr = await g('window.__g.player()')
const ground = await page.evaluate((p) => window.__g.groundAt(p.x, p.z), pr)
check(Number.isFinite(pr.y) && pr.y > ground - 2 && pr.y < ground + 30, `reload-after-mounted-save spawns on ground (y=${pr.y.toFixed(1)} vs ground ${ground.toFixed(1)})`)
await page.waitForTimeout(1500)
const pr2 = await g('window.__g.player()')
check(pr2.y > ground - 3, `not falling after reload (y=${pr2.y.toFixed(1)})`)

// back to survival: damage applies again
await g('window.__g.game.setCreative(false)')
check(!(await g('window.__g.game.flying()')), 'flight off when leaving creative')
await browser.close()
console.log(failed ? '\nGATE FAILED' : '\nGATE PASSED')
process.exit(failed ? 1 : 0)

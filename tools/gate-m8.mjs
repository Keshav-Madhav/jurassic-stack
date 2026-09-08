// M8 opener gate: keystones exist at the five pre-caldera ruin sites, collect
// works, persists through save/reload, and the wayfinder targets sanely.
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => { console.error('page error:', e.message); failed = true })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.evaluate(() => window.__g.game.wipeAndReload()).catch(() => {})
await page.waitForTimeout(500)
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
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
await page.evaluate(() => window.__g.game.wipeAndReload()).catch(() => {})
await page.waitForTimeout(1500)
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
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

await browser.close()
console.log(failed ? '\nGATE FAILED' : '\nGATE PASSED')
process.exit(failed ? 1 : 0)

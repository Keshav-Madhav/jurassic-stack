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
check(sites.length === 5, `5 keystone sites (${sites.map((s) => s.tag).join(', ')})`)
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
  window.__g.teleport(gt.x, gt.z + 7)
})
await page.waitForTimeout(400)
await g('window.__g.game.interact()')
check(!(await g('window.__g.game.doorOpen()')), 'door refuses with missing keystones')
await g('window.__g.game.grantAllKeystones()')
check((await g('window.__g.game.keystoneCount()')) === 5, 'all keystones granted (debug)')
await g('window.__g.game.interact()')
await page.waitForTimeout(300)
check(await g('window.__g.game.doorOpen()'), 'door opens with all five')
await g('window.__g.game.save()')
await page.waitForTimeout(200)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(800)
check(await g('window.__g.game.doorOpen()'), 'open door survives reload')

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

await browser.close()
process.exit(failed ? 1 : 0)

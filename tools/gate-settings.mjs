// Gate: the settings panel (M40) actually changes the game and remembers it.
//
// A settings menu that looks right and does nothing is worse than none, and
// three of these knobs touch the frame budget — so each is checked against the
// thing it claims to control, not against its own button state.
//   node tools/gate-settings.mjs [url]
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:4173'
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => { console.error('[err]', e.message.slice(0, 160)); failed = true })
const ready = () => page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.goto(url, { waitUntil: 'networkidle' })
await ready()
const g = (expr) => page.evaluate(expr)
const click = (label) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('#hud-settings .opt')].find((x) => x.textContent === t)
  if (b) b.click()
  return !!b
}, label)

await g('window.__g.game.setGod(true); window.__g.teleport(-286, 793)')
await page.waitForTimeout(2500)
const base = await g('({ pr: window.__g.pixelRatio(), fov: window.__g.cam.fov, calls: window.__g.renderInfo().calls })')

await page.keyboard.press('KeyO')
await page.waitForTimeout(500)
check(await g('!document.getElementById("hud-settings").hidden'), 'O opens the settings')
check(await g('!document.pointerLockElement'), 'and gives the mouse back')

check(await click('70%'), 'render scale 70% is offered')
await page.waitForTimeout(700)
check((await g('window.__g.pixelRatio()')) < base.pr, `render scale applied (${base.pr} → ${await g('window.__g.pixelRatio()')})`)

check(await click('Off'), 'grass off is offered')
await page.waitForTimeout(700)
check((await g('!window.__g.scene.getObjectByName("grass")')) === true, 'the grass field is DETACHED, not just hidden')

check(await click('Near'), 'draw distance near is offered')
await page.waitForTimeout(1500)
const near = await g('window.__g.renderInfo().calls')
check(near < base.calls, `a nearer draw distance draws less (${base.calls} → ${near} calls)`)

await page.evaluate(() => {
  const i = document.querySelector('#hud-settings input[data-key=fov]')
  i.value = '85'
  i.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForTimeout(400)
check((await g('window.__g.cam.fov')) === 85, `field of view applied (${base.fov}° → ${await g('window.__g.cam.fov')}°)`)

// ...and it is all still true after a reload
await page.reload({ waitUntil: 'networkidle' })
await ready()
await page.waitForTimeout(2000)
const after = await g('({ pr: window.__g.pixelRatio(), fov: window.__g.cam.fov, grass: !!window.__g.scene.getObjectByName("grass") })')
check(after.pr < base.pr && after.fov === 85 && after.grass === false, `remembered across a reload (scale ${after.pr}, fov ${after.fov}, grass ${after.grass})`)

// and the panel can put it all back
await page.keyboard.press('KeyO')
await page.waitForTimeout(400)
await click('Auto'); await click('On'); await click('Normal')
await page.waitForTimeout(900)
check((await g('!!window.__g.scene.getObjectByName("grass")')) === true, 'grass comes back on')

await browser.close()
console.log(failed ? '\nGATE FAILED' : '\nGATE PASSED')
process.exit(failed ? 1 : 0)

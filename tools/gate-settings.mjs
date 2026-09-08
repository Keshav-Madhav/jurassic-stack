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
const g = (expr) => page.evaluate(expr)
await page.goto(url, { waitUntil: 'domcontentloaded' })

// THE BOOT GATE (M53). The settings panel sits at z-index 12 and the boot card
// at 20, so a hotkey pressed while "waking the animals…" was still up opened
// the panel BEHIND the card: the player saw nothing happen, pressed the key
// again to close it, and reported that settings was broken. Nothing may
// respond until the world is up.
await page.waitForFunction('!!document.getElementById("hud-settings")', null, { timeout: 60000 })
if (await g('!!document.getElementById("boot")')) {
  await page.keyboard.press('KeyO')
  await page.waitForTimeout(300)
  check(await g('document.getElementById("hud-settings").hidden'), 'O during the boot card does nothing')
} else {
  console.log('SKIP the boot card was already gone — no boot-gate check this run')
}
await ready()
await page.waitForTimeout(800)
check(await g('document.getElementById("hud-settings").hidden'), 'and the panel is still shut once the world is up')

// THE GEAR. A one-letter hint on the help line is not a discoverable route to
// the settings; a button is. It only offers itself when there is a cursor to
// click it with — under pointer lock the mouse belongs to the camera.
check(await g('!!document.getElementById("hud-gear")'), 'a settings gear is on the HUD')
check(await g('getComputedStyle(document.getElementById("hud-gear")).opacity === "1"'), 'the gear is visible while the cursor is free')
await page.click('#hud-gear')
await page.waitForTimeout(400)
check(await g('!document.getElementById("hud-settings").hidden'), 'clicking the gear opens the settings')
await page.click('#hud-settings .close')
await page.waitForTimeout(500)
check(await g('!!document.pointerLockElement'), 'closing it puts the mouse back on the camera')
check(await g('getComputedStyle(document.getElementById("hud-gear")).opacity === "0"'), 'and the gear stands down while the mouse is captured')
await page.evaluate(() => document.exitPointerLock())
await page.waitForTimeout(300)
// row-aware: "Off" belongs to both Effects and Grass, and clicking the first
// match turned the grass check into an effects check (M42)
const click = (row, label) => page.evaluate(([r, t]) => {
  const rows = [...document.querySelectorAll('#hud-settings .row')]
  const el = rows.find((x) => x.querySelector('label')?.textContent?.startsWith(r))
  const b = el ? [...el.querySelectorAll('.opt')].find((x) => x.textContent === t) : null
  if (b) b.click()
  return !!b
}, [row, label])

await g('window.__g.game.setGod(true); window.__g.teleport(-286, 793)')
await page.waitForTimeout(2500)
const base = await g('({ pr: window.__g.pixelRatio(), fov: window.__g.cam.fov, calls: window.__g.renderInfo().calls })')

await page.keyboard.press('KeyO')
await page.waitForTimeout(500)
check(await g('!document.getElementById("hud-settings").hidden'), 'O opens the settings')
check(await g('!document.pointerLockElement'), 'and gives the mouse back')

check(await click('Render scale', '70%'), 'render scale 70% is offered')
await page.waitForTimeout(700)
check((await g('window.__g.pixelRatio()')) < base.pr, `render scale applied (${base.pr} → ${await g('window.__g.pixelRatio()')})`)

check(await click('Grass', 'Off'), 'grass off is offered')
await page.waitForTimeout(700)
check((await g('!window.__g.scene.getObjectByName("grass")')) === true, 'the grass field is DETACHED, not just hidden')

check(await click('Draw distance', 'Near'), 'draw distance near is offered')
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
await click('Render scale', 'Auto'); await click('Grass', 'On'); await click('Draw distance', 'Normal')
await page.waitForTimeout(900)
check((await g('!!window.__g.scene.getObjectByName("grass")')) === true, 'grass comes back on')

// ambient occlusion is opt-in and costs frames: it must be OFF unless asked for
check((await g('window.__g.game.aoOn()')) === false, 'ambient occlusion is off by default')
check(await click('Ambient occlusion', 'On'), 'AO can be turned on')
await page.waitForTimeout(800)
check((await g('window.__g.game.aoOn()')) === true, 'and it takes effect')
check(await click('Ambient occlusion', 'Off'), 'and off again')
await page.waitForTimeout(600)
check((await g('window.__g.game.aoOn()')) === false, 'back off')

// the effects row drives the post stack
check(await click('Effects', 'Off'), 'effects off is offered')
await page.waitForTimeout(600)
check((await g('window.__g.post().enabled')) === false, 'effects off drops the composer entirely')
check(await click('Effects', 'Full'), 'and back to full')
await page.waitForTimeout(600)
check((await g('window.__g.post().enabled')) === true, 'the composer is back')

// THE SLIDER DRAG. `set()` re-rendered the whole panel on every `input` event,
// which replaced the very <input> the mouse was holding: the drag died on the
// first pixel of travel and the knob snapped back, so volume, mouse speed and
// field of view could only be nudged one click of the track at a time (M53).
// Only a REAL DRAG catches this — dispatching `input` by hand, as the fov check
// above does, works fine either way.
const fovBox = await page.locator('#hud-settings input[data-key=fov]').boundingBox()
await page.mouse.move(fovBox.x + fovBox.width * 0.1, fovBox.y + fovBox.height / 2)
await page.mouse.down()
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(fovBox.x + fovBox.width * (0.1 + i * 0.08), fovBox.y + fovBox.height / 2)
  await page.waitForTimeout(25)
}
await page.mouse.up()
await page.waitForTimeout(400)
check((await g('window.__g.cam.fov')) >= 90, `a slider follows a real drag (fov ${await g('window.__g.cam.fov')}°)`)

// and there is a way back out of every knob you have moved
check(await g('!!document.querySelector("#hud-settings .reset")'), 'a changed setting offers a reset')
await page.click('#hud-settings .reset')
await page.waitForTimeout(700)
check((await g('window.__g.cam.fov')) === 55, `reset puts the defaults back (fov ${await g('window.__g.cam.fov')}°)`)
check(await g('!document.querySelector("#hud-settings .reset")'), 'and stops offering itself once nothing is changed')

check(await g('!!window.__g.scene.getObjectByName("grass")'), 'reset brought the grass back too')
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
check(await g('document.getElementById("hud-settings").hidden'), 'Escape closes the panel')
await page.keyboard.press('KeyO')
await page.waitForTimeout(400)

// --- a frozen scene must render an IDENTICAL frame every time, in every
// effects configuration. With AO on, the composer's buffer ping-pong left the
// atmosphere pass reading stale depth on alternate frames — a 59/255 strobe
// that no gate could see and no still screenshot could show (M46).
await page.keyboard.press('KeyO')
await page.waitForTimeout(300)
await page.evaluate(() => { const g = window.__g; g.setTime(0.5); g.game.setGod(true); g.teleport(-286, 793); g.setCam(1.35, 0.02); g.setFrozen(true) })
await page.waitForTimeout(2000)
for (const [label, fn] of [
  ['off', () => window.__g.post().setQuality('off')],
  ['basic', () => { const p = window.__g.post(); p.setAo(false); p.setQuality('basic') }],
  ['full', () => { const p = window.__g.post(); p.setAo(false); p.setQuality('full') }],
  ['full + AO', () => { const p = window.__g.post(); p.setQuality('full'); p.setAo(true) }],
]) {
  await page.evaluate(fn)
  await page.waitForTimeout(1200)
  const a = await page.screenshot()
  await page.waitForTimeout(180)
  const b2 = await page.screenshot()
  check(Buffer.compare(a, b2) === 0, `effects "${label}": a frozen scene renders the same frame twice`)
}
await page.evaluate(() => window.__g.setFrozen(false))

await browser.close()
console.log(failed ? '\nGATE FAILED' : '\nGATE PASSED')
process.exit(failed ? 1 : 0)

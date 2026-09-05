// QA shots for the M17 finale: the Ravine (a slot canyon up the volcano's
// south flank), the crater bench, the Beacon cold and lit, the credits card.
//   node tools/qa-crater.mjs [url] [outPrefix]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const prefix = process.argv[3] ?? 'shots/crater'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(2500)

const shot = async (name, x, y, z, yaw, pitch, t, fog = 1) => {
  await page.evaluate(([xx, yy, zz, ya, pi, tt, fg]) => {
    const g = window.__g
    g.setTime(tt)
    g.setFog?.(fg)
    const camY = yy < 40 ? g.groundAt(xx, zz) + yy : yy
    if (yy < 40) g.teleport(xx, zz)
    g.setFreeCam(xx, camY, zz, ya, pi)
  }, [x, y, z, yaw, pitch, t, fog])
  await page.waitForTimeout(1400)
  await page.screenshot({ path: `${prefix}-${name}.png` })
  console.log(`${prefix}-${name}.png`)
}

// yaw 0 = north (-z), +yaw turns west
await shot('volcano-aerial', 0, 620, -600, 0, -0.55, 0.5, 6) // the cone with the slot and the sunk crater
await shot('ravine-mouth', 0, 1.7, -908, 0, 0.12, 0.45) // inside the door: the slot climbing away
await shot('ravine-switchback', 118, 1.7, -1030, 0.35, 0.1, 0.45) // mid-climb, the walls
await shot('ravine-top', 0, 1.7, -1175, 0, 0.02, 0.45) // stepping onto the bench: the court ahead
await shot('crater-aerial', 0, 330, -1120, 0, -0.55, 0.5, 6) // the bowl from the south rim
await shot('beacon-cold', 0, 1.7, -1222, 0, 0.14, 0.45)

// light it: all keystones granted, stand at the plinth, press E; the credits card follows
await page.evaluate(() => { window.__g.game.grantAllKeystones(); window.__g.clearFreeCam(); window.__g.teleport(0, -1240) })
await page.waitForTimeout(600)
await page.keyboard.press('KeyE')
await page.waitForTimeout(1200)
const lit = await page.evaluate(() => window.__g.game.beaconLit())
console.log('beaconLit after E:', lit)
await shot('beacon-lit-dusk', 0, 1.7, -1224, 0, 0.16, 0.74)
await shot('beacon-lit-night', 14, 1.7, -1232, 0.9, 0.2, 0.02)
await page.evaluate(() => window.__g.clearFreeCam())
await page.waitForTimeout(2400)
await page.screenshot({ path: `${prefix}-credits.png` })
console.log(`${prefix}-credits.png`)
await browser.close()

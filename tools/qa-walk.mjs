// The walk: eye-level shots at a dozen spots a player actually stands in —
// spawn beach, the meadow, a wood interior, the river bank, the ring's ford,
// the plain, the swamp edge, the dunes, the foothills, the pines, the ravine
// mouth, a lake shore — at noon, for the improvement rounds (what looks wrong
// from where the player is, not from the air). node tools/qa-walk.mjs [url] [prefix] [time]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const prefix = process.argv[3] ?? 'shots/walk'
const time = Number(process.argv[4] ?? 0.5)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(6000)
const spots = [
  ['spawn', 0, 1560, 0, 0.02],
  ['meadow', -120, 1300, 0.6, 0.0],
  ['wood-interior', -300, 700, 1.0, 0.02],
  ['river-bank', 700, 900, -0.8, 0.0],
  ['ford', -500, 372, -1.57, 0.0],
  ['plain', -250, 1040, 2.2, 0.0],
  ['swamp-edge', 620, 620, -0.6, 0.0],
  ['dunes', -900, 1250, 0.5, 0.0],
  ['foothills', -700, -400, 0.4, 0.05],
  ['pines', 300, -560, 0.0, 0.02],
  ['ravine-mouth', 0, -870, 0, 0.1],
  ['aster-shore', -800, 60, 0.9, 0.0],
]
for (const [name, x, z, yaw, pitch] of spots) {
  await page.evaluate(([x, z, yaw, pitch, t]) => { const g = window.__g; g.setTime(t); g.setFog(1); g.game.setGod(true); g.teleport(x, z); g.clearFreeCam(); g.setCam(yaw, pitch) }, [x, z, yaw, pitch, time])
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${prefix}-${name}.png` })
  console.log(`${prefix}-${name}.png`)
}
await browser.close()

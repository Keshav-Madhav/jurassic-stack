// QA aerial shots: whole-island and per-region overheads via the free camera.
//   node tools/aerial.mjs [url] [outPrefix]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const prefix = process.argv[3] ?? 'shots/aerial'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(2500)
// v2 island (4 km): yaw 0 = north (-z), +yaw turns the view west
const shots = [
  ['island', 0, 1800, 2700, 0, -0.6, 0.5], // the judge view: high south, looking north
  ['ring', 200, 720, 1150, 0.15, -0.72, 0.5], // the Lasso's ring round the Holm
  ['knot', 420, 200, 620, -0.3, -0.6, 0.5], // the Reservoir where the river crosses itself
  ['wellspring', 1330, 240, -1000, 0.75, -0.42, 0.5], // the gorge mouth on the NE coast
  ['inflow-valley', 1050, 380, -300, 0.6, -0.45, 0.5], // the inflow leg below the East Range
  ['west-range', -650, 420, -100, 1.57, -0.2, 0.55], // the West Range from the interior
  ['lake-aster', -600, 300, 600, 0.9, -0.5, 0.5], // Lake Aster against the range's foot
  ['tarn', -1100, 330, 500, 1.2, -0.35, 0.5], // the Alpine Tarn on its bench
  ['foothills', -700, 220, -900, 0.6, -0.3, 0.5], // west foothills + the Horns
  ['volcano-south', 0, 260, -200, 0, -0.08, 0.5], // the caldera approach
  ['estuary', 1050, 380, 1600, 0.25, -0.5, 0.5], // the outflow's mouth in Estuary Bay
  ['spawn-eye', 0, 1.7, 1560, 0, 0.04, 0.5], // what you wake up to
]

for (const [name, x, y, z, yaw, pitch, t] of shots) {
  await page.evaluate(([xx, yy, zz, ya, pi, tt]) => {
    const g = window.__g
    g.setTime(tt)
    // eye-level shots: y is a height above the ground under the camera
    const camY = yy < 40 ? g.groundAt(xx, zz) + yy : yy
    if (yy < 40) g.teleport(xx, zz) // eye shots: ground cover follows the player
    g.setFreeCam(xx, camY, zz, ya, pi)
  }, [x, y, z, yaw, pitch, t])
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${prefix}-${name}.png` })
  console.log(`${prefix}-${name}.png`)
}
await page.evaluate(() => window.__g.clearFreeCam())
await browser.close()

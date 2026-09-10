// Water QA: eye-level views of every water edge — the ring's low south bank,
// the Knot, a lake shore, the swamp, the estuary, the beach — to catch sheets
// floating over land, rivers drawn over nearer things, sheet-on-sheet stripes.
//   node tools/qa-water.mjs [url] [outPrefix]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const prefix = process.argv[3] ?? 'shots/water'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(3000)
// yaw 0 = north (-z), +yaw turns west
const shots = [
  ['ring-south-bank', -167, 1.7, 843, 0.47, 0.02, 0.5], // the user's spot (screenshot 22), facing NW
  ['ring-south-air', -167, 40, 843, 0.47, -0.45, 0.5],
  ['ring-west', -500, 1.7, 380, -1.57, 0.02, 0.5], // at the ford, looking east across
  ['knot', 400, 1.7, 430, 0, 0.02, 0.5], // the Reservoir from its south shore
  ['aster-shore', -814, 1.7, 60, 0.6, 0.02, 0.5],
  ['swamp', 760, 1.7, 700, 0.3, 0.02, 0.5],
  ['estuary', 1150, 1.7, 1380, -0.4, 0.02, 0.5],
  ['beach', 0, 1.7, 1585, 3.14, 0.0, 0.5], // spawn beach facing the sea
  // THE WELLSPRING FALL (M72): the gorge above it, the lip, the cove beach it
  // is meant to be seen from, and the foot of the sheet
  ['gorge', 1123, 1.7, -1290, -0.45, -0.08, 0.5], // in the spill channel, looking down it to the lip
  ['fall-cove', 1234, 1.7, -1305, 1.27, 0.14, 0.5], // the cove sand — PLAN's "from the beach"
  ['fall-foot', 1180, 2.5, -1360, 2.32, 0.5, 0.5], // in the water at the plunge, looking up the sheet
  ['fall-sea', 1260, 25, -1400, 2.21, -0.07, 0.5], // off the cove, the whole bluff
  ['fall-near', 1170, 20, -1355, 2.31, -0.15, 0.5], // level with the middle of the sheet, close
  ['fall-crest', 1133, 2.0, -1312, -0.53, -0.35, 0.5] // in the channel at the lip, looking over
]
for (const [name, x, y, z, yaw, pitch, t] of shots) {
  await page.evaluate(([xx, yy, zz, ya, pi, tt]) => {
    const g = window.__g
    g.setTime(tt)
    g.setFog?.(yy > 20 ? 6 : 1)
    const camY = yy < 20 ? g.groundAt(xx, zz) + yy : yy
    g.teleport(xx, zz)
    g.setFreeCam(xx, camY, zz, ya, pi)
  }, [x, y, z, yaw, pitch, t])
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${prefix}-${name}.png` })
  console.log(`${prefix}-${name}.png`)
}
await browser.close()

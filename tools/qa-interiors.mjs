// INTERIORS QA (M73): what it is like to STAND INSIDE the swamp and the pine
// woods, rather than to fly over them. PLAN's last content line is
// "waterfalls + swamp/pine interiors", and the flora has been placed since
// M10f — so the question this tool asks is not "is anything there" but "does
// being in there feel like anywhere".
//   node tools/qa-interiors.mjs [url] [outPrefix]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const prefix = process.argv[3] ?? 'shots/interior'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.waitForTimeout(3000)

// eye height, looking level — a person's view, not a survey
const spots = [
  ['swamp-heart', 760, 700, 0.4, 0.5],
  ['swamp-heart-dusk', 760, 700, 0.4, 0.78],
  ['swamp-edge', 560, 480, 2.2, 0.5],
  ['swamp-delta', 720, 900, 1.1, 0.5],
  ['pine-north-east', 385, -652, 0.9, 0.5],
  ['pine-north-east-dusk', 385, -652, 0.9, 0.78],
  ['pine-range-east', 1293, -358, 2.6, 0.5],
  ['pine-horns', -727, -1290, 0.2, 0.5],
  ['broadleaf-southwood', 50, 1193, 0.7, 0.5], // the control: a wood that IS finished
]
for (const [name, x, z, yaw, t] of spots) {
  const stats = await page.evaluate(([xx, zz, ya, tt]) => {
    const g = window.__g
    g.setTime(tt)
    g.game.setGod(true)
    g.teleport(xx, zz)
    const y = g.groundAt(xx, zz)
    g.setFreeCam(xx, y + 1.7, zz, ya, 0.02)
    return { y: +y.toFixed(1), biome: g.game.biomeAt?.(xx, zz) ?? null }
  }, [x, z, yaw, t])
  await page.waitForTimeout(1800)
  const near = await page.evaluate(([xx, zz]) => {
    const g = window.__g
    return g.game.nodesNear(xx, zz, 26)
  }, [x, z])
  await page.screenshot({ path: `${prefix}-${name}.png` })
  const list = Object.entries(near).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' ')
  console.log(`${prefix}-${name}.png  ground ${stats.y} m · within 26 m: ${list || 'NOTHING'}`)
}
await browser.close()

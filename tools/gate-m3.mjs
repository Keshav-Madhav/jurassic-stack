// M3 gate, automated:
//   1. FPS: average over 4 s of free running ≥ 55 (headless GPU, indicative)
//   2. Collision: drive the player across the island in 4 directions from 4
//      start points; every sampled position must stay above ground - 0.75 m,
//      never NaN, and each leg must actually travel.
//   node tools/gate-m3.mjs [url]
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:4173'
let failed = false
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`)
  if (!ok) failed = true
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => { console.error('page error:', e.message); failed = true })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(1500)

// --- FPS ---
await page.evaluate(() => window.__g.setTime(0.5))
await page.waitForTimeout(4000)
const fps = await page.evaluate(() => window.__g.fps())
check(fps >= 55, `fps ${fps} (threshold 55, headless)`)

// --- collision walks: start points × directions, 8 s each at sprint speed ---
const walks = [
  { name: 'spawn→north (toward volcano)', x: 0, z: 780, vx: 0, vz: -8 },
  { name: 'interior→east over hills', x: -300, z: 0, vx: 8, vz: 0 },
  { name: 'foothills→northwest upslope', x: 120, z: -300, vx: -6, vz: -6 },
  { name: 'west flats→south', x: -400, z: -200, vx: 0, vz: 8 },
]
for (const w of walks) {
  const result = await page.evaluate(async (s) => {
    const g = window.__g
    g.teleport(s.x, s.z)
    g.setIntent(s.vx, s.vz)
    const samples = []
    const start = performance.now()
    while (performance.now() - start < 8000) {
      await new Promise((r) => setTimeout(r, 200))
      const p = g.player()
      samples.push({ x: p.x, y: p.y, z: p.z, ground: g.groundAt(p.x, p.z) })
    }
    g.setIntent(0, 0)
    return samples
  }, w)

  const bad = result.filter((s) => !Number.isFinite(s.y) || s.y < s.ground - 0.75)
  const first = result[0]
  const lastS = result[result.length - 1]
  const traveled = Math.hypot(lastS.x - first.x, lastS.z - first.z)
  check(bad.length === 0, `${w.name}: never below ground (worst ${Math.min(...result.map((s) => s.y - s.ground)).toFixed(2)}m)`)
  check(traveled > 25, `${w.name}: traveled ${traveled.toFixed(0)}m`)
}

await browser.close()
process.exit(failed ? 1 : 0)

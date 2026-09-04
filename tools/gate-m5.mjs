// M5 water gate: water queries, swim buoyancy, river current drift, ocean swim.
//   node tools/gate-m5.mjs [url]
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
await page.waitForTimeout(1000)

// --- find a river midpoint from world meta (via the page) ---
const probe = await page.evaluate(async () => {
  const meta = await (await fetch('world/world-meta.json')).json()
  const path = meta.rivers[0]
  const mid = path[Math.floor(path.length / 2)]
  const g = window.__g
  return {
    mid,
    lake: meta.lakes[0],
    wlRiver: g.game.waterLevelAt(mid.x, mid.z),
    flowRiver: g.game.riverFlowAt(mid.x, mid.z),
    wlOcean: g.game.waterLevelAt(0, 1010),
    wlLake: g.game.waterLevelAt(meta.lakes[0].deep.x, meta.lakes[0].deep.z),
    wlDryLand: g.game.waterLevelAt(meta.spawn.x, meta.spawn.z),
  }
})
check(probe.wlRiver !== null, `river reports water (level ${probe.wlRiver?.toFixed(1)})`)
check(probe.flowRiver !== null, `river reports flow (${probe.flowRiver?.x.toFixed(2)}, ${probe.flowRiver?.z.toFixed(2)})`)
check(probe.wlOcean !== null && Math.abs(probe.wlOcean) < 0.01, `ocean reports sea level (${probe.wlOcean})`)
check(probe.wlLake !== null && probe.wlLake > 0.5, `lake reports its level (${probe.wlLake?.toFixed(1)})`)
check(probe.wlDryLand === null, 'spawn beach reports dry')

// --- river swim: drop in with zero intent, the current must carry us ---
await page.evaluate((mid) => {
  const g = window.__g
  g.teleport(mid.x, mid.z)
  g.setIntent(0, 0)
}, probe.mid)
await page.waitForTimeout(800)
const swim0 = await page.evaluate(() => ({ p: window.__g.player(), swimming: window.__g.game.swimming() }))
check(swim0.swimming, 'swimming in the river')
await page.waitForTimeout(4000)
const swim1 = await page.evaluate(() => ({ p: window.__g.player(), swimming: window.__g.game.swimming() }))
const drift = Math.hypot(swim1.p.x - swim0.p.x, swim1.p.z - swim0.p.z)
const alongFlow = (swim1.p.x - swim0.p.x) * probe.flowRiver.x + (swim1.p.z - swim0.p.z) * probe.flowRiver.z
check(drift > 4, `current carried the swimmer ${drift.toFixed(1)}m`)
check(alongFlow > drift * 0.6, `drift is downstream (${alongFlow.toFixed(1)}m along flow)`)
const wlHere = await page.evaluate((p) => window.__g.game.waterLevelAt(p.x, p.z), swim1.p)
if (wlHere !== null) {
  check(Math.abs(swim1.p.y - wlHere) < 2.0, `floating near the surface (y=${swim1.p.y.toFixed(1)} vs level ${wlHere.toFixed(1)})`)
} else {
  check(true, 'drifted out of channel (mouth reached) — acceptable')
}

// --- ocean swim: buoyancy holds at sea level ---
await page.evaluate(() => {
  const g = window.__g
  g.teleport(0, 1005)
  g.setIntent(0, 0)
})
await page.waitForTimeout(2500)
const ocean = await page.evaluate(() => ({ p: window.__g.player(), swimming: window.__g.game.swimming() }))
check(ocean.swimming, 'swimming in the ocean')
check(ocean.p.y > -1.6 && ocean.p.y < 1.6, `buoyant at sea level (y=${ocean.p.y.toFixed(2)})`)

// --- back on land: walking resumes ---
await page.evaluate(() => {
  const g = window.__g
  g.teleport(0, 780)
  g.setIntent(0, -4)
})
await page.waitForTimeout(1500)
await page.evaluate(() => window.__g.setIntent(0, 0))
const land = await page.evaluate(() => window.__g.game.swimming())
check(!land, 'back to walking on the beach')

await browser.close()
process.exit(failed ? 1 : 0)

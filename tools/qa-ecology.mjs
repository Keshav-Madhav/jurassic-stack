// Ecology QA: stage a small scene on the south plain — a raptor pair, a pachy
// trio, a parasaur, a trike — stand off to the side, and watch the brain for
// 50 s: hunts must start, prey must flee or fight, kills must feed. Prints the
// transitions it saw and takes a shot of the first chase.
//   node tools/qa-ecology.mjs [url] [outPrefix]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const prefix = process.argv[3] ?? 'shots/ecology'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(6000)
const AX = -240, AZ = 1000 // the plain-circle ruin's meadow
await page.evaluate(([AX, AZ]) => {
  const g = window.__g
  g.setTime(0.5)
  g.game.setCreative(true)
  g.teleport(AX, AZ + 60)
  g.game.spawnDino('raptor', AX - 30, AZ); g.game.spawnDino('raptor', AX - 26, AZ + 4)
  g.game.spawnDino('pachy', AX + 10, AZ - 6); g.game.spawnDino('pachy', AX + 14, AZ); g.game.spawnDino('pachy', AX + 8, AZ + 6)
  g.game.spawnDino('parasaur', AX + 30, AZ + 10)
  g.game.spawnDino('trike', AX + 20, AZ + 30)
  g.game.spawnDino('carno', AX - 60, AZ + 40)
}, [AX, AZ])
await page.waitForTimeout(4000)
const seen = new Map()
let shot = false
const t0 = Date.now()
while (Date.now() - t0 < 50000) {
  await page.waitForTimeout(1000)
  const eco = await page.evaluate(() => window.__g.game.ecology())
  for (const e of eco) {
    const key = `${e.sp} ${e.state}${e.foe ? ' → ' + e.foe : ''}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
    if (!shot && (e.state === 'hunt' || (e.state === 'aggro' && e.foe && e.foe !== 'player'))) {
      shot = true
      await page.evaluate(([e, AX, AZ]) => { const g = window.__g; g.setFreeCam(e.x + 14, g.groundAt(e.x + 14, e.z + 14) + 5, e.z + 14, Math.atan2(-(e.x - (e.x + 14)), -(e.z - (e.z + 14))), -0.25) }, [e, AX, AZ])
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${prefix}-chase.png` })
      await page.evaluate(() => window.__g.clearFreeCam())
    }
  }
}
console.log('ecology over 50 s (state seconds):')
for (const [k, v] of [...seen.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}s  ${k}`)
const hunts = [...seen.keys()].filter((k) => k.includes(' hunt')).length
const flees = [...seen.keys()].filter((k) => k.includes(' flee')).length
const feeds = [...seen.keys()].filter((k) => k.includes(' feed') || k.includes(' dead')).length
console.log(`hunt kinds ${hunts} · flee kinds ${flees} · kills/feeds ${feeds}`)
await browser.close()

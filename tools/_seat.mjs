import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await b.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto('http://localhost:4173', { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.waitForTimeout(10000)
await page.evaluate(() => { const g = window.__g, p = g.player(); g.game.speciesList().forEach((id, i) => g.game.spawnDino(id, p.x + 30 + i * 14, p.z + 30)) })
await page.waitForTimeout(9000)
const r = await page.evaluate(() => window.__g.game.seatProbe())
console.log('species      seat y | back above feet |  height  length | axis  torso off |    dy')
for (const [k, v] of Object.entries(r).sort()) {
  const flag = Math.abs(v.dy) > 0.3 ? (v.dy > 0 ? '  FLOATS' : '  SUNK') : ''
  console.log(`${k.padEnd(12)} ${String(v.seatY).padStart(6)} | ${String(v.backAboveFeet).padStart(15)} | ${String(v.height).padStart(7)} ${String(v.length).padStart(7)} |  ${v.axis}   ${String(v.torsoOffset).padStart(8)}  | ${String(v.dy).padStart(5)}${flag}`)
}
await b.close()

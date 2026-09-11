// Attack variety probe (M87): how many different blows each species has bound.
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await b.newPage({ viewport: { width: 900, height: 560 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate(() => {
  const g = window.__g, p = g.player()
  g.game.speciesList().forEach((id, i) => {
    const a = (i / 15) * Math.PI * 2
    g.game.spawnDino(id, p.x + Math.cos(a) * 28, p.z + Math.sin(a) * 28)
  })
})
await new Promise((r) => setTimeout(r, 14000))
const a = await page.evaluate(() => window.__g.game.attackAudit())
for (const [k, v] of Object.entries(a).sort()) console.log(`${k.padEnd(12)} ${v} attack${v === 1 ? '' : 's'}`)
await b.close()

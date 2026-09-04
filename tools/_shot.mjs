import { chromium } from 'playwright-core'
const shots = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto('http://localhost:4173', { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(1500)
const by = await page.evaluate(() => { const out = {}; for (const r of window.__g.game.scatterDebug()) { const k = r.key.split('#')[0]; out[k] = (out[k] || 0) + r.nodes }; return out })
console.log(JSON.stringify(by))
for (const spec of shots) {
  const [x, y, z, yaw, pitch, out] = spec.split(',')
  await page.evaluate(([xx, yy, zz, ya, pi]) => { const g = window.__g; g.setTime(0.5); const cy = +yy < 40 ? g.groundAt(+xx, +zz) + +yy : +yy; g.teleport(+xx, +zz); g.setFreeCam(+xx, cy, +zz, +ya, +pi) }, [x, y, z, yaw, pitch])
  await page.waitForTimeout(1400)
  await page.screenshot({ path: out })
  console.log(out)
}
await browser.close()

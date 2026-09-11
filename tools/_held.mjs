// Held-tool pass (M84): the armed idle, the walk with a tool, and three frames
// through the swing arc, for hatchet and spear.
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 900, height: 620 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate(() => {
  const g = window.__g
  g.setTime(0.5); g.setCam(0, 0)
  g.game.give('hatchet', 1); g.game.give('spear', 1); g.game.give('torch', 1)
})
await new Promise((r) => setTimeout(r, 900))
const look = async (a, d, u, pitch = -0.04) => {
  await page.evaluate(([aa, dd, uu, pp]) => {
    const g = window.__g, p = g.player()
    g.setFreeCam(p.x + Math.sin(aa) * dd, p.y + uu, p.z + Math.cos(aa) * dd, aa, pp)
  }, [a, d, u, pitch])
  await new Promise((r) => setTimeout(r, 230))
}
for (const item of ['hatchet', 'spear', 'torch']) {
  const ok = await page.evaluate((i) => window.__g.game.selectItem(i), item)
  await new Promise((r) => setTimeout(r, 700))
  await look(Math.PI * 0.8, 2.6, 0.2)
  await page.screenshot({ path: `shots/held-${item}-idle.png` })
  const st = await page.evaluate(() => window.__g.game.locoState())
  console.log(`${item.padEnd(8)} equipped=${ok} armBlend=${st.armBlend} idle=${st.weights.idle} armed=${st.weights.armed}`)
  // mid-swing
  await page.evaluate(() => window.__g.game.swing())
  await new Promise((r) => setTimeout(r, 160))
  await page.screenshot({ path: `shots/held-${item}-swing1.png` })
  await new Promise((r) => setTimeout(r, 170))
  await page.screenshot({ path: `shots/held-${item}-swing2.png` })
  await new Promise((r) => setTimeout(r, 900))
}
await browser.close()

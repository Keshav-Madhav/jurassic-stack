// Swim close-up (M84): four frames across the stroke cycle, camera just above
// the waterline so the frame itself shows how deep the body floats.
//   node tools/_swim.mjs [url] [prefix]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const prefix = process.argv[3] ?? 'shots/swim'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate(() => {
  window.__g.setTime(0.5); window.__g.setCam(Math.PI, 0); window.__g.teleport(0, 1700)
  // the HUD covers the subject at this framing
  for (const el of document.querySelectorAll('#hud, .hud, #hotbar, #toast, #bars, #minimap, #map-mini')) el.style.display = 'none'
  document.querySelectorAll('body > div').forEach((d) => { if (!d.querySelector('canvas')) d.style.display = 'none' })
})
await new Promise((r) => setTimeout(r, 1800))
await page.keyboard.down('KeyW')
await new Promise((r) => setTimeout(r, 2000))
for (const [name, a, d, y] of [['side-a', Math.PI / 2, 2.3, 0.45], ['side-b', Math.PI / 2, 2.3, 0.45],
  ['side-c', Math.PI / 2, 2.3, 0.45], ['q34', Math.PI * 0.72, 2.6, 1.0]]) {
  await page.evaluate(([aa, dd, yy]) => {
    const g = window.__g, p = g.player()
    g.setFreeCam(p.x + Math.sin(aa) * dd, yy, p.z + Math.cos(aa) * dd, aa, yy > 0.8 ? -0.18 : -0.02)
  }, [a, d, y])
  await new Promise((r) => setTimeout(r, 230))
  await page.screenshot({ path: `${prefix}-${name}.png` })
  console.log(`${prefix}-${name}.png`, JSON.stringify(await page.evaluate(() => {
    const s = window.__g.game.locoState(); return { pitch: s.pitch, bodyY: s.bodyY, waterY: s.waterY }
  })))
  await new Promise((r) => setTimeout(r, 170))
}
await page.keyboard.up('KeyW')

// the view the player actually has, and the tread-water hold
await page.evaluate(() => window.__g.clearFreeCam())
await page.keyboard.down('KeyW')
await new Promise((r) => setTimeout(r, 1200))
await page.evaluate(() => window.__g.setCam(Math.PI, 0.1))
await new Promise((r) => setTimeout(r, 260))
await page.screenshot({ path: `${prefix}-play.png` })
await page.keyboard.up('KeyW')
await new Promise((r) => setTimeout(r, 2200))
await page.evaluate(() => {
  const g = window.__g, p = g.player()
  g.setFreeCam(p.x + 2.6, 0.8, p.z, Math.PI / 2, -0.12)
})
await new Promise((r) => setTimeout(r, 260))
await page.screenshot({ path: `${prefix}-tread.png` })
console.log('tread', JSON.stringify(await page.evaluate(() => window.__g.game.locoState())).slice(0, 200))
await browser.close()

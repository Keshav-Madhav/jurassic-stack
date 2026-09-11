// Grip measurement (M84): for each candidate pose, what the tool's long axis
// does in the PLAYER's frame and how far the butt sits from the fist.
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const item = process.argv[3] ?? 'spear'
const cands = JSON.parse(process.argv[4] ?? '[]')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 900, height: 620 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate((it) => {
  const g = window.__g
  g.setTime(0.5); g.setCam(0, 0); g.game.give(it, 1); g.game.selectItem(it)
}, item)
await new Promise((r) => setTimeout(r, 900))
console.log('base', JSON.stringify(await page.evaluate(() => window.__g.game.heldProbe())))
for (let i = 0; i < cands.length; i++) {
  const [pos, rot] = cands[i]
  const r = await page.evaluate(([it, p, ro]) => {
    window.__g.game.setHeldPose(it, p, ro)
    return window.__g.game.heldProbe()
  }, [item, pos, rot])
  await new Promise((r2) => setTimeout(r2, 260))
  await page.evaluate(() => {
    const g = window.__g, p = g.player()
    g.setFreeCam(p.x + Math.sin(Math.PI * 0.8) * 2.8, p.y + 0.2, p.z + Math.cos(Math.PI * 0.8) * 2.8, Math.PI * 0.8, -0.04)
  })
  await new Promise((r2) => setTimeout(r2, 200))
  await page.screenshot({ path: `shots/grip-${item}-${i}.png` })
  console.log(`${i} pos=${JSON.stringify(pos)} rot=${JSON.stringify(rot)} → gap=${r.gripGap} dir=${JSON.stringify(r.dir)} len=${r.length}`)
}
await browser.close()

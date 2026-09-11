// Swim pose sweep (M84): one browser, several candidate poses, a side shot of
// each. setSwimPose is live, so a guess costs 300 ms rather than a rebuild.
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const cands = JSON.parse(process.argv[3] ?? '[{}]')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 900, height: 560 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate(() => {
  window.__g.setTime(0.5); window.__g.setCam(Math.PI, 0); window.__g.teleport(0, 1700)
  document.querySelectorAll('body > div').forEach((d) => { if (!d.querySelector('canvas')) d.style.display = 'none' })
})
await new Promise((r) => setTimeout(r, 1800))
await page.keyboard.down('KeyW')
await new Promise((r) => setTimeout(r, 1600))
for (let i = 0; i < cands.length; i++) {
  await page.evaluate((o) => window.__g.game.setSwimPose(o), cands[i])
  await new Promise((r) => setTimeout(r, 900))
  await page.evaluate(() => {
    const g = window.__g, p = g.player()
    g.setFreeCam(p.x + 2.4, 0.55, p.z, Math.PI / 2, -0.03)
  })
  await new Promise((r) => setTimeout(r, 240))
  await page.screenshot({ path: `shots/sweep-${i}.png` })
  console.log(`shots/sweep-${i}.png`, JSON.stringify(cands[i]))
}
await page.keyboard.up('KeyW')
await browser.close()

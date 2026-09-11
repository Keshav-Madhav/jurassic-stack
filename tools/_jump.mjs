// Jump probe (M88): four frames through a jump, side-on. The rig has no jump
// clip — the airborne slot falls back to an alert idle — so this is what
// leaving the ground looks like.
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await b.newPage({ viewport: { width: 900, height: 620 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate(() => {
  window.__g.setTime(0.5); window.__g.setCam(0, 0)
  document.querySelectorAll('body > div').forEach((d) => { if (!d.querySelector('canvas')) d.style.display = 'none' })
})
await new Promise((r) => setTimeout(r, 1200))
const home = await page.evaluate(() => window.__g.player())
await page.evaluate((p) => window.__g.setFreeCam(p.x + 4.5, p.y + 0.6, p.z, Math.PI / 2, -0.03), home)
await page.keyboard.press('Space')
for (const [tag, ms] of [['rise', 120], ['apex', 260], ['fall', 300], ['land', 360]]) {
  await new Promise((r) => setTimeout(r, ms))
  const s = await page.evaluate(() => {
    const l = window.__g.game.locoState(), p = window.__g.player()
    return { y: +p.y.toFixed(2), air: l.airBlend, w: l.weights.air, tuck: l.tuck ?? null }
  })
  await page.screenshot({ path: `shots/jump-${tag}.png` })
  console.log(`${tag.padEnd(6)} y=${String(s.y).padStart(6)} airBlend=${s.air} airClip=${s.w} tuck=${s.tuck}`)
}
await b.close()

// Dive probe (M86): hold Shift in deep water and watch the depth, the pose
// and the underwater render. Until now the buoyancy pushed the head back to
// the surface the instant it dipped, so none of this was reachable.
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await b.newPage({ viewport: { width: 1100, height: 700 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate(() => {
  window.__g.setTime(0.5); window.__g.setCam(Math.PI, 0); window.__g.teleport(0, 1740)
  document.querySelectorAll('body > div').forEach((d) => { if (!d.querySelector('canvas')) d.style.display = 'none' })
})
await new Promise((r) => setTimeout(r, 2000))
const say = async (tag) => {
  const s = await page.evaluate(() => {
    const l = window.__g.game.locoState(), p = window.__g.player()
    return { y: +p.y.toFixed(2), pitch: l.pitch, climb: l.climb, diving: l.diving, swim: l.swimBlend, bodyY: l.bodyY, sub: window.__g.game.air().submerged }
  })
  console.log(`${tag.padEnd(14)} y=${String(s.y).padStart(6)} bodyY=${String(s.bodyY).padStart(6)} pitch=${String(s.pitch).padStart(5)} climb=${String(s.climb).padStart(5)} diving=${s.diving} submerged=${s.sub}`)
  return s
}
await say('floating')
await page.keyboard.down('ShiftLeft')
for (const t of [800, 1600, 2400, 3200]) {
  await new Promise((r) => setTimeout(r, 800))
  await say(`diving ${t}ms`)
}
await page.evaluate((r) => window.__g.setFreeCam(r.x + 4.2, r.y + 0.4, r.z, Math.PI / 2, -0.05), await page.evaluate(() => window.__g.player()))
await new Promise((r) => setTimeout(r, 400))
await page.screenshot({ path: 'shots/dive-side.png' })
await page.evaluate(() => window.__g.clearFreeCam())
await new Promise((r) => setTimeout(r, 500))
await page.screenshot({ path: 'shots/dive-play.png' })
await page.keyboard.up('ShiftLeft')
for (const t of [1, 2, 3]) { await new Promise((r) => setTimeout(r, 1300)); await say(`rising ${t}`) }
await page.screenshot({ path: 'shots/dive-rising.png' })
await b.close()

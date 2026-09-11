// One-clip idle probe (M89): dilo, sauropelta and spino have a single
// animation apiece, re-timed for every state — so standing still they play a
// walk cycle at a third speed. Photograph one twice, 600 ms apart, from a
// camera near the animal while the PLAYER stays far enough off not to
// provoke it: a stride in slow motion shows up as a changed pose.
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const only = (process.argv[3] ?? 'dilo,sauropelta,spino').split(',')
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await b.newPage({ viewport: { width: 800, height: 520 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate(() => {
  window.__g.setTime(0.5)
  document.querySelectorAll('body > div').forEach((d) => { if (!d.querySelector('canvas')) d.style.display = 'none' })
})
await new Promise((r) => setTimeout(r, 1200))
const home = await page.evaluate(() => window.__g.player())
for (let i = 0; i < only.length; i++) {
  const id = only[i]
  // 55 m out: inside the draw distance, outside anything's temper
  const idx = await page.evaluate(([sp, hx, hz]) => window.__g.game.spawnDino(sp, hx, hz - 55), [id, home.x, home.z])
  await new Promise((r) => setTimeout(r, 6000))
  for (const shot of ['a', 'b']) {
    const st = await page.evaluate((j) => ({ p: window.__g.game.dinoPos(j), s: window.__g.game.dinoStates()[j], sp: window.__g.game.dinoSpeed?.(j) ?? null }), idx)
    await page.evaluate((p) => window.__g.setFreeCam(p.x + 7, p.y + 2.2, p.z + 1.5, Math.PI / 2 - 0.18, -0.14), st.p)
    await new Promise((r) => setTimeout(r, 260))
    await page.screenshot({ path: `shots/oneclip-${id}-${shot}.png` })
    if (shot === 'a') await new Promise((r) => setTimeout(r, 600))
    else console.log(`${id.padEnd(12)} state=${st.s.state}`)
  }
  await page.evaluate(() => window.__g.clearFreeCam())
}
await b.close()

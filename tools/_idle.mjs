// One-clip idle probe (M88): dilo, sauropelta and spino have a single
// animation apiece, re-timed for every state. Standing still they play it
// slowly — this photographs what that looks like, twice, half a second apart,
// so a pose that is CHANGING is visible as a pose that is changing.
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const only = (process.argv[3] ?? 'dilo,sauropelta,spino').split(',')
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await b.newPage({ viewport: { width: 900, height: 560 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate(() => { window.__g.setTime(0.5) })
await new Promise((r) => setTimeout(r, 1200))
const home = await page.evaluate(() => window.__g.player())
for (let i = 0; i < only.length; i++) {
  const id = only[i]
  const idx = await page.evaluate(([sp, k, hx, hz]) => window.__g.game.spawnDino(sp, hx + 30 + k * 40, hz - 20), [id, i, home.x, home.z])
  try { await page.waitForFunction((j) => window.__g.game.gotoDinoIndex(j) === true, idx, { timeout: 15000 }) } catch { console.log(`${id} never visible`); continue }
  // stand back and let it settle into idle
  await new Promise((r) => setTimeout(r, 3000))
  for (const shot of ['a', 'b']) {
    const st = await page.evaluate((j) => ({ p: window.__g.game.dinoPos(j), s: window.__g.game.dinoStates()[j] }), idx)
    await page.evaluate((p) => window.__g.setFreeCam(p.x + 9, p.y + 2.6, p.z + 2, Math.PI / 2 - 0.2, -0.12), st.p)
    await new Promise((r) => setTimeout(r, 260))
    await page.screenshot({ path: `shots/idle-${id}-${shot}.png` })
    if (shot === 'a') await new Promise((r) => setTimeout(r, 700))
    else console.log(`${id.padEnd(12)} state=${st.s.state}`)
  }
  await page.evaluate(() => window.__g.clearFreeCam())
}
await b.close()

// Death probe (M87): kill one of each species and report which collapse it
// played. Four rigs carry a death clip distinct from their knockout, and
// until now all four died in the knockout pose.
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await b.newPage({ viewport: { width: 1000, height: 640 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate(() => { window.__g.setTime(0.5); window.__g.game.give('spear', 1); window.__g.game.selectItem('spear') })
await new Promise((r) => setTimeout(r, 1200))
const home = await page.evaluate(() => window.__g.player())
const species = await page.evaluate(() => window.__g.game.speciesList())
for (let i = 0; i < species.length; i++) {
  const id = species[i]
  const idx = await page.evaluate(([sp, k, n, hx, hz]) => {
    const a = (k / n) * Math.PI * 2
    return window.__g.game.spawnDino(sp, hx + Math.cos(a) * 60, hz + Math.sin(a) * 60)
  }, [id, i, species.length, home.x, home.z])
  try {
    await page.waitForFunction((j) => { const d = window.__g.game.dinoDeath(j); return !!d && (d.declared === 0 || d.bound > 0) }, idx, { timeout: 15000 })
  } catch { console.log(`${id.padEnd(12)} never loaded`); continue }
  // kill it outright rather than swinging: the swing is rate-limited to one
  // every 0.45 s outside creative, so a tight loop of them lands almost
  // nothing and every animal came back alive and cross
  const h0 = await page.evaluate((j) => window.__g.game.dinoHeight(j), idx)
  const st = await page.evaluate((j) => {
    window.__g.game.gotoDinoIndex(j)
    window.__g.game.killDino(j)
    return { s: window.__g.game.dinoStates()[j]?.state, d: window.__g.game.dinoDeath(j) }
  }, idx)
  await new Promise((r) => setTimeout(r, 2600))
  const h1 = await page.evaluate((j) => window.__g.game.dinoHeight(j), idx)
  if (st?.d?.declared) {
    await page.evaluate((j) => {
      const p = window.__g.game.dinoPos(j)
      window.__g.setFreeCam(p.x + 6, p.y + 2.6, p.z, Math.PI / 2, -0.34)
    }, idx)
    await new Promise((r) => setTimeout(r, 400))
    await page.screenshot({ path: `shots/death-${id}.png` })
    await page.evaluate(() => window.__g.clearFreeCam())
  }
  const d = st?.d ?? { declared: 0, bound: 0, running: false, clip: null }
  const mark = d.declared === 0 ? 'knockout clip or topple' : d.running ? `DIED: ${d.clip}` : `declared ${d.declared}, bound ${d.bound}, NOT PLAYING`
  console.log(`${id.padEnd(12)} ${String(st?.s ?? '?').padEnd(5)} ${String(h0).padStart(5)} → ${String(h1).padStart(5)} m   ${mark}`)
}
await b.close()

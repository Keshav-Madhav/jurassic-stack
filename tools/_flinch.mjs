// Flinch probe (M85): spawn each species that declares a hurt clip, hit it,
// and read whether the clip actually runs.
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await b.newPage({ viewport: { width: 1000, height: 640 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate(() => { window.__g.setTime(0.5) })
await new Promise((r) => setTimeout(r, 1200))
const home = await page.evaluate(() => window.__g.player())
const species = await page.evaluate(() => window.__g.game.speciesList())
for (let i = 0; i < species.length; i++) {
  const id = species[i]
  const idx = await page.evaluate(([sp, k, n, hx, hz]) => {
    const a = (k / n) * Math.PI * 2
    return window.__g.game.spawnDino(sp, hx + Math.cos(a) * 60, hz + Math.sin(a) * 60)
  }, [id, i, species.length, home.x, home.z])
  try { await page.waitForFunction((j) => window.__g.game.gotoDinoIndex(j) === true, idx, { timeout: 12000 }) } catch { console.log(`${id.padEnd(12)} never visible`); continue }
  // WAIT FOR THE RIG'S MIXER, not just for the object to be visible: the
  // first species in the list is spawned seconds after boot and its clips are
  // still arriving, which read as "declared but not bound" — the animal was
  // fine, the probe was early.
  try {
    await page.waitForFunction((j) => { const f = window.__g.game.dinoFlinch(j); return !!f && (!f.declared || f.bound) }, idx, { timeout: 15000 })
  } catch { /* reported below */ }
  const t0 = await page.evaluate((j) => window.__g.game.dinoStates()[j]?.torpor ?? -1, idx)
  let t1 = t0
  let a = { declared: false, bound: false, running: false }
  for (let k = 0; k < 6 && t1 <= t0; k++) {
    // read the flinch in the SAME round trip as the swing: a short clip is
    // over before a second evaluate lands
    const r0 = await page.evaluate((j) => {
      window.__g.game.gotoDinoIndex(j)
      window.__g.game.swing()
      return { f: window.__g.game.dinoFlinch(j), t: window.__g.game.dinoStates()[j]?.torpor ?? -1 }
    }, idx)
    a = r0.f
    await new Promise((r) => setTimeout(r, 110))
    t1 = await page.evaluate((j) => window.__g.game.dinoStates()[j]?.torpor ?? -1, idx)
  }
  const mark = a.declared ? (a.bound ? (a.running ? `FLINCHED (${a.seconds}s)` : 'bound, not running') : 'DECLARED BUT NOT BOUND') : 'no clip on this rig'
  console.log(`${id.padEnd(12)} ${mark.padEnd(24)} torpor ${t0}→${t1}`)
}
await b.close()

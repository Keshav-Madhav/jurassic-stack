// Gate: the ecology (M19). Stages a raptor pair, a pachy trio, a parasaur, a
// trike and a carno on the south plain, watches 45 s: a hunt must start, prey
// must flee, and every species' clips must resolve. node tools/gate-ecology.mjs [url]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(9000)
const audit = await page.evaluate(() => window.__g.game.animAudit())
const species = Object.keys(audit)
check(species.length >= 11, `${species.length} species loaded`)
for (const [id, a] of Object.entries(audit)) {
  const missing = Object.entries(a.slots).filter(([, v]) => v === null).map(([k]) => k)
  check(missing.length === 0, `${id}: every clip slot resolved${missing.length ? ' — missing ' + missing.join(',') : ''}`)
}
// every rig draws opaque: a BLEND material (the Carnotaurus shipped one) has no
// depth write, so the water sheets painted over it (user screenshot 24)
const rigs = await page.evaluate(() => window.__g.game.rigMaterials())
const blended = Object.entries(rigs).filter(([, v]) => v.some((m) => m.includes('transparent=true') || m.includes('depthWrite=false'))).map(([k]) => k)
check(blended.length === 0, `every rig material opaque with depth write${blended.length ? ' — not: ' + blended.join(',') : ''}`)

const AX = -240, AZ = 1000
await page.evaluate(([AX, AZ]) => {
  const g = window.__g
  g.setTime(0.5); g.game.setCreative(true); g.teleport(AX, AZ + 60)
  g.game.spawnDino('raptor', AX - 30, AZ); g.game.spawnDino('raptor', AX - 26, AZ + 4)
  g.game.spawnDino('pachy', AX + 10, AZ - 6); g.game.spawnDino('pachy', AX + 14, AZ); g.game.spawnDino('pachy', AX + 8, AZ + 6)
  g.game.spawnDino('parasaur', AX + 30, AZ + 10); g.game.spawnDino('trike', AX + 20, AZ + 30); g.game.spawnDino('carno', AX - 60, AZ + 40)
}, [AX, AZ])
const seen = new Set()
const t0 = Date.now()
while (Date.now() - t0 < 45000) {
  await page.waitForTimeout(1000)
  for (const e of await page.evaluate(() => window.__g.game.ecology())) seen.add(`${e.sp} ${e.state}${e.foe ? ' → ' + e.foe : ''}`)
}
const keys = [...seen]
check(keys.some((k) => k.includes(' hunt → ')), `a carnivore hunted (${keys.filter((k) => k.includes(' hunt')).join('; ') || 'none'})`)
check(keys.some((k) => /^(pachy|parasaur|trike|stego) flee/.test(k)), `herbivores fled (${keys.filter((k) => k.includes(' flee')).join('; ') || 'none'})`)
check(!keys.some((k) => /^(pachy|parasaur) hunt/.test(k)), 'no herbivore hunts')
await browser.close()
process.exit(failed ? 1 : 0)

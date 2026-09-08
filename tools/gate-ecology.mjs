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
// the 1500 rigs clone in over ~10 s; wait until every species has a loaded rig
await page.waitForFunction('Object.keys(window.__g.game.animAudit()).length >= 11', null, { timeout: 40000 }).catch(() => {})
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

// --- M36: a tame fights for you ---
const g = (expr) => page.evaluate(expr)
// creative gives an instant KO and an instant tame; then the player picks a
// fight with a wild carnivore and the pack is expected to answer
await g('window.__g.game.setCreative(true); window.__g.game.setGod(true)')
await page.waitForTimeout(400)
const pRaptor = await page.evaluate(() => { const p = window.__g.player(); return window.__g.game.spawnDino('raptor', p.x + 3, p.z - 1) })
await page.waitForTimeout(2500)
await page.evaluate((i) => window.__g.game.gotoDinoIndex(i), pRaptor)
await page.waitForTimeout(300)
await g('window.__g.game.swing()')
await page.waitForTimeout(400)
await g('window.__g.game.interact()')
await page.waitForTimeout(600)
const tamed = await page.evaluate((i) => window.__g.game.dinoStates()[i].state, pRaptor)
check(tamed === 'tamed', `a raptor is tamed for the guard test (${tamed})`)

await g('window.__g.game.setCreative(false)')
const foe = await page.evaluate(() => { const p = window.__g.player(); return window.__g.game.spawnDino('carno', p.x + 7, p.z - 5) })
await page.waitForTimeout(2500)
const hpBefore = await page.evaluate((i) => window.__g.game.dinoStates()[i].hp, foe)
await page.evaluate((i) => window.__g.game.gotoDinoIndex(i), foe)
await page.waitForTimeout(400)
await g('window.__g.game.swing()') // the player swings first: the tames should pile in
await page.waitForTimeout(2500)
const guarding = await page.evaluate((i) => window.__g.game.dinoStates()[i].guarding, pRaptor)
check(guarding === true, 'the tame takes up the fight when you swing first')
await page.waitForTimeout(6000)
const hpAfter = await page.evaluate((i) => window.__g.game.dinoStates()[i].hp, foe)
check(hpAfter < hpBefore, `the tame actually bites: the carno is ${hpBefore} → ${hpAfter} hp`)


// --- M41: a body goes down like a body ---
// (measured, not eyeballed: the roll accelerates rather than ramping linearly,
// finishes on its side, and makes a noise when it lands)
// a T-Rex, deliberately: its GLB ships no death clip (its slot falls back to a
// roar), so it is one of the rigs the procedural topple exists for
const victim = await page.evaluate(() => { const p = window.__g.player(); return window.__g.game.spawnDino('trex', p.x + 8, p.z - 8) })
await page.waitForTimeout(2500)
const rolls = []
const thudsBefore = await page.evaluate(() => window.__g.game.thuds())
await page.evaluate((k) => window.__g.game.killDino(k), victim)
for (let i = 0; i < 12; i++) { rolls.push(await page.evaluate((k) => window.__g.game.dinoRoll(k), victim)); await page.waitForTimeout(110) }
const mag = rolls.map(Math.abs)
check(mag[mag.length - 1] > 1.2, `the carcass ends up on its side (${mag[mag.length - 1].toFixed(2)} rad)`)
const early = mag[1] - mag[0]
const later = mag[3] - mag[2]
check(later > early, `the fall accelerates rather than ramps (${early.toFixed(2)} → ${later.toFixed(2)} rad a frame)`)
check((await page.evaluate(() => window.__g.game.thuds())) > thudsBefore, 'and it lands with a thud')

await browser.close()
process.exit(failed ? 1 : 0)

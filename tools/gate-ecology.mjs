// Gate: the ecology (M19). Stages a raptor pair, a pachy trio, a parasaur, a
// trike and a carno on the south plain, watches 45 s: a hunt must start, prey
// must flee, and every species' clips must resolve. node tools/gate-ecology.mjs [url]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
// the 1500 rigs clone in over ~10 s; wait until every species has a loaded rig
await page.waitForFunction('Object.keys(window.__g.game.animAudit()).length >= 11', null, { timeout: 40000 }).catch(() => {})
// WAIT FOR THE WHOLE ROSTER BEFORE AUDITING IT. The audit loop below runs one
// check per species it can see, so a species whose eager rig clone had not
// landed yet silently produced one FEWER CHECK — no FAIL, no SKIP, just 43
// instead of 44 (spotted M64 by comparing a local run against the same commit
// on the deployment, and now impossible to miss: tools/gates.mjs fails a gate
// that runs short of its baseline).
await page.waitForFunction(() => Object.keys(window.__g.game.animAudit()).length >= 14, null, { timeout: 60000 }).catch(() => {})
const audit = await page.evaluate(() => window.__g.game.animAudit())
const species = Object.keys(audit)
check(species.length >= 11, `${species.length} species loaded`)
// A ONE-CLIP species (M52: dilo, sauropelta, spino) deliberately has one
// action doing every job at different rates — it has no walk/run/attack clips
// to resolve, and its death is M41's procedural topple. What matters for those
// is that the single action EXISTS.
const ONE_CLIP = new Set(['dilo', 'sauropelta', 'spino'])
for (const [id, a] of Object.entries(audit)) {
  if (ONE_CLIP.has(id)) {
    check(a.slots.idle !== null, `${id}: its one clip resolved (${a.slots.idle})`)
    continue
  }
  const missing = Object.entries(a.slots).filter(([, v]) => v === null).map(([k]) => k)
  check(missing.length === 0, `${id}: every clip slot resolved${missing.length ? ' — missing ' + missing.join(',') : ''}`)
}
check(Object.keys(audit).length >= 14, `the roster is ${Object.keys(audit).length} species with working rigs`)

// the three of them are real animals: they spawn, they are sized, they bleed
for (const sp of ONE_CLIP) {
  const idx = await page.evaluate((s2) => { const p = window.__g.player(); return window.__g.game.spawnDino(s2, p.x + 7, p.z - 7) }, sp)
  await page.waitForTimeout(2200)
  const st = await page.evaluate((k) => window.__g.game.dinoStates()[k], idx)
  const size = await page.evaluate((k) => window.__g.game.dinoHeight ? window.__g.game.dinoHeight(k) : null, idx)
  check(st && st.hp > 0, `${sp} spawns with ${st?.hp} hp`)
  check(size === null || size > 0.8, `${sp} is a real size (${size === null ? 'n/a' : size.toFixed(1) + ' m'})`)
  await page.evaluate((k) => window.__g.game.killDino(k), idx)
  await page.waitForTimeout(1800)
  const dead = await page.evaluate((k) => window.__g.game.dinoStates()[k], idx)
  check(dead.state === 'dead', `${sp} can be killed (topple covers its missing death clip)`)
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
// STEP AND ACT IN THE SAME EVALUATE, AND RETRY. A raptor moves, and this used
// to walk up to it, wait 300 ms, swing, wait 400 ms and feed — three wall-clock
// gaps for it to wander out of reach in. On a loaded machine the swing then
// missed, the noise provoked it, and the check reported "flee" as though
// taming were broken. Identical to the saddle race in gate-m4 (M64), and the
// same fix: no time passes inside one evaluate.
let tamed = 'never ran'
for (let attempt = 0; attempt < 6; attempt++) {
  tamed = await page.evaluate((i) => {
    const w = window.__g
    w.game.gotoDinoIndex(i)
    w.game.swing()      // creative: an instant KO
    w.game.interact()   // creative: an instant tame
    return w.game.dinoStates()[i].state
  }, pRaptor)
  if (tamed === 'tamed') break
  await page.waitForTimeout(500)
}
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
// POLL FOR THE BITE, and watch the tame CLOSE — do not guess how long it
// takes. M71 replaced a fixed 6 s window with a 20 s one, which is a longer
// bet, not a different kind of thing: 20 s of wall clock at load average 8
// is a handful of simulated seconds, and it lost in the full suite run right
// after the other five gates had heated the machine (`268 → 268 hp`), while
// passing standalone a minute later.
//
// So watch the thing itself. A bite needs the tame to reach the carno, and
// the distance between them is observable — if it is still shrinking the
// fight has not started yet and more time is the right answer; if it stalls
// at 30 m the tame is stuck and no amount of waiting will help. The failure
// now says WHICH of those happened instead of "hp unchanged".
const distNow = () => page.evaluate(([a, b2]) => {
  const g = window.__g
  const p1 = g.game.dinoPos(a), p2 = g.game.dinoPos(b2)
  return p1 && p2 ? Math.hypot(p1.x - p2.x, p1.z - p2.z) : Infinity
}, [pRaptor, foe])
let hpAfter = hpBefore
let closest = await distNow()
let stalled = 0
for (let i = 0; i < 45 && hpAfter >= hpBefore; i++) {
  await page.waitForTimeout(1000)
  hpAfter = await page.evaluate((k) => window.__g.game.dinoStates()[k].hp, foe)
  const d = await distNow()
  // "closing" counts as progress; 12 s with no new closest is a real stall
  if (d < closest - 0.5) { closest = d; stalled = 0 } else if (++stalled > 12) break
}
check(hpAfter < hpBefore,
  `the tame actually bites: the carno is ${hpBefore} → ${hpAfter} hp (closed to ${closest.toFixed(1)} m)`)


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

// LAZY MIXERS, AND THE INVARIANT THAT MAKES THEM SAFE (M60). A mixer with its
// bound actions costs ~0.8 MB an animal and there are ~200 of them, so they are
// built shortly BEFORE an animal wakes rather than when its rig is cloned. The
// saving is only allowed to exist while nothing drawable is ever without one:
// an animal with a rig and no mixer stands in its bind pose.
{
  const at = async (x, z) => {
    await page.evaluate(([px, pz]) => { window.__g.game.setGod(true); window.__g.teleport(px, pz) }, [x, z])
    await page.waitForTimeout(4000)
    return page.evaluate(() => window.__g.game.anim())
  }
  const beach = await at(0, 1560)
  check(beach.unanimated === 0, `nothing drawable is in its bind pose at the beach (${beach.withMixer}/${beach.dinos} animals hold a mixer)`)
  check(beach.unrigged === 0, `and nothing inside the draw distance is missing its rig (${beach.withRig} rigs)`)
  const wood = await at(-286, 793)
  check(wood.unanimated === 0, `nor at the wood line (${wood.withMixer} mixers)`)
  check(wood.unrigged === 0, `nor a rig there (${wood.withRig} rigs)`)
  const plain = await at(-250, 1040)
  check(plain.unanimated === 0, `nor at the plain (${plain.withMixer} mixers)`)
  check(plain.unrigged === 0, `nor a rig there (${plain.withRig} rigs)`)
  // and the point of the exercise: most animals never need either
  check(plain.withMixer < plain.dinos * 0.4, `most animals never build a mixer (${plain.withMixer} of ${plain.dinos})`)
  check(plain.withRig < plain.dinos * 0.4, `nor a skeleton (${plain.withRig} of ${plain.dinos})`)
}

await browser.close()
console.log(failed ? '\nGATE FAILED' : '\nGATE PASSED')
process.exit(failed ? 1 : 0)

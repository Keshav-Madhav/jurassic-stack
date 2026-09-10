// Gate: the island has a voice (M35).
//
// You cannot hear a headless browser, so the mixer keeps books: every one-shot
// that actually reached the speakers is counted by id, and every sample that
// failed to load is recorded. This drives the game — walks the beach, walks
// the wood, swings, chops, opens the pack, gets bitten — and checks that the
// right sounds came out, that the footstep followed the ground underfoot, and
// that nothing 404'd.
//   node tools/gate-sound.mjs [url]
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:4173'
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  // let the AudioContext run without a real click (the game still gates on a
  // gesture; this just stops Chrome suspending the context in a test)
  args: ['--use-gl=angle', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 160)))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
// the gesture the browser wants
await page.mouse.click(640, 400)
await page.waitForTimeout(1500)
const g = (expr) => page.evaluate(expr)
const sfx = () => g('window.__g.game.sfx()')

check((await sfx()).ready, 'the mixer started on the first gesture')

// --- footsteps follow the ground ---
await g('window.__g.game.setGod(true)')
const walk = async (x, z, secs) => {
  await page.evaluate(([px, pz]) => { const gg = window.__g; gg.teleport(px, pz); gg.setIntent(0, -4) }, [x, z])
  await page.waitForTimeout(secs * 1000)
  await g('window.__g.setIntent(0, 0)')
}
await walk(0, 1560, 4) // the spawn beach: sand
let s = await sfx()
const beachSteps = Object.entries(s.plays).filter(([k]) => k.startsWith('step-')).reduce((a, [, n]) => a + n, 0)
check(beachSteps >= 3, `walking makes footsteps (${beachSteps} on the beach)`)
const beachKind = await g('window.__g.game.ground()')
check(['sand', 'grass', 'dirt'].includes(beachKind), `the beach reads as ground the sampler knows (${beachKind})`)

// three grounds that really differ (verified with __g.game.ground(): the
// shoreline is sand, the wood floor is dirt, the crater is rock) — the claim
// under test is that the SAMPLE follows the ground, so the spots must too
const before = Object.values((await sfx()).plays).reduce((a, b) => a + b, 0)
await walk(0, 1620, 3) // shoreline: sand
await walk(-300, 700, 3) // wood floor: dirt
await walk(0, -1180, 3) // the crater: rock
const now = await sfx()
const grew = Object.values(now.plays).reduce((a, b) => a + b, 0) - before
const kinds = Object.keys(now.plays).filter((k) => k.startsWith('step-'))
check(grew > 0, `the wood line and the plain keep making footsteps (+${grew})`)
check(kinds.length >= 2, `the footstep follows the ground: heard ${kinds.join(', ')}`)

// --- the swing, and what it lands on ---
await g('window.__g.game.swing()')
await page.waitForTimeout(400)
s = await sfx()
check((s.plays['hit-punch'] ?? 0) > 0, 'a bare-handed swing thumps')

// chop a tree: stand at a node and swing
const node = await g('window.__g.game.nearestNodeInfo("tree")')
if (node) {
  await page.evaluate(([x, z]) => { const gg = window.__g; gg.teleport(x + 1.6, z); gg.setCam(-Math.PI / 2, 0) }, [node.x, node.z])
  await page.waitForTimeout(900)
  for (let i = 0; i < 4; i++) { await g('window.__g.game.swing()'); await page.waitForTimeout(500) }
  s = await sfx()
  check((s.plays['hit-wood'] ?? 0) + (s.plays.chop ?? 0) > 0, 'chopping a tree sounds like wood')
} else {
  console.log('SKIP no tree node found for the chopping check')
}

// --- the animals ---
const idx = await page.evaluate(() => { const p = window.__g.player(); return window.__g.game.spawnDino('raptor', p.x + 3, p.z - 2) })
// WAIT UNTIL THE ANIMAL IS THERE. A freshly spawned dino is not walkable-to
// the instant it exists, and on a loaded machine 2.5 s was not always enough:
// the gate then swung at empty air, and `hit-flesh` was satisfied by a wild
// body hitting the ground somewhere else on the island (Dino.onThud plays the
// same sample). The check passed, its neighbour failed, and neither was
// measuring what it said. Reach the animal first, and count DELTAS (M53).
let reached = false
for (let i = 0; i < 24 && !reached; i++) {
  reached = await page.evaluate((k) => window.__g.game.gotoDinoIndex(k), idx)
  if (!reached) await page.waitForTimeout(250)
}
check(reached, 'the spawned raptor is there to be walked up to')
await page.waitForTimeout(700)
const preHit = (await sfx()).plays
const fleshWas = preHit['hit-flesh'] ?? 0
const hurtWas = preHit['dino-hurt'] ?? 0
// step to the animal before EVERY swing: a raptor that wanders two metres
// while you wind up turns this check into a coin toss.
//
// AND PROVE THE BLOW LANDED ON *IT*, from the animal's own torpor — not from
// the sound. `hit-flesh` is played by three different things (a swing landing,
// harvesting a carcass, and any body hitting the ground anywhere via
// Dino.onThud), and the swing itself prefers a carcass in reach over a live
// animal. So a run could play five hit-flesh, zero dino-hurt, and look like a
// broken sound when nothing had been hit at all (M53 caught half of this; the
// other half surfaced in M71). The animal's torpor cannot be faked.
const torporOf = () => page.evaluate((k) => window.__g.game.dinoStates()[k]?.torpor ?? -1, idx)
const torpor0 = await torporOf()
for (let i = 0; i < 5; i++) {
  await page.evaluate((k) => window.__g.game.gotoDinoIndex(k), idx)
  await page.waitForTimeout(250)
  await g('window.__g.game.swing()')
  await page.waitForTimeout(450)
}
const torpor1 = await torporOf()
s = await sfx()
const flesh = (s.plays['hit-flesh'] ?? 0) - fleshWas
const hurt = (s.plays['dino-hurt'] ?? 0) - hurtWas
check(torpor1 > torpor0, `the swings actually landed on the raptor (torpor ${torpor0} → ${torpor1})`)
check(flesh >= 3, `hitting an animal lands in hide, not wood (${flesh} of 5 swings)`)
check(hurt >= 1, `the animal answers when it is hit (${hurt})`)

// --- the interface ---
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
s = await sfx()
check((s.plays['ui-open'] ?? 0) > 0 && (s.plays['ui-close'] ?? 0) > 0, 'the pack opens and closes with a sound')

// --- nothing missing ---
s = await sfx()
check(s.missing.length === 0, `every sample loaded (${s.missing.length ? s.missing.join(', ') : 'no misses'})`)
console.log(`  played: ${Object.entries(s.plays).map(([k, n]) => `${k}×${n}`).join(' · ')}`)

await browser.close()
console.log(failed ? '\nGATE FAILED' : '\nGATE PASSED')
process.exit(failed ? 1 : 0)

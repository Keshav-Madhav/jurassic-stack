// THE FIRST TEN MINUTES, PLAYED HONESTLY.
//
// Every other instrument in this project teleports, turns on god mode, and
// calls give() to fill the pack. That is right for testing a mechanism and
// useless for the only question that matters after M68 changed the critical
// path: CAN SOMEONE WHO WAKES ON THAT BEACH ACTUALLY GET STARTED?
//
// Yesterday a new player could craft a workbench and a bedroll from what they
// found on the sand. Now both are tablets in ruins — the workbench's is in the
// Holm glade, most of a kilometre inland. Every gate proves the mechanism
// works. None proves the OPENING still works.
//
// So this run is allowed:
//   setIntent / setCam  — the player's own legs and eyes, through the mover
//   swing / interact / craft — the exact functions the mouse and keyboard call
//   nearestNodeInfo, survival, count — LOOKING, which a player does for free
// and forbidden: teleport, setGod, setCreative, give, learnAll, hitNode.
//
// It reports a timeline in wall-clock seconds, because "how long until I can
// do anything" is the actual experience being measured.
//
//   node tools/qa-opening.mjs [url] [--budget=600]
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const url = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:4173'
const BUDGET = Number((args.find((a) => a.startsWith('--budget=')) ?? '--budget=600').slice(9))

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })

// a brand new island: no save, nothing learned, nothing in the pack
await page.evaluate(() => window.__g.game.wipeAndReload())
await page.waitForTimeout(2500)
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.waitForTimeout(2500)

const T0 = Date.now()
const at = () => (Date.now() - T0) / 1000
const timeline = []
const mark = (what) => { timeline.push([at(), what]); console.log(`  ${String(at().toFixed(0)).padStart(4)}s  ${what}`) }
const out = () => Date.now() - T0 > BUDGET * 1000

const g = (fn, arg) => page.evaluate(fn, arg)
const state = () => g(() => {
  const w = window.__g
  const p = w.player()
  return {
    x: +p.x.toFixed(1), z: +p.z.toFixed(1),
    wood: w.game.count('wood'), fiber: w.game.count('fiber'), stone: w.game.count('stone'),
    flint: w.game.count('flint'), berry: w.game.count('berry'),
    surv: w.game.survival(), engrams: w.game.engrams().read.length, hp: Math.round(w.game.hp()),
  }
})

/**
 * KEEP YOURSELF ALIVE. The first run of this tool walked 700 m to a tablet
 * without ever eating, starved, died, and respawned on the beach — which read
 * as "the walk is impossible" when it was really "the bot did not eat its
 * berries". A player eats. So does this now.
 */
let deaths = 0
let lastHp = 100
async function survive() {
  const r = await g(() => {
    const w = window.__g
    const s2 = w.game.survival()
    const hp = Math.round(w.game.hp())
    let ate = false, drank = false
    if (s2.food < 45 && w.game.eat()) ate = true
    if (s2.water < 45 && w.game.interact()) drank = true
    return { hp, food: Math.round(s2.food), water: Math.round(s2.water), ate, drank }
  })
  if (r.hp > lastHp + 20) { deaths++; mark(`DIED and respawned (${deaths})`) }
  lastHp = r.hp
  return r
}

/** Walk toward (tx,tz), looking where we are going. Real legs, real collisions. */
async function walkTo(tx, tz, stopAt = 2.2, secs = 120) {
  const t0 = Date.now()
  const trail = []
  // WALK ROUND IT, LIKE A PERSON (M71) — see the same note in qa-trek.mjs. The
  // capsule slides off a trunk perfectly well; a bot that re-aims dead at the
  // target every tick just presses back into the same tree for ever.
  let detour = 0
  let detourSide = 1
  let detours = 0
  for (;;) {
    if (out()) return 'budget'
    const r = await g(([x, z, det, side]) => {
      const w = window.__g
      const p = w.player()
      const dx = x - p.x, dz = z - p.z
      const d = Math.hypot(dx, dz) || 1
      let ux = dx / d, uz = dz / d
      if (det > 0) {
        const a = side * 1.31 // 75° off the line, still making ground forward
        const cx = Math.cos(a), sn = Math.sin(a)
        const rx = ux * cx - uz * sn, rz = ux * sn + uz * cx
        ux = rx; uz = rz
      }
      w.setIntent(ux * 8, uz * 8)
      w.setCam(Math.atan2(-ux, -uz), 0.06)
      return { x: p.x, z: p.z, d }
    }, [tx, tz, detour, detourSide])
    if (detour > 0) detour--
    if (r.d < stopAt) { await g(() => window.__g.setIntent(0, 0)); return 'there' }
    if (Date.now() - t0 > secs * 1000) { await g(() => window.__g.setIntent(0, 0)); return 'slow' }
    trail.push(r)
    if (trail.length % 12 === 0) await survive()
    if (trail.length > 14 && detour === 0) {
      const then = trail[trail.length - 14]
      if (Math.hypot(r.x - then.x, r.z - then.z) < 3) {
        detours++
        if (detours > 6) { await g(() => window.__g.setIntent(0, 0)); return 'stuck' }
        detour = 6
        detourSide = -detourSide
        trail.length = 0
      }
    }
    await page.waitForTimeout(320)
  }
}

/**
 * Walk to the nearest `kind` and swing until it gives up `want` of `item`.
 *
 * AIMING IS THE HARD PART, AND THE FIRST VERSION OF THIS TOOL GOT IT BACKWARDS.
 * The camera is on a boom BEHIND the player and always `lookAt`s their head, so
 * POSITIVE pitch swings the camera low and points the crosshair UP, and
 * `PITCH_MAX` is 0.55. Sweeping 0 → 1.4 (as the first run did) therefore aims
 * at the sky and clamps, and it reported that nothing on the ground could be
 * harvested at all — a false alarm that took a straight-line ray probe to
 * disprove. Ground cover needs NEGATIVE pitch, most of the way to -1.25.
 *
 * So rather than guess an angle, do what a person does: sweep the look until
 * the thing is genuinely under the crosshair (`aimNode`), then swing.
 */
async function harvest(kind, item, want, tries = 10) {
  for (let i = 0; i < tries; i++) {
    if (out()) return false
    const have = await g((it) => window.__g.game.count(it), item)
    if (have >= want) return true
    const node = await g((k) => window.__g.game.nearestNodeInfo(k), kind)
    if (!node) return false
    const how = await walkTo(node.x, node.z, 1.6, 45)
    if (how === 'budget') return false
    let swung = false
    for (let pitch = -1.2; pitch <= 0.4 && !out(); pitch += 0.08) {
      const onIt = await g(([x, z, pi, k]) => {
        const w = window.__g
        const p = w.player()
        w.setCam(Math.atan2(-(x - p.x), -(z - p.z)), pi)
        return null
      }, [node.x, node.z, pitch, kind])
      void onIt
      await page.waitForTimeout(70)
      const aim = await g(() => window.__g.game.aimNode())
      if (!aim || aim.kind !== kind) continue
      // it is under the crosshair — work
      swung = true
      for (let sw = 0; sw < 8; sw++) {
        await g(() => window.__g.game.swing())
        await page.waitForTimeout(380)
        if ((await g((it) => window.__g.game.count(it), item)) >= want) return true
        const still = await g(() => window.__g.game.aimNode())
        if (!still || still.kind !== kind) break
      }
      break
    }
    if (!swung && i > 2) return false
  }
  return (await g((it) => window.__g.game.count(it), item)) >= want
}

console.log(`\nTHE FIRST ${Math.round(BUDGET / 60)} MINUTES — no god mode, no teleport, no give()\n`)
const start = await state()
console.log(`  waking at ${start.x}, ${start.z} with ${start.wood} wood, ${start.fiber} fiber, ${start.stone} stone\n`)

// 1. the very first thing: something to chop with
await harvest('sticks', 'wood', 2)
await harvest('pebbles', 'stone', 2)
if (await g(() => window.__g.game.count('flint') > 0)) mark('found flint')
await harvest('bush', 'fiber', 6)
if (await g(() => window.__g.game.craft('hatchet'))) mark('FIRST TOOL — a hatchet')
else if (!out()) {
  const p1 = await state()
  mark(`no hatchet yet (needs wood 1 flint 1 fiber 4 — has ${p1.wood}/${p1.flint}/${p1.fiber})`)
}

// 2. water and food, the two things that kill you first
const s1 = await state()
if (s1.surv.water < 96) {
  // walk south to the sea — the beach is a few steps away
  await walkTo(start.x, start.z + 60, 6, 60)
  await g(() => window.__g.game.interact())
  await page.waitForTimeout(400)
  if ((await state()).surv.water > s1.surv.water) mark('drank')
}
if (await harvest('bush', 'berry', 3)) mark('food in the pack (berries)')

// 3. a fire — the first real milestone
await harvest('sticks', 'wood', 6)
await harvest('pebbles', 'stone', 4)
await harvest('stones', 'stone', 4)
if (await g(() => window.__g.game.craft('campfire'))) mark('FIRE — a campfire crafted')
else {
  const p2 = await state()
  mark(`no fire yet (needs wood 6 stone 4 fiber 2 — has ${p2.wood}/${p2.stone}/${p2.fiber})`)
}

// 4. NOW the M68 question: the Wayfinder should be sending a new player to a
//    tablet, and getting there should not be the whole session
const way = await g(() => {
  const w = window.__g
  const p = w.player()
  const t = w.game.engrams()
  return { read: t.read.length, at: [Math.round(p.x), Math.round(p.z)] }
})
console.log(`\n  the pack after the beach: ${JSON.stringify(await state())}`)
console.log(`  tablets read so far: ${way.read}\n`)

// follow it: press N, read the toast, walk that way. The nearest tablet in the
// opening is what the Wayfinder points at (M68).
const target = await g(() => {
  const w = window.__g
  const p = w.player()
  let best = null
  for (const t of w.game.tabletSites()) {
    const d = Math.hypot(t.x - p.x, t.z - p.z)
    if (!best || d < best.d) best = { ...t, d }
  }
  return best
})
if (target) {
  console.log(`  nearest tablet is ${target.tag}, ${Math.round(target.d)} m away — walking\n`)
  const how = await walkTo(target.x, target.z, 7, 320)
  const after = await g(() => window.__g.game.engrams())
  if (after.read.length > 0) mark(`FIRST TABLET — ${after.known.join(', ')} (${how})`)
  else mark(`did NOT reach a tablet (${how})`)
} else {
  console.log('  (could not resolve a tablet site from the page)')
}

const end = await state()
console.log(`\n  ended at ${end.x}, ${end.z} · hp ${end.hp} food ${Math.round(end.surv.food)} water ${Math.round(end.surv.water)} · ${end.engrams} tablet(s) · ${deaths} death(s)`)
console.log(`\nTIMELINE`)
for (const [t, what] of timeline) console.log(`  ${String(t.toFixed(0)).padStart(4)}s  ${what}`)
if (!timeline.some((r) => r[1].startsWith('FIRE'))) console.log('  !! never made fire')
if (!timeline.some((r) => r[1].startsWith('FIRST TABLET'))) console.log('  !! never reached a tablet')
if (errors.length) console.log(`\nPAGE ERRORS:\n  ${errors.slice(0, 6).join('\n  ')}`)
await browser.close()

// M4 gate: the complete core loop, end to end, through the same verbs the
// input layer calls — gather → craft → build a hut → knock out → tame →
// saddle → ride (assert real movement) → dismount → save → reload → assert
// state survived. Fresh save each run (wipes slot 0 first).
//   npm run build && npx vite preview --port 4173 &
//   node tools/gate-m4.mjs [url]
import { chromium } from 'playwright-core'
import { wipeAndReload } from './_page.mjs'

const url = process.argv[2] ?? 'http://localhost:4173'
let failed = false
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`)
  if (!ok) failed = true
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => { console.error('page error:', e.message); failed = true })

const ready = async () => {
  await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
  await page.waitForTimeout(1200)
}
const g = (expr) => page.evaluate(expr)

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await ready()
// fresh world (also proves reload works even before the loop starts)
await wipeAndReload(page)
await ready()
// The homestead tier is tablet-gated since M68 and this gate is about BUILDING
// a hut, not about finding the recipe for one. Grant the tablets a player
// would have walked to; gate-homestead owns the finding.
await page.evaluate(() => window.__g.game.learnAll())

// ---------- gather ----------
for (const kind of ['tree', 'rock', 'bush']) {
  const found = await page.evaluate((k) => window.__g.game.gotoNearest(k), kind)
  check(found, `found a ${kind} to harvest`)
  for (let i = 0; i < 14; i++) {
    await g('window.__g.game.swing()')
    await page.waitForTimeout(520)
  }
}
const wood = await g('window.__g.game.count("wood")')
const stone = await g('window.__g.game.count("stone")')
const berry = await g('window.__g.game.count("berry")')
const fiber = await g('window.__g.game.count("fiber")')
check(wood >= 2, `gathered wood (${wood})`)
check(stone >= 2, `gathered stone (${stone})`)
check(berry >= 2, `gathered berries (${berry})`)
// onboarding: the wake hint showed, and hints are remembered
const hints = await g('window.__g.game.hintsSeen()')
check(hints.includes('wake'), `onboarding: the wake hint fired (${hints.join(',')})`)
check(fiber >= 2, `gathered fiber (${fiber})`)

// ---------- craft (top up mats so the whole chain is testable in one run) ----------
// (hide since M21: the saddle is fiber + hide + wood — the hunt feeds the saddle)
await g('window.__g.game.give("wood", 70); window.__g.game.give("stone", 24); window.__g.game.give("fiber", 80); window.__g.game.give("flint", 6); window.__g.game.give("berry", 14); window.__g.game.give("hide", 6)')
for (const item of ['hatchet', 'spear', 'foundation', 'wall', 'ceiling', 'campfire', 'workbench']) {
  const ok = await page.evaluate((i) => window.__g.game.craft(i), item)
  check(ok, `crafted ${item}`)
}
// the saddle is a homestead recipe since M39: it wants a bench in reach, so
// the loop is now gather → craft → BUILD A BENCH → saddle → tame → ride
check((await page.evaluate(() => window.__g.game.craft('saddle'))) === false, 'the saddle refuses without a workbench')
await g('window.__g.game.selectItem("workbench"); window.__g.game.swing()')
await page.waitForTimeout(600)
const benchPiece = (await g('window.__g.game.pieceList()')).find((p) => p.kind === 'workbench')
check(benchPiece !== undefined, 'the workbench is placed')
await page.evaluate(([x, z]) => window.__g.teleport(x, z + 1.5), [benchPiece.x, benchPiece.z])
await page.waitForTimeout(800)
check(await page.evaluate(() => window.__g.game.craft('saddle')), 'crafted saddle at the bench')

// ---------- build a hut: foundation, wall, ceiling, campfire ----------
await g('window.__g.setIntent(0,0)')
await g('const sp = window.__g.game.spawn(); window.__g.teleport(sp.x + 30, sp.z - 80)')
await page.waitForTimeout(300)
// A HUT IS FOUR PIECES THAT HAVE TO MEET (M76). This used to aim once and
// then swing four times, trusting all four to land in the same 3 m cell —
// and a wall needs a foundation in ITS OWN cell, so the moment M75's ranges
// moved the ground a few centimetres the aim crossed a cell boundary and
// the wall and the ceiling stopped attaching.
//
// Worse, nothing said so: the check was `pieces() >= expected` against a
// running count, and a workbench placed earlier in this gate had already
// pushed the count up — so a wall that never appeared still read PASS. It
// asserts the piece BY KIND now, which is the thing the sentence claims.
const kinds = () => page.evaluate(() => window.__g.game.pieceList().map((p) => p.kind))
{
  await page.evaluate(() => { window.__g.game.selectItem('foundation'); window.__g.game.swing() })
  await page.waitForTimeout(600)
  check((await kinds()).includes('foundation'), 'placed the foundation where the crosshair was')
  // ...then build ON it, at its own cell centre, instead of hoping the aim
  // has not drifted. `placeAt` is the same `building.place` the swing calls.
  const f = (await page.evaluate(() => window.__g.game.pieceList())).find((p) => p.kind === 'foundation')
  for (const item of ['wall', 'ceiling', 'campfire']) {
    const ok = await page.evaluate(([it, x, z]) => window.__g.game.placeAt(it, x, z), [item, f.x, f.z])
    await page.waitForTimeout(400)
    check(ok !== false && (await kinds()).includes(item), `placed the ${item} on it`)
  }
  const built = await kinds()
  check(['foundation', 'wall', 'ceiling', 'campfire'].every((k) => built.includes(k)),
    `the hut stands: ${built.join(' + ')}`)
  // PUT THE BUILDING MATERIAL AWAY. A placeable in hand makes every swing a
  // PLACEMENT, so the checks further down that expect a swing to land a blow
  // quietly stopped landing one. The old loop hid this by ending on the last
  // campfire in the pack, which cleared the hand by running out.
  await page.evaluate(() => window.__g.game.selectItem('hatchet'))
}

// ---------- every rig at its species height ----------
// (a dormant rig calibrated while detached read stale bone matrices and
// mammoths spawned the size of the island — user screenshot 20, M18). Pose
// swings the measure ±40%; the bug was ×50–100
// (±100%: a rearing apatosaurus mid-attack measures 1.8× its idle height; the bug was ×50)
const sizes = await g('window.__g.game.sizeAudit(1.0)')
check(sizes.length === 0, `every loaded rig within ±100% of its species height${sizes.length ? ' — offenders: ' + JSON.stringify(sizes.slice(0, 4)) : ''}`)

// ---------- tame: punch to KO, feed to tame ----------
// a raptor specifically: since the 1500-dino population, the nearest idle dino
// on the spawn beach is as often a trike, whose torpor 45 punches can't reach
// a fresh raptor at our feet (the beach pack may be off hunting pachys or
// fleeing a trike since the ecology — M19; the taming mechanic is what's under test)
const ourRaptor = await page.evaluate(() => { const p = window.__g.player(); return window.__g.game.spawnDino('raptor', p.x + 2.5, p.z - 1) })
await page.waitForTimeout(1500)
check(await page.evaluate((i) => window.__g.game.gotoDinoIndex(i), ourRaptor), 'found a wild raptor')
await g('window.__g.game.select(8)') // empty slot = fists (torpor route)
// invulnerable for the punching: the raptor punches back (16 a bite since the
// M19 rebalance) and killed the player mid-loop; the respawn scattered the
// punches over three animals
await g('window.__g.game.setGod(true)')
for (let i = 0; i < 45; i++) { // 160 torpor / 8 per punch + 2.2/s drain over the loop needs headroom
  await page.evaluate((i) => window.__g.game.gotoDinoIndex(i), ourRaptor) // stay on ONE animal, whatever it does
  await g('window.__g.game.swing()')
  await page.waitForTimeout(520)
  const st = await page.evaluate((i) => window.__g.game.dinoStates()[i].state, ourRaptor)
  if (st === 'ko') break
}
await g('window.__g.game.setGod(false)')
check((await page.evaluate((i) => window.__g.game.dinoStates()[i].state, ourRaptor)) === 'ko', 'raptor knocked out')
await page.evaluate((i) => window.__g.game.gotoDinoIndex(i), ourRaptor)
for (let i = 0; i < 14; i++) {
  await g('window.__g.game.interact()')
  await page.waitForTimeout(250)
  if (await g('window.__g.game.dinoStates().some(d => d.state === "tamed")')) break
}
check(await g('window.__g.game.dinoStates().some(d => d.state === "tamed")'), 'raptor tamed')

// ---------- saddle + ride ----------
// STEP AND ACT IN THE SAME EVALUATE. A tame follows you, so it can walk out of
// reach in the wall-clock gap between `gotoDinoIndex` and `interact` — and on
// a loaded machine that gap is long enough to matter: this failed once in nine
// runs, at a load average of 12 (M64). Inside one evaluate no time passes at
// all, and six tries covers the rest.
// ...and REPORT when it does not work. This pair failed twice inside the full
// suite at load average 28 and passed alone every time — which is exactly the
// excuse that hid a real harness bug in M53, so the gate now says what it saw
// (M65): where the animal was, what state it was in, and whether the player
// was actually within reach when interact() fired.
const stepAndAct = (idx) => page.evaluate((i) => {
  const g = window.__g
  g.game.gotoDinoIndex(i)
  const before = g.player()
  const d = g.game.dinoStates()[i]
  g.game.interact()
  return d ? { state: d.state, saddled: d.saddled, dist: +Math.hypot(d.x - before.x, d.z - before.z).toFixed(2) } : null
}, idx)
let lastSeen = null
for (let i = 0; i < 6; i++) {
  lastSeen = await stepAndAct(ourRaptor)
  await page.waitForTimeout(250)
  if (await g('window.__g.game.dinoStates().some(d => d.saddled)')) break
}
check(await g('window.__g.game.dinoStates().some(d => d.saddled)'), `raptor saddled${await g('window.__g.game.dinoStates().some(d => d.saddled)') ? '' : ` — last saw ${JSON.stringify(lastSeen)}`}`)
for (let i = 0; i < 6; i++) {
  lastSeen = await stepAndAct(ourRaptor) // mount
  await page.waitForTimeout(200)
  if (await g('window.__g.game.riding()')) break
}
check(await g('window.__g.game.riding()'), `mounted${await g('window.__g.game.riding()') ? '' : ` — last saw ${JSON.stringify(lastSeen)}`}`)
// ride out: the mount stands where it was tamed, so a tree or rock may block
// one heading — try the four in turn
let rode = 0
let after
for (const [ix, iz] of [[0, -9], [9, 0], [0, 9], [-9, 0]]) {
  const before = await g('window.__g.player()')
  await g(`window.__g.setIntent(${ix}, ${iz})`)
  await page.waitForTimeout(3000)
  await g('window.__g.setIntent(0, 0)')
  after = await g('window.__g.player()')
  rode = Math.hypot(after.x - before.x, after.z - before.z)
  if (rode > 15) break
}
check(rode > 15, `rode the raptor ${rode.toFixed(0)}m`)
check(Number.isFinite(after.y) && after.y > -50, `ride stayed above ground (y=${after.y.toFixed(1)})`)
await g('window.__g.game.interact()') // dismount
await page.waitForTimeout(200)
check(!(await g('window.__g.game.riding()')), 'dismounted')

// ---------- M48b: gathering has feel ----------
// every swing pays, the thing you hit looks hit, and it falls at the end
{
  const t = await g('window.__g.game.nearestNodeInfo("tree")')
  const before = await page.evaluate(([x, z]) => window.__g.game.nodeState('tree', x, z), [t.x, t.z])
  check(before.maxHp >= 5, `a tree takes ${before.maxHp} swings, not three`)
  const wood0 = await g('window.__g.game.count("wood")')
  await page.evaluate(([x, z]) => window.__g.game.hitNode('tree', 1, x, z), [t.x, t.z])
  const mid = await page.evaluate(([x, z]) => window.__g.game.nodeState('tree', x, z), [t.x, t.z])
  check(mid.wound > 0 && mid.drawnTint < before.drawnTint, `a struck tree darkens (tint ${before.drawnTint} → ${mid.drawnTint})`)
  // ...AND NO OTHER TREE DOES. Since M58 every cell of a kind shares ONE
  // geometry and ONE material set, which is only safe because damage is
  // per-INSTANCE colour and never material state. If that were ever to change,
  // hitting one tree would darken every tree on the island — so count how many
  // instance colours in the whole scatter actually moved. It should be a
  // handful (this trunk's submeshes), not hundreds.
  {
    const snap = () => page.evaluate(() => {
      const out = []
      window.__g.scene.getObjectByName('scatter').traverse((o) => {
        if (o.isInstancedMesh && o.instanceColor) out.push(Array.from(o.instanceColor.array.slice(0, o.count * 3)))
      })
      return out
    })
    const a = await snap()
    await page.evaluate(([x, z]) => window.__g.game.hitNode('tree', 1, x, z), [t.x, t.z])
    await page.waitForTimeout(300)
    const b = await snap()
    let moved = 0
    for (let m = 0; m < Math.min(a.length, b.length); m++) {
      const A = a[m], B = b[m]
      for (let i = 0; i < Math.min(A.length, B.length); i += 3) {
        if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) moved++
      }
    }
    check(moved > 0 && moved < 12, `one blow moves ONE tree's instance colours, not the island's (${moved} instances)`)
  }
  check((await g('window.__g.game.count("wood")')) > wood0, 'and the swing already paid a chip of wood')
  await page.evaluate(([x, z]) => window.__g.game.hitNode('tree', 9, x, z), [t.x, t.z])
  const felled = await page.evaluate(([x, z]) => window.__g.game.nodeState('tree', x, z), [t.x, t.z])
  check(!felled.alive, 'the felling blow kills it')
  check((await g('window.__g.game.hitsDebug()')).falling > 0, 'and it is FALLING, not gone')
  await page.waitForTimeout(2000)
  check((await g('window.__g.game.hitsDebug()')).falling === 0, 'the fall finishes and clears itself')
}

// the camera answers a blow, and settles back to exactly where it was
{
  const t2 = await g('window.__g.game.nearestNodeInfo("tree")')
  await page.evaluate(([x, z]) => { const gg = window.__g; gg.teleport(x + 2.6, z); gg.setCam(-Math.PI / 2, 0) }, [t2.x, t2.z])
  await page.waitForTimeout(1200)
  const at = () => page.evaluate(() => { const c = window.__g.cam; return [c.position.x, c.position.y, c.position.z] })
  const still = await at()
  await g('window.__g.game.swing()')
  await page.waitForTimeout(45)
  const kicked = await at()
  const d = Math.hypot(kicked[0] - still[0], kicked[1] - still[1], kicked[2] - still[2])
  check(d > 0.01, `the camera kicks when you land a blow (${d.toFixed(3)} m)`)
  await page.waitForTimeout(900)
  const back = await at()
  const d2 = Math.hypot(back[0] - still[0], back[1] - still[1], back[2] - still[2])
  check(d2 < 0.004, `and settles back to where it was (${d2.toFixed(4)} m)`)
}

// ---------- save / reload ----------
const savedWood = await g('window.__g.game.count("wood")')
await page.evaluate(() => window.__g.game.save()) // explicit: pagehide races reload
await page.waitForTimeout(200)
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 })
await ready()
check((await g('window.__g.game.count("wood")')) === savedWood, `inventory survived reload (wood=${savedWood})`)
check((await g('window.__g.game.pieces()')) >= 3, 'structures survived reload')
// the animals are restored and re-spawned after `ready`, so reading this
// once on the very next line is a bet on how quickly that finished — it
// lost under the full suite's load while passing standalone
const tameBack = await page
  .waitForFunction('window.__g.game.dinoStates().some(d => d.state === "tamed")', null, { timeout: 20000 })
  .then(() => true)
  .catch(() => false)
check(tameBack, 'tame survived reload')

await page.screenshot({ path: 'shots/gate-m4-final.png' })
await browser.close()
console.log(failed ? '\nGATE FAILED' : '\nGATE PASSED')
process.exit(failed ? 1 : 0)

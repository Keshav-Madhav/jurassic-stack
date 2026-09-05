// M4 gate: the complete core loop, end to end, through the same verbs the
// input layer calls — gather → craft → build a hut → knock out → tame →
// saddle → ride (assert real movement) → dismount → save → reload → assert
// state survived. Fresh save each run (wipes slot 0 first).
//   npm run build && npx vite preview --port 4173 &
//   node tools/gate-m4.mjs [url]
import { chromium } from 'playwright-core'

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

await page.goto(url, { waitUntil: 'networkidle' })
await ready()
// fresh world (also proves reload works even before the loop starts)
await page.evaluate(() => window.__g.game.wipeAndReload()).catch(() => {})
await page.waitForTimeout(500)
await ready()

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
check(fiber >= 2, `gathered fiber (${fiber})`)

// ---------- craft (top up mats so the whole chain is testable in one run) ----------
await g('window.__g.game.give("wood", 40); window.__g.game.give("stone", 12); window.__g.game.give("fiber", 60); window.__g.game.give("flint", 6); window.__g.game.give("berry", 14)')
for (const item of ['hatchet', 'spear', 'foundation', 'wall', 'ceiling', 'saddle', 'campfire']) {
  const ok = await page.evaluate((i) => window.__g.game.craft(i), item)
  check(ok, `crafted ${item}`)
}

// ---------- build a hut: foundation, wall, ceiling, campfire ----------
await g('window.__g.setIntent(0,0)')
await g('const sp = window.__g.game.spawn(); window.__g.teleport(sp.x + 30, sp.z - 80)')
await page.waitForTimeout(300)
let expected = 0
for (const item of ['foundation', 'wall', 'ceiling', 'campfire']) {
  const placed = await page.evaluate((it) => {
    const gg = window.__g.game
    if (!gg.selectItem(it)) return -1
    gg.swing()
    return gg.pieces()
  }, item)
  expected++
  await page.waitForTimeout(600)
  check(placed >= expected, `placed ${item} (pieces=${placed})`)
}

// ---------- every rig at its species height ----------
// (a dormant rig calibrated while detached read stale bone matrices and
// mammoths spawned the size of the island — user screenshot 20, M18). Pose
// swings the measure ±40%; the bug was ×50–100
const sizes = await g('window.__g.game.sizeAudit(0.6)')
check(sizes.length === 0, `every loaded rig within ±60% of its species height${sizes.length ? ' — offenders: ' + JSON.stringify(sizes.slice(0, 4)) : ''}`)

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
await g('window.__g.game.gotoDino("tamed")')
await g('window.__g.game.interact()') // saddle
await page.waitForTimeout(200)
check(await g('window.__g.game.dinoStates().some(d => d.saddled)'), 'raptor saddled')
await g('window.__g.game.interact()') // mount
await page.waitForTimeout(200)
check(await g('window.__g.game.riding()'), 'mounted')
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

// ---------- save / reload ----------
const savedWood = await g('window.__g.game.count("wood")')
await page.evaluate(() => window.__g.game.save()) // explicit: pagehide races reload
await page.waitForTimeout(200)
await page.reload({ waitUntil: 'networkidle' })
await ready()
check((await g('window.__g.game.count("wood")')) === savedWood, `inventory survived reload (wood=${savedWood})`)
check((await g('window.__g.game.pieces()')) >= 3, 'structures survived reload')
check(await g('window.__g.game.dinoStates().some(d => d.state === "tamed")'), 'tame survived reload')

await page.screenshot({ path: 'shots/gate-m4-final.png' })
await browser.close()
process.exit(failed ? 1 : 0)

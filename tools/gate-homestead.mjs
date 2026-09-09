// Gate: the homestead (M39) — a workbench that gates the better recipes, and
// a chest that actually holds things across a reload.
//   node tools/gate-homestead.mjs [url]
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:4173'
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 160)))
const ready = () => page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.goto(url, { waitUntil: 'networkidle' })
await ready()
await page.evaluate(() => window.__g.game.wipeAndReload()).catch(() => {})
await page.waitForTimeout(1500)
await ready()
// The homestead tier is tablet-gated since M68, and the checks BELOW are about
// the tier itself — the bench rule, the chest, the save — not about finding it.
// Grant the tablets a player would have walked to; the tablets get their own
// section at the foot of this file, starting from a wiped island.
await page.waitForTimeout(1500)
await page.evaluate(() => window.__g.game.learnAll())
const g = (expr) => page.evaluate(expr)

// somewhere flat, and enough of everything
await g('window.__g.game.setGod(true); window.__g.teleport(-120, 1300)')
await page.waitForTimeout(1200)
await g('["wood","stone","fiber","hide"].forEach((i) => window.__g.game.give(i, 60))')

// --- the tier gate: a saddle wants a workbench ---
check((await g('window.__g.game.craft("saddle")')) === false, 'a saddle refuses to be made in your hands')
check((await g('window.__g.game.count("saddle")')) === 0, 'and none appeared')

await g('window.__g.game.selectItem("workbench")')
await page.waitForTimeout(200)
check((await g('window.__g.game.craft("workbench")')) !== false || (await g('window.__g.game.count("workbench")')) > 0, 'the workbench itself needs no workbench')
await g('window.__g.game.selectItem("workbench"); window.__g.game.swing()')
await page.waitForTimeout(600)
const bench = (await g('window.__g.game.pieceList()')).find((p) => p.kind === 'workbench')
check(bench !== undefined, `the workbench is placed${bench ? ` at ${bench.x}, ${bench.z}` : ''}`)
// pieces land where you AIM, a few metres ahead: walk to it, as a player would
await page.evaluate(([x, z]) => window.__g.teleport(x, z + 1.5), [bench.x, bench.z])
await page.waitForTimeout(900)
check(await g('window.__g.game.nearBench()'), 'standing at it, the bench is in reach')
check((await g('window.__g.game.craft("saddle")')) === true, 'with a bench in reach, the saddle is made')

// --- the chest holds things ---
check((await g('window.__g.game.craft("chest")')) === true, 'the chest is a bench recipe too')
await g('window.__g.game.selectItem("chest"); window.__g.game.swing()')
await page.waitForTimeout(600)
const chestPiece = (await g('window.__g.game.pieceList()')).find((p) => p.kind === 'chest')
check(chestPiece !== undefined, 'the chest is placed')
await page.evaluate(([x, z]) => window.__g.teleport(x, z + 1.2), [chestPiece.x, chestPiece.z])
await page.waitForTimeout(900)
check((await g('window.__g.game.chestAt()')) !== null, 'standing at it, the chest is open to you')

const woodBefore = await g('window.__g.game.count("wood")')
await g('window.__g.game.chestMove("wood", "in", true)')
await page.waitForTimeout(300)
const stored = await g('window.__g.game.chestAt()')
check((await g('window.__g.game.count("wood")')) === 0 && stored.some(([id, n]) => id === 'wood' && n === woodBefore),
  `all ${woodBefore} wood went into the chest`)

await g('window.__g.game.chestMove("wood", "out", false)')
await page.waitForTimeout(300)
check((await g('window.__g.game.count("wood")')) === 1, 'one comes back out on a click')

// --- and it survives a reload ---
await page.evaluate(() => window.__g.game.save())
await page.waitForTimeout(400)
await page.reload({ waitUntil: 'networkidle' })
await ready()
await page.evaluate(([x, z]) => { window.__g.game.setGod(true); window.__g.teleport(x, z + 1.2) }, [chestPiece.x, chestPiece.z])
await page.waitForTimeout(1800)
const after = await g('window.__g.game.chestAt()')
const woodInChest = after ? (after.find(([id]) => id === 'wood')?.[1] ?? 0) : 0
check(woodInChest === woodBefore - 1, `the chest still holds ${woodBefore - 1} wood after a reload (found ${woodInChest})`)

// A FENCE THE ANIMALS CAN SEE (M65, user-reported: "dinos being able to go
// through fences"). Built pieces got a RAPIER collider, which stops the player
// — the only physics body in the game. Dinos do not use physics at all: they
// steer around obstacles.ts, which until now only scatter registered into. So
// every wall and fence ever built was invisible to every animal, and a pen was
// decoration. Ruin columns had the identical hole, and obstacles.ts's own
// comment has claimed to cover them since M25.
{
  const spot = await page.evaluate(() => {
    const g = window.__g
    g.game.setGod(true); g.game.setCreative(true); g.teleport(-286, 793)
    const p = g.player()
    return { x: p.x + 6, z: p.z }
  })
  await page.waitForTimeout(1200)
  const before = await page.evaluate(([x, z]) => window.__g.game.obstacleNear(x, z, 5), [spot.x, spot.z])
  check(before === null, 'open ground is open ground to an animal')
  const placed = await page.evaluate(([x, z]) => {
    window.__g.game.give('fence', 4)
    return window.__g.game.placeAt('fence', x, z)
  }, [spot.x, spot.z])
  check(!!placed, 'a fence goes up')
  const after = await page.evaluate(([x, z]) => window.__g.game.obstacleNear(x, z, 5), [spot.x, spot.z])
  check(after !== null && after.d < 1.5, `and the animals can now see it (${after ? after.d + ' m' : 'NOTHING — they walk through it'})`)
  // the ruins have the same hole
  const site = (await page.evaluate(() => window.__g.game.keystoneSites()))[0]
  await page.evaluate(([x, z]) => window.__g.teleport(x, z + 14), [site.x, site.z])
  await page.waitForTimeout(3500)
  const col = await page.evaluate(([x, z]) => window.__g.game.obstacleNear(x, z, 12), [site.x, site.z])
  check(col !== null, `a standing ruin column blocks them too (${site.tag})`)
}

// THE RUINS ARE THE TECH TREE (M68). The homestead tier is FOUND, not levelled
// into: a tablet at a ruin teaches one recipe, permanently. Twenty-three ruins
// stood on this island and eleven of them held nothing at all.
{
  const eng = () => page.evaluate(() => window.__g.game.engrams())
  const canMake = (id) => page.evaluate((i) => {
    const g = window.__g
    for (const r of ['wood', 'fiber', 'stone', 'hide', 'fur', 'flint']) g.game.give(r, 99)
    return g.game.craft(i)
  }, id)

  // a fresh island knows nothing
  await page.evaluate(() => window.__g.game.wipeAndReload())
  await page.waitForTimeout(2500)
  await ready()
  await page.waitForTimeout(3000)
  const fresh = await eng()
  check(fresh.read.length === 0 && fresh.total === 7, `a fresh island has read no tablets (0 of ${fresh.total})`)
  check((await canMake('fence')) === false, 'and cannot make a fence it has never seen drawn')
  // ...but the FIRST tier is never gated: a survival game that will not let you
  // make fire in your first minutes is a puzzle, not a world
  check((await canMake('campfire')) === true, 'the first tier is free (a campfire)')
  check((await canMake('spear')) === true, 'and a spear')

  // walk to the tablet that teaches the fence — dune-shrine, in the west dunes
  await page.evaluate(() => { window.__g.game.setGod(true); window.__g.teleport(-700, 1283.5) })
  await page.waitForTimeout(4000)
  const after = await eng()
  // the inscription, read BEFORE anything else writes a toast — crafting puts
  // "Crafted Fence" over the top of it
  const said = await page.evaluate(() => document.getElementById('hud-toast')?.textContent ?? '')
  check(after.read.includes('dune-shrine'), 'standing at a ruin reads its tablet')
  check(after.known.includes('fence'), 'and the recipe is known')
  check(said.includes('🗿') && said.length > 40, `the tablet says something worth reading ("${said.slice(0, 46)}…")`)
  check((await canMake('fence')) === true, 'and now the fence can be made')

  // it survives a reload — an engram is permanent
  await page.evaluate(() => window.__g.game.save())
  await page.waitForTimeout(600)
  await page.reload({ waitUntil: 'networkidle' })
  await ready()
  await page.waitForTimeout(3000)
  const reloaded = await eng()
  check(reloaded.read.includes('dune-shrine') && reloaded.known.includes('fence'), 'a tablet stays read across a reload')

  // AND THE ONE THAT MATTERS FOR ANYONE ALREADY PLAYING: a save written before
  // tablets existed has no `engrams` key at all. That player could craft a
  // saddle yesterday, so they must be able to today — taking a tier away from
  // an existing save because of an update is never the right call.
  await page.evaluate(async () => {
    const req = indexedDB.open('jurassic-stack', 1)
    const db = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    const store = db.transaction('saves', 'readwrite').objectStore('saves')
    const got = await new Promise((res) => { const r = store.get('slot-0'); r.onsuccess = () => res(r.result) })
    delete got.engrams
    const w = db.transaction('saves', 'readwrite').objectStore('saves')
    await new Promise((res) => { const r = w.put(got, 'slot-0'); r.onsuccess = () => res(true) })
  })
  await page.reload({ waitUntil: 'networkidle' })
  await ready()
  await page.waitForTimeout(3000)
  const legacy = await eng()
  check(legacy.known.length === legacy.total, `a save from before tablets keeps everything it could already make (${legacy.known.length} of ${legacy.total})`)
}

await browser.close()
console.log(failed ? '\nGATE FAILED' : '\nGATE PASSED')
process.exit(failed ? 1 : 0)

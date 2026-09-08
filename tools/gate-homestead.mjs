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

await browser.close()
console.log(failed ? '\nGATE FAILED' : '\nGATE PASSED')
process.exit(failed ? 1 : 0)

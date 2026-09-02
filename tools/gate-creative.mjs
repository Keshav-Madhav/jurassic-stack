// Creative-mode gate: resources granted, god mode, flight up/steer/land,
// one-hit harvest, instant-KO + instant-tame, survival untouched after toggle-off.
//   node tools/gate-creative.mjs [url]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => { console.error('page error:', e.message); failed = true })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.evaluate(() => window.__g.game.wipeAndReload()).catch(() => {})
await page.waitForTimeout(500)
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(1500)
const g = (expr) => page.evaluate(expr)

await g('window.__g.game.setCreative(true)')
check((await g('window.__g.game.count("wood")')) === 999, `creative kit granted (wood=${await g('window.__g.game.count("wood")')})`)

// flight: rise, hold, land
const y0 = (await g('window.__g.player()')).y
await g('window.__g.game.setFlying(true)')
await page.keyboard.down('Space')
await page.waitForTimeout(1500)
await page.keyboard.up('Space')
const y1 = (await g('window.__g.player()')).y
check(y1 > y0 + 5, `flew up ${(y1 - y0).toFixed(1)}m`)
check(await g('window.__g.game.flying()'), 'still flying at altitude')
await g('window.__g.setIntent(0, -12)') // steer while airborne
await page.waitForTimeout(1500)
await g('window.__g.setIntent(0, 0)')
const p2 = await g('window.__g.player()')
check(Math.abs(p2.z - 780) > 8, `steered in flight (z=${p2.z.toFixed(0)})`)
await page.keyboard.down('ShiftLeft')
await page.waitForTimeout(3500)
await page.keyboard.up('ShiftLeft')
check(!(await g('window.__g.game.flying()')), 'auto-landed on ground contact')

// one-hit harvest (select an EMPTY slot first: the creative kit auto-slots
// placeables into slot 0, and swinging a placeable places instead of harvesting)
await g('window.__g.game.select(8)')
await g('window.__g.teleport(-450, 500)') // far from all dino spawns (swing prioritizes dinos)
await page.waitForTimeout(400)
await g('window.__g.game.gotoNearest("tree")')
await page.waitForTimeout(400) // camera snap needs a rendered frame before the aim ray is valid
const w0 = await g('window.__g.game.count("wood")')
await g('window.__g.game.swing()')
await page.waitForTimeout(300)
check((await g('window.__g.game.count("wood")')) > w0, 'one-hit tree harvest')

// instant KO + instant tame
await g('window.__g.game.gotoDino("idle") || window.__g.game.gotoDino("wander")')
await g('window.__g.game.swing()')
await page.waitForTimeout(300)
check(await g('window.__g.game.dinoStates().some(d => d.state === "ko")'), 'creative punch = instant KO')
await g('window.__g.game.gotoDino("ko")')
await g('window.__g.game.interact()')
await page.waitForTimeout(300)
check(await g('window.__g.game.dinoStates().some(d => d.state === "tamed")'), 'creative feed = instant tame')

// back to survival: damage applies again
await g('window.__g.game.setCreative(false)')
check(!(await g('window.__g.game.flying()')), 'flight off when leaving creative')
await browser.close()
process.exit(failed ? 1 : 0)

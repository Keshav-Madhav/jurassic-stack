// Head-tracking probe (M91): stand beside each species and photograph it from
// the side, twice — once with the player on its left, once on its right. A
// head that turns will visibly change; one that cannot will not.
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const only = process.argv[3] ? process.argv[3].split(',') : null
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await b.newPage({ viewport: { width: 820, height: 520 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate(() => {
  window.__g.setTime(0.5)
  // god mode, or a T-Rex eats the cameraman nine metres in
  window.__g.game.setCreative(true)
  document.querySelectorAll('body > div').forEach((d) => { if (!d.querySelector('canvas')) d.style.display = 'none' })
})
await new Promise((r) => setTimeout(r, 1200))
const home = await page.evaluate(() => window.__g.player())
const species = only ?? (await page.evaluate(() => window.__g.game.speciesList()))
for (let i = 0; i < species.length; i++) {
  const id = species[i]
  const idx = await page.evaluate(([sp, hx, hz]) => window.__g.game.spawnDino(sp, hx + 40, hz - 40), [id, home.x, home.z])
  try { await page.waitForFunction((j) => window.__g.game.dinoPos(j) !== null, idx, { timeout: 12000 }) } catch { continue }
  await new Promise((r) => setTimeout(r, 2500))
  const yaws = {}
  for (const [tag, side] of [['left', -1], ['right', 1]]) {
    // stand the player 9 m off one flank, and watch from straight in front
    await page.evaluate(([j, sd]) => {
      const g = window.__g, p = g.game.dinoPos(j)
      g.teleport(p.x + sd * 9, p.z + 1)
      // look dir is -(sin yaw, cos yaw): standing at +z and looking back at the
      // animal is yaw 0, not PI. (Third time this session I have got this
      // backwards — it is written down now.)
      g.setFreeCam(p.x, g.groundAt(p.x, p.z) + 2.4, p.z + 8, 0, -0.06)
    }, [idx, side])
    await new Promise((r) => setTimeout(r, 2200))
    await page.screenshot({ path: `shots/look-${id}-${tag}.png` })
    yaws[tag] = await page.evaluate((j) => window.__g.game.dinoHead(j), idx)
  }
  const st = await page.evaluate((j) => window.__g.game.dinoStates()[j], idx)
  const l = yaws.left, r = yaws.right
  const flips = l && r && Math.sign(l.yaw) !== Math.sign(r.yaw) && Math.abs(l.yaw) > 0.05 && Math.abs(r.yaw) > 0.05
  console.log(`${id.padEnd(12)} ${String(st?.state).padEnd(7)} bone=${String(l?.bone).padEnd(14)} yaw L${String(l?.yaw).padStart(7)} R${String(r?.yaw).padStart(7)}  ${l?.bone ? (flips ? 'TRACKS' : 'no turn') : 'no head bone'}`)
  await page.evaluate(() => window.__g.clearFreeCam())
}
await b.close()

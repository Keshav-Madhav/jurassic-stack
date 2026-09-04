// Forest QA: prop counts per kind + a set of wood vantages (aerial, oblique,
// eye level) with the player teleported under each camera so ground cover
// is in range. Prints tris/calls/fps per shot.
//   node tools/qa-forest.mjs [url] [prefix]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const prefix = process.argv[3] ?? 'shots/fq'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(2500)
const byKind = await page.evaluate(() => {
  const out = {}
  for (const r of window.__g.game.scatterDebug()) {
    const k = r.key.split('#')[0]
    out[k] = (out[k] || 0) + r.nodes
  }
  return out
})
console.log(JSON.stringify(byKind))
const shots = [
  // name, cam x y z yaw pitch, time, player x z
  ['island', 0, 950, 1400, 0, -0.62, 0.5, 0, 780],
  ['spawn', 0, 1.7, 780, 0, 0.05, 0.5, 0, 780],
  ['southwood-air', 100, 260, 760, 0, -0.55, 0.5, 100, 520],
  ['elderwood-air', 60, 220, 420, 0, -0.5, 0.5, 60, 150],
  ['elderwood-oblique', 40, 60, 330, 0, -0.22, 0.5, 40, 240],
  ['elderwood-eye', 100, 1.7, 120, 2.6, 0.12, 0.5, 100, 120],
  ['southwood-eye', 60, 1.7, 690, 0, 0.1, 0.5, 60, 690],
  ['pines-air', -100, 200, -80, 0, -0.45, 0.5, -100, -250],
  ['pines-eye', -150, 1.7, -230, 0, 0.1, 0.5, -150, -230],
  ['glade', 186, 30, 190, 0, -0.35, 0.5, 186, 120],
  ['elder-eye', 60, 1.7, 200, 0, 0.35, 0.5, 60, 200],
]
for (const [name, x, y, z, yaw, pitch, t, px, pz] of shots) {
  await page.evaluate(([xx, yy, zz, ya, pi, tt, ppx, ppz]) => {
    const g = window.__g
    g.setTime(tt)
    g.teleport(ppx, ppz)
    // low cameras are eye heights above the ground under them, not absolutes
    const camY = yy < 40 ? g.groundAt(xx, zz) + yy : yy
    g.setFreeCam(xx, camY, zz, ya, pi)
  }, [x, y, z, yaw, pitch, t, px, pz])
  await page.waitForTimeout(1400)
  const ri = await page.evaluate(() => {
    const r = window.__g.renderInfo()
    return { tris: r.tris, calls: r.calls, fps: window.__g.fps?.() }
  })
  await page.screenshot({ path: `${prefix}-${name}.png` })
  console.log(`${name}: ${JSON.stringify(ri)}`)
  if (process.argv.includes('--tris')) {
    const perKind = await page.evaluate(() => {
      const out = {}
      for (const r of window.__g.game.scatterDebug()) {
        const k = r.key.split('#')[0]
        out[k] = (out[k] || 0) + r.tris
      }
      return Object.entries(out).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${(v / 1e6).toFixed(2)}M`).join(' ')
    })
    console.log(`   submitted (pre-frustum): ${perKind}`)
  }
}
await browser.close()

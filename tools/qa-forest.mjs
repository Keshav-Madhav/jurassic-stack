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
// v2 island (4 km): spawn (0,1560), Southwood z 1210..1580, the Holm wood
// inside the ring (centre -60,370), north pines around (-450,-500)/(400,-480)
const shots = [
  // name, cam x y z yaw pitch, time, player x z
  ['island', 0, 1800, 2700, 0, -0.6, 0.5, 0, 1560],
  ['spawn', 0, 1.7, 1560, 0, 0.05, 0.5, 0, 1560],
  ['southwood-air', 100, 260, 1750, 0, -0.55, 0.5, 100, 1500],
  ['southwood-eye', 60, 1.7, 1590, 0, 0.1, 0.5, 60, 1590],
  ['holm-air', -60, 260, 800, 0, -0.55, 0.5, -60, 600],
  ['holm-oblique', -40, 60, 700, 0, -0.22, 0.5, -40, 620],
  ['holm-eye', -80, 1.7, 470, 0, 0.12, 0.5, -80, 470],
  ['glade', -80, 30, 470, 0, -0.35, 0.5, -80, 430],
  ['pines-air', -450, 200, -250, 0, -0.45, 0.5, -450, -450],
  ['pines-eye', -450, 1.7, -450, 0, 0.1, 0.5, -450, -450],
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
    const pf = window.__g.perf?.() ?? {}
    return { tris: r.tris, calls: r.calls, fps: window.__g.fps?.(), jsUpdateMs: pf.update, jsRenderMs: pf.render }
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

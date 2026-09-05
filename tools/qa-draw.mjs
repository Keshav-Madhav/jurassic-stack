// The draw audit: what the camera draws at three views — draw calls and
// triangles per scene family (scatter / terrain / dinos / grass / …) plus the
// scatter kinds with the most calls, and the frame-time split. Run after any
// change to LOD bands, cell sizes or draw distances.
//   node tools/qa-draw.mjs [url]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(6000)
for (const [label, x, z, yaw] of [['wood line', -286, 793, 1.35], ['spawn', 0, 1560, 0], ['ring', 300, 300, 2.0]]) {
  await page.evaluate(([x, z, yaw]) => { const g = window.__g; g.setTime(0.5); g.teleport(x, z); g.setCam(yaw, 0.05) }, [x, z, yaw])
  await page.waitForTimeout(5000)
  await page.evaluate(() => window.__g.frameStats())
  await page.waitForTimeout(3000)
  const a = await page.evaluate(() => ({ audit: window.__g.drawAudit(), info: window.__g.renderInfo(), fs: window.__g.frameStats(), perf: window.__g.perf(), rows: window.__g.game.scatterDebug() }))
  console.log(`${label}: calls ${a.info.calls} tris ${(a.info.tris / 1e6).toFixed(2)}M · p95 ${a.fs.p95} max ${a.fs.max} · render ${a.perf.render} ms update ${a.perf.update} ms`)
  console.log('   ' + Object.entries(a.audit).sort((p, q) => q[1].calls - p[1].calls).map(([k, v]) => `${k} ${v.calls}`).join(' · '))
  const byKind = {}
  for (const r of a.rows.filter((r) => r.visible)) { const kind = r.key.split('#')[0]; const b = (byKind[kind] ??= { calls: 0, tris: 0 }); b.calls += r.submeshes; b.tris += r.tris }
  console.log('   scatter: ' + Object.entries(byKind).sort((p, q) => q[1].calls - p[1].calls).slice(0, 8).map(([k, v]) => `${k} ${v.calls}/${(v.tris / 1e6).toFixed(2)}M`).join(' · '))
}
await browser.close()

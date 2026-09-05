import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto('http://localhost:4173', { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(6000)
for (const [label, x, z, yaw] of [['wood line', -286, 793, 1.35], ['spawn', 0, 1560, 0], ['ring', 300, 300, 2.0]]) {
  await page.evaluate(([x, z, yaw]) => { const g = window.__g; g.setTime(0.5); g.teleport(x, z); g.setCam(yaw, 0.05) }, [x, z, yaw])
  await page.waitForTimeout(5000)
  await page.evaluate(() => window.__g.frameStats())
  await page.waitForTimeout(3000)
  const a = await page.evaluate(() => ({ audit: window.__g.drawAudit(), info: window.__g.renderInfo(), fs: window.__g.frameStats(), perf: window.__g.perf() }))
  console.log(`${label}: calls ${a.info.calls} tris ${(a.info.tris / 1e6).toFixed(2)}M · p95 ${a.fs.p95} max ${a.fs.max} · render ${a.perf.render} update ${a.perf.update} · ` + Object.entries(a.audit).sort((p, q) => q[1].calls - p[1].calls).map(([k, v]) => `${k} ${v.calls}`).join(', '))
}
await browser.close()

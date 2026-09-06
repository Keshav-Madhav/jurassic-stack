// GPU profile: how long the GPU spends per scene layer, measured with
// EXT_disjoint_timer_query_webgl2 (Chrome/ANGLE Metal supports it). Renders
// the frame N times with one layer hidden at a time and reports the delta —
// the only honest way to find fill-rate costs (the JS render timer measures
// submit, not the GPU). node tools/qa-gpu.mjs [url] [x z yaw]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const spot = process.argv.length > 5 ? process.argv.slice(3, 6).map(Number) : [-286, 793, 1.35]
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(10000)
await page.evaluate(([x, z, yaw]) => { const g = window.__g; g.setTime(0.5); g.teleport(x, z); g.setCam(yaw, 0.05) }, spot)
await page.waitForTimeout(4000)
const res = await page.evaluate(async () => {
  const g = window.__g
  const gl = g.renderer.getContext()
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  if (!ext) return { error: 'no EXT_disjoint_timer_query_webgl2' }
  const layers = ['(all)', 'terrain', 'scatter', 'grass', 'water', 'skyExtras', 'clouds', 'shadows', '(all)']
  const timeLayer = async (name) => {
    const hidden = []
    if (name === 'clouds') { const sx = g.scene.getObjectByName('skyExtras'); sx.traverse((o) => { if (o.isInstancedMesh && o.visible) { o.visible = false; hidden.push(o) } }) }
    else if (name === 'shadows') { g.renderer.shadowMap.enabled = false }
    else if (name !== '(all)') { const o = g.scene.getObjectByName(name); if (o) { o.visible = false; hidden.push(o) } }
    // warm two frames, then time 8
    for (let i = 0; i < 2; i++) { g.renderer.shadowMap.needsUpdate = true; g.renderer.render(g.scene, g.cam) }
    const qs = []
    for (let i = 0; i < 16; i++) {
      const q = gl.createQuery()
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q)
      g.renderer.shadowMap.needsUpdate = true
      g.renderer.render(g.scene, g.cam)
      gl.endQuery(ext.TIME_ELAPSED_EXT)
      qs.push(q)
    }
    // wait for results
    let tries = 0
    while (tries++ < 200 && !gl.getQueryParameter(qs[qs.length - 1], gl.QUERY_RESULT_AVAILABLE)) await new Promise((r) => setTimeout(r, 10))
    const ms = qs.map((q) => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6).sort((a, b) => a - b)
    for (const q of qs) gl.deleteQuery(q)
    for (const o of hidden) o.visible = true
    if (name === 'shadows') g.renderer.shadowMap.enabled = true
    return ms[Math.floor(ms.length / 2)]
  }
  const out = {}
  for (const l of layers) { const v = +(await timeLayer(l)).toFixed(2); out[l] = out[l] === undefined ? v : Math.min(out[l], v) }
  return out
})
if (res.error) { console.log(res.error); process.exit(1) }
const all = res['(all)']
console.log(`GPU frame at (${spot.join(', ')}): ${all} ms`)
for (const [k, v] of Object.entries(res)) if (k !== '(all)') console.log(`  without ${k.padEnd(10)} ${String(v).padStart(6)} ms  → ${k} costs ~${(all - v).toFixed(2)} ms`)
await browser.close()

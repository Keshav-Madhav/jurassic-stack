// The jitter meter: stand, walk, sprint, fly and SPIN (two full turns on the
// spot — a turn sweeps the whole scene through the frustum) while
// recording frame times; report p95/p99/max and the count of frames over
// 25 ms (a hitch you feel). node tools/qa-jitter.mjs [url]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
// 2560×1440 and vsync OFF, like every other perf tool since M31: at 1280×720
// with vsync on, a frame that costs 30 ms and a frame that costs 8 ms both
// read as 16.7 and the whole meter said "fine".
const small = process.argv.includes('--720')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const page = await browser.newPage({ viewport: { width: small ? 1280 : 2560, height: small ? 720 : 1440 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(32000) // let startup settle: the first 30 s are compiles, uploads and streaming (M31)
await page.evaluate(() => { window.__g.setTime(0.5); window.__g.setAdaptive(false); window.__g.setPixelRatio(1); window.__g.setGpuProbe(true); window.__g.frameStats() })
const runs = [
  { name: 'stand still 8 s', vz: 0, fly: false, secs: 8 },
  { name: 'walk north 12 s', vz: -4, fly: false, secs: 12 },
  { name: 'sprint north 12 s', vz: -9, fly: false, secs: 12 },
  { name: 'fly north 12 s (creative)', vz: -18, fly: true, secs: 12 },
]
for (const r of runs) {
  await page.evaluate((rr) => {
    const g = window.__g
    g.teleport(0, 1560)
    g.game.setCreative(rr.fly)
    g.game.setFlying(rr.fly)
    g.setIntent(0, rr.vz)
    g.frameStats()
  }, r)
  await page.waitForTimeout(r.secs * 1000)
  const st = await page.evaluate(() => { const s = window.__g.frameStats(); window.__g.setIntent(0, 0); return { ...s, p: window.__g.player(), gpu: window.__g.gpuMs() } })
  console.log(`${r.name}: frames ${st.n} p50 ${st.p50} p95 ${st.p95} p99 ${st.p99} max ${st.max} ms · hitches>25ms ${st.over25} · GPU p10 ${st.gpu.p10} med ${st.gpu.median} · reached z=${st.p.z.toFixed(0)}`)
  if (st.worst && st.worst.ms > 25) console.log(`   worst JS frame ${st.worst.ms.toFixed(1)} ms at z=${st.worst.z.toFixed(0)}: ` + Object.entries(st.worst.sec).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' · '))
}
// turning: two full spins on the spot (fresh spawn, then from the wood line)
// — the user feels sharp drops on turning; a spin sweeps the whole scene
// through the frustum and triggers every first-time upload/compile
for (const spot of [[0, 1560, 'spawn'], [-286, 793, 'wood line']]) {
  await page.evaluate(([x, z]) => { const g = window.__g; g.teleport(x, z); g.game.setCreative(false); g.game.setFlying(false); g.setIntent(0, 0) }, spot)
  await page.waitForTimeout(3000)
  await page.evaluate(() => window.__g.frameStats())
  const t0 = Date.now()
  while (Date.now() - t0 < 8000) {
    const t = (Date.now() - t0) / 8000
    await page.evaluate((yaw) => window.__g.setCam(yaw, 0.05), t * Math.PI * 4)
    await page.waitForTimeout(16)
  }
  const st = await page.evaluate(() => window.__g.frameStats())
  console.log(`spin ×2 at ${spot[2]} 8 s: frames ${st.n} p50 ${st.p50} p95 ${st.p95} p99 ${st.p99} max ${st.max} ms · hitches>25ms ${st.over25}`)
  if (st.worst && st.worst.ms > 25) console.log(`   worst JS frame ${st.worst.ms.toFixed(1)} ms: ` + Object.entries(st.worst.sec).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' · '))
}
await browser.close()

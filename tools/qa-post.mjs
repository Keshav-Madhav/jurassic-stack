// The post stack's price list: GPU milliseconds at 2560×1440 for each layer,
// added one at a time, at two spots. PERFORMANCE.md's rule is that a pass you
// cannot turn off is a pass you cannot budget — this is where the budget comes
// from. node tools/qa-post.mjs [url]
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const page = await b.newPage({ viewport: { width: 2560, height: 1440 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(process.argv[2] ?? 'http://localhost:4173', { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate(() => { window.__g.setAdaptive(false); window.__g.setPixelRatio(1); window.__g.setGpuProbe(true) })
for (const [x, z, yaw, name] of [[-286, 793, 1.35, 'wood-line'], [0, 1560, 0, 'spawn']]) {
  await page.evaluate(([a, c, y]) => { const g = window.__g; g.setTime(0.5); g.game.setGod(true); g.teleport(a, c); g.setCam(y, 0.05); g.setFrozen(true) }, [x, z, yaw])
  await page.waitForTimeout(20000)
  const out = []
  for (const [label, fn] of [
    ['no post', () => window.__g.post().setQuality('off')],
    ['basic (grade+FXAA)', () => window.__g.post().setQuality('basic')],
    ['full (+ bloom)', () => { const p = window.__g.post(); p.setAo(false); p.setQuality('full') }],
    ['+ AO (opt-in)', () => window.__g.post().setAo(true)],
  ]) {
    await page.evaluate(fn)
    // WAIT OUT THE RING. gpuMs() reports a percentile over the last 240 frames,
    // which at 30 ms a frame is EIGHT SECONDS — waiting four gave three
    // configurations the same number, because p10 kept finding the cheap frames
    // from the previous one (M42, and the third time this project has been
    // fooled by its own instrument).
    await page.waitForTimeout(12000)
    out.push(`${label}: ${(await page.evaluate(() => window.__g.gpuMs().p10)).toFixed(2)} ms`)
  }
  console.log(`${name}  ` + out.join(' · '))
}
await b.close()

// The jitter meter: run, ride-speed run and fly across the island while
// recording frame times; report p95/p99/max and the count of frames over
// 25 ms (a hitch you feel). node tools/qa-jitter.mjs [url]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(12000) // let startup settle
await page.evaluate(() => { window.__g.setTime(0.5); window.__g.frameStats() })
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
  const st = await page.evaluate(() => { const s = window.__g.frameStats(); window.__g.setIntent(0, 0); return { ...s, p: window.__g.player() } })
  console.log(`${r.name}: frames ${st.n} p50 ${st.p50} p95 ${st.p95} p99 ${st.p99} max ${st.max} ms · hitches>25ms ${st.over25} · reached z=${st.p.z.toFixed(0)}`)
}
await browser.close()

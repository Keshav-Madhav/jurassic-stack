// Authored-vantage screenshot harness. Builds nothing itself — expects a
// server already running (default: vite preview on 4173; pass a URL to
// override). Drives the game's window.__g debug interface.
//   npm run build && npx vite preview --port 4173 &   # or `npm run dev`
//   node tools/shots.mjs [url] [outDir]
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:4173'
const outDir = process.argv[3] ?? 'shots/graybox'
mkdirSync(outDir, { recursive: true })

// Each vantage: teleport the player, aim the camera, set the clock.
// time: 0=midnight .25=sunrise .5=noon .75=sunset
// camera convention: yaw 0 = looking north (-z), positive pitch = looking up
const VANTAGES = [
  { name: 'spawn-morning', x: 0, z: 780, yaw: 0, pitch: 0.06, time: 0.34 },
  { name: 'volcano-vista-golden', x: 0, z: 700, yaw: 0, pitch: 0.08, time: 0.745 },
  { name: 'interior-noon', x: -180, z: 100, yaw: -0.5, pitch: -0.08, time: 0.5 },
  { name: 'raptor-eye-level', x: 20, z: 762, yaw: 0.6, pitch: -0.04, time: 0.45 },
  { name: 'spawn-night', x: 0, z: 780, yaw: 0, pitch: 0.05, time: 0.02 },
  { name: 'crater-approach', x: 0, z: -380, yaw: 0, pitch: 0.18, time: 0.58 },
  { name: 'river-bend', x: 392, z: -60, yaw: -Math.PI / 2, pitch: -0.3, time: 0.45 },
  { name: 'lake-west', x: -430, z: 95, yaw: 0, pitch: -0.32, time: 0.62 },
]

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => { console.error('page error:', e.message); process.exitCode = 1 })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(1200) // let the raptor GLB finish loading

for (const v of VANTAGES) {
  await page.evaluate((s) => {
    const g = window.__g
    g.setTime(s.time)
    g.teleport(s.x, s.z)
    g.setCam(s.yaw, s.pitch)
  }, v)
  await page.waitForTimeout(700) // camera settle + PMREM rebake
  await page.screenshot({ path: `${outDir}/${v.name}.png` })
  console.log(`${outDir}/${v.name}.png`)
}

await browser.close()

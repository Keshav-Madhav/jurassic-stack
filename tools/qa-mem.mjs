// WHERE THE HEAP GOES, and what it costs to load the island five times.
//
// Memory was the one budget nothing in this project counted. `renderer.info`
// covers the GPU; `performance.memory` gives one number for the JS side and no
// breakdown at all. This reports `__g.mem()` — geometry in the scene, geometry
// on the DETACHED roots the upload warden keeps, the baked grids, and the
// instance buffers — and then reloads the page repeatedly, because a heap that
// climbs across reloads is a different problem from a heap that is simply big.
//
//   node tools/qa-mem.mjs [url] [reloads]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const reloads = Number(process.argv[3] ?? 3)
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await b.newPage({ viewport: { width: 1280, height: 720 } })
const settle = async () => {
  await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 120000 })
  await page.waitForTimeout(8000)
  return page.evaluate(() => window.__g.mem())
}
await page.goto(url, { waitUntil: 'networkidle' })
const first = await settle()
console.log(JSON.stringify(first, null, 1))
console.log(`\naccounted for: ${(first.sceneGeoMB + first.instanceMB + first.detachedRootGeoMB + first.gridsMB).toFixed(1)} of ${first.heapMB} MB\n`)
for (let i = 2; i <= reloads; i++) {
  await page.reload({ waitUntil: 'networkidle' })
  const m = await settle()
  console.log(`load ${i}: heap ${String(m.heapMB).padStart(6)} / ${m.limitMB} MB · scene geo ${m.sceneGeoMB} · roots ${m.detachedRootGeoMB} · instances ${m.instanceMB}`)
}
await b.close()

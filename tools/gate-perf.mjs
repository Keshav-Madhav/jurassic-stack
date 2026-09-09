// Gate: the frame budget (PERFORMANCE.md).
//
// Measured IN THE LIVE GAME LOOP at 2560×1440 — the user's full-window pixel
// count — because that is what the player pays. `tools/qa-gpu.mjs` pauses the
// loop to attribute cost per layer; this gate never pauses anything: it stands
// where a player stands, records wall-clock frame times and real GPU
// milliseconds, and fails when either goes over the ceiling in
// tools/perf-budget.json.
//
// Two numbers per spot, and they mean different things:
//   wall  — the frame time the player feels (CPU + GPU + present)
//   GPU   — EXT_disjoint_timer_query, the fill cost alone
//   node tools/gate-perf.mjs [url] [--720] [--write]
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const url = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:4173'
const small = args.includes('--720')
const write = args.includes('--write') // re-baseline the ceilings from this run
const W = small ? 1280 : 2560
const H = small ? 720 : 1440
const budget = JSON.parse(readFileSync(new URL('./perf-budget.json', import.meta.url), 'utf8'))

let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }

const SPOTS = [
  { name: 'spawn', x: 0, z: 1560, yaw: 0 },
  { name: 'wood-line', x: -286, z: 793, yaw: 1.35 },
  { name: 'plain', x: -250, z: 1040, yaw: 2.2 },
]

// vsync OFF: with it the wall-clock frame time is pinned at 16.7 ms whatever
// the game costs, and the GPU downclocks between frames and reports noise
// (M31). Unthrottled, wall-clock p50 IS the frame cost.
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const page = await browser.newPage({ viewport: { width: W, height: H } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 160)))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(12000) // startup streaming settles
const px = await page.evaluate(() => {
  window.__g.setAdaptive(false)
  window.__g.setPixelRatio(1)
  window.__g.setGpuProbe(true)
  const gl = window.__g.renderer.getContext()
  const e = gl.getExtension('WEBGL_debug_renderer_info')
  return { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight, gpu: e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : '?' }
})
console.log(`${px.w}×${px.h} (${(px.w * px.h / 1e6).toFixed(1)} Mpx) · ${px.gpu}`)
check(await page.evaluate(() => window.__g.gpuMs().supported), 'GPU timer queries available (the honest instrument)')
const extra = Number(args.find((a) => a.startsWith('--lights='))?.slice(9) ?? 0)
if (extra) console.log(await page.evaluate((k) => `+${window.__g.setExtraLights(k)} extra point lights parked out at sea (the A/B for lever A)`, extra))
// every point light in the scene must belong to the rig: nobody gets to add
// one on the side (the light count is a shader define — see lights.ts)
const lights = await page.evaluate(() => window.__g.game.lights())
check(extra > 0 || lights.scenePointLights === lights.slots.length, `the scene's ${lights.scenePointLights} point lights are exactly the rig's ${lights.slots.length} slots`)

const measured = {}
for (const s of SPOTS) {
  await page.evaluate(([x, z, yaw]) => { const g = window.__g; g.setTime(0.5); g.game.setGod(true); g.teleport(x, z); g.clearFreeCam?.(); g.setCam(yaw, 0.05); g.setIntent(0, 0) }, [s.x, s.z, s.yaw])
  await page.waitForTimeout(9000) // first-sight compiles and uploads at a new spot
  await page.evaluate(() => window.__g.frameStats())
  await page.waitForTimeout(7000)
  const r = await page.evaluate(() => ({ f: window.__g.frameStats(), g: window.__g.gpuMs() }))
  measured[s.name] = +r.g.p10.toFixed(2)
  const ceil = budget.ceiling[s.name]
  console.log(`  ${s.name.padEnd(10)} wall p50 ${r.f.p50} p95 ${r.f.p95} max ${r.f.max} ms (${(1000 / r.f.p50).toFixed(0)} fps) · GPU ${r.g.p10}/${r.g.median}/${r.g.p95} ms (p10/median/p95) · hitches>25ms ${r.f.over25}`)
  check(r.g.p10 <= ceil, `${s.name}: GPU ${r.g.p10} ms within the ceiling of ${ceil} ms`)
  // AND THE CPU. This gate measured only the GPU, so M58 cutting the CPU frame
  // from 7.9 to 4.7 ms with the GPU unchanged would have gone unnoticed — and
  // so would giving it back. The ceiling is deliberately loose (a local run
  // reads up to 2x slow when anything else is building): it guards a
  // regression, it does not chase a target.
  check(r.f.p50 <= budget.ceiling.wallP50, `${s.name}: CPU frame ${r.f.p50} ms within the ceiling of ${budget.ceiling.wallP50} ms`)
  if (r.g.p10 > budget.aspiration[s.name]) console.log(`  INFO ${s.name} is over the PERFORMANCE.md target of ${budget.aspiration[s.name]} ms — levers remain`)
}

// turning is where the user feels the drops: two full spins at the wood line
await page.evaluate(() => { const g = window.__g; g.teleport(-286, 793); g.setIntent(0, 0) })
await page.waitForTimeout(2500)
await page.evaluate(() => window.__g.frameStats())
const t0 = Date.now()
while (Date.now() - t0 < 8000) {
  await page.evaluate((yaw) => window.__g.setCam(yaw, 0.05), ((Date.now() - t0) / 8000) * Math.PI * 4)
  await page.waitForTimeout(16)
}
const spin = await page.evaluate(() => ({ f: window.__g.frameStats(), g: window.__g.gpuMs() }))
console.log(`  spin ×2    wall p50 ${spin.f.p50} p95 ${spin.f.p95} max ${spin.f.max} ms · GPU ${spin.g.p10}/${spin.g.median} ms · hitches>25ms ${spin.f.over25}`)
check(spin.f.over25 <= budget.ceiling.spinHitches, `spinning at the wood line: ${spin.f.over25} hitches over 25 ms (ceiling ${budget.ceiling.spinHitches})`)

if (write) {
  for (const [k, v] of Object.entries(measured)) budget.ceiling[k] = +(v * 1.15 + 0.5).toFixed(1)
  budget.measured = { ...measured, at: `${px.w}x${px.h}`, on: px.gpu.slice(0, 40), when: new Date().toISOString().slice(0, 10) }
  writeFileSync(new URL('./perf-budget.json', import.meta.url), JSON.stringify(budget, null, 2) + '\n')
  console.log('\nceilings re-baselined from this run (perf-budget.json)')
}
await browser.close()
console.log(failed ? '\nGATE FAILED' : '\nGATE PASSED')
process.exit(failed ? 1 : 0)

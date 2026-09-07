// GPU profile: where the frame's milliseconds go, layer by layer.
//
// DEFAULT SIZE IS 2560×1440 — the user's full-window pixel count (PERFORMANCE.md).
// Every "60 fps" in the ledger before M26 was measured at 1280×720, a QUARTER
// of the pixels, which is why the profile said 4 ms and the user saw 30 fps.
//
// FOUR THINGS THIS TOOL LEARNED THE HARD WAY (M31 — the first three attempts
// all produced confident nonsense, including negative layer costs and layers
// that summed to twice the frame):
//
//  1. ADDITIVE, NOT SUBTRACTIVE. Hiding one layer of an overdrawn scene saves
//     almost nothing — the pixels don't disappear, they get shaded by whatever
//     was behind. Hiding the grass just paints the terrain under it. So: hide
//     every top-level child, then reveal them one at a time and watch the
//     frame grow. (Attribution still depends on the reveal order — a layer
//     added early pays for pixels a later layer would otherwise have paid
//     for — so the order below is the honest one: back to front.)
//  2. VSYNC OFF (--disable-gpu-vsync). With vsync the wall clock is pinned at
//     16.7 ms whatever the game costs, and the GPU downclocks between frames
//     and reports 2-3 ms of noise on an unchanged frame.
//  3. FREEZE THE WORLD (dt = 0). A herd walking through the shot moved the
//     reading by 3 ms between samples.
//  4. WARM FOR 30 SECONDS. The frame at spawn reads 11 ms for the first half
//     minute (shader compiles, texture uploads, terrain streaming) and 6.5 ms
//     thereafter. Every early number in this project's ledger was taken inside
//     that window. Readings are the 10th percentile, not the median.
//   node tools/qa-gpu.mjs [url] [--720] [--spot=wood-line] [--no-layers] [--lights=7]
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const url = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:4173'
const small = args.includes('--720')
const noLayers = args.includes('--no-layers')
const only = args.find((a) => a.startsWith('--spot='))?.slice(7)
const extraLights = Number(args.find((a) => a.startsWith('--lights='))?.slice(9) ?? 0)
const W = small ? 1280 : 2560
const H = small ? 720 : 1440
const WARM = 30000
const SETTLE = 3000

const SPOTS = [
  { name: 'spawn', x: 0, z: 1560, yaw: 0 },
  { name: 'wood-line', x: -286, z: 793, yaw: 1.35 },
  { name: 'plain', x: -250, z: 1040, yaw: 2.2 },
]
/** reveal order: the sky behind everything, then the ground, then what stands on it */
const ORDER = ['sky', 'terrain', 'water', 'scatter', 'grass', 'dinos+loose', 'dinoImpostors', 'ruins', 'skyExtras', 'keystones', 'building', 'beacon', 'border', 'hitfx']

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const page = await browser.newPage({ viewport: { width: W, height: H } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
const info = await page.evaluate(() => {
  window.__g.setAdaptive(false)
  window.__g.setPixelRatio(1)
  window.__g.setGpuProbe(true)
  const gl = window.__g.renderer.getContext()
  const e = gl.getExtension('WEBGL_debug_renderer_info')
  return { gpu: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown', px: [gl.drawingBufferWidth, gl.drawingBufferHeight], timer: window.__g.gpuMs().supported }
})
if (!info.timer) { console.log('no EXT_disjoint_timer_query_webgl2 — nothing honest to measure'); process.exit(1) }
if (extraLights) console.log(await page.evaluate((k) => `+${window.__g.setExtraLights(k)} extra point lights parked out at sea (the A/B for lever A)`, extraLights))
console.log(`GPU: ${info.gpu}`)
console.log(`drawing buffer: ${info.px[0]}×${info.px[1]} (${(info.px[0] * info.px[1] / 1e6).toFixed(1)} Mpx), live loop, frozen world, p10 of ~240 frames\n`)

const read = async (wait = SETTLE) => { await page.waitForTimeout(wait); return page.evaluate(() => window.__g.gpuMs().p10) }

for (const spot of SPOTS) {
  if (only && spot.name !== only) continue
  await page.evaluate(([x, z, yaw]) => {
    const g = window.__g
    g.setFrozen(false)
    g.setTime(0.5); g.game.setGod(true); g.teleport(x, z); g.clearFreeCam?.(); g.setCam(yaw, 0.05); g.setIntent(0, 0)
  }, [spot.x, spot.z, spot.yaw])
  const full = await read(WARM)
  const stat = await page.evaluate(() => {
    window.__g.setFrozen(true)
    return { calls: window.__g.renderer.info.render.calls, tris: window.__g.renderer.info.render.triangles }
  })
  console.log(`${spot.name} (${spot.x}, ${spot.z}): ${full.toFixed(2)} ms GPU · ${stat.calls} calls · ${(stat.tris / 1e6).toFixed(2)} Mtri`)
  if (noLayers) continue
  // hide every top-level child, bucketed by name (dino rigs are loose children)
  await page.evaluate((named) => {
    window.__buckets = new Map()
    const scene = window.__g.scene
    window.__bg = scene.background
    scene.background = null
    for (const c of scene.children) {
      if (c.isLight) continue
      const key = named.includes(c.name) ? c.name : 'dinos+loose'
      if (!window.__buckets.has(key)) window.__buckets.set(key, [])
      window.__buckets.get(key).push(c)
      c.visible = false
    }
  }, ORDER)
  let prev = await read()
  console.log(`   ${'(empty)'.padEnd(15)} ${prev.toFixed(2)} ms`)
  for (const name of ORDER) {
    const n = await page.evaluate((key) => {
      if (key === 'sky') { window.__g.scene.background = window.__bg; return 1 }
      const b = window.__buckets.get(key)
      if (!b) return 0
      for (const o of b) o.visible = true
      return b.length
    }, name)
    if (!n) continue
    const v = await read()
    const d = v - prev
    prev = v
    console.log(`   + ${name.padEnd(13)} ${v.toFixed(2)} ms   ${d >= 0 ? '+' : ''}${d.toFixed(2)}  ${'█'.repeat(Math.max(0, Math.round(d * 6)))}`)
  }
  console.log(`   (full frame was ${full.toFixed(2)} ms; rebuilt to ${prev.toFixed(2)} ms — the gap is measurement drift)`)
}
await browser.close()

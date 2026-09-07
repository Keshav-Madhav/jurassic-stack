// The hitch hunt: a lap of the island, reporting what each region COSTS THE
// FIRST TIME YOU SEE IT — the worst frame's section breakdown, plus how many
// shader programs and GPU textures were created while you were there.
//
// Why this tool exists (M31): the steady frame is ~6 ms GPU / ~8 ms wall at
// 2560×1440 — 120 fps — and the game still felt like 30 in places. It was
// never the steady state. It was first-sight work: up to 54 texture uploads
// and 21 shader compiles inside a single render call, worth 100-500 ms each
// time you walked somewhere new. A median can't see any of that; this can.
//   node tools/qa-hitch.mjs [url] [--720]
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const url = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:4173'
const small = args.includes('--720')

/** a lap: the beach, the wood line, the plain, the river, the pines, the ravine, the foothills, the dunes */
const LAP = [[0, 1560], [-286, 793], [-250, 1040], [700, 900], [300, -560], [0, -870], [-700, -400], [-900, 1250]]

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const page = await browser.newPage({ viewport: { width: small ? 1280 : 2560, height: small ? 720 : 1440 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 160)))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(30000) // the first 30 s are load: compiles, uploads, streaming
const boot = await page.evaluate(() => {
  window.__g.setAdaptive(false)
  window.__g.setPixelRatio(1)
  window.__g.setTime(0.5)
  window.__g.game.setGod(true)
  window.__seen = new Set(window.__g.renderer.info.programs.map((p) => p.cacheKey))
  window.__tex = window.__g.renderer.info.memory.textures
  return { progs: window.__g.renderer.info.programs.length, tex: window.__tex, uploads: window.__g.uploads() }
})
console.log(`after load: ${boot.progs} programs · ${boot.tex} GPU textures · warden pre-uploaded ${boot.uploads.done} from ${boot.uploads.roots} roots\n`)

let worstEver = 0
for (const [x, z] of LAP) {
  await page.evaluate(([px, pz]) => { const g = window.__g; g.teleport(px, pz); g.setIntent(0, -6); g.frameStats() }, [x, z])
  await page.waitForTimeout(6000)
  const r = await page.evaluate(() => {
    const st = window.__g.frameStats()
    window.__g.setIntent(0, 0)
    const progs = window.__g.renderer.info.programs
    const fresh = []
    for (const p of progs) if (!window.__seen.has(p.cacheKey)) { window.__seen.add(p.cacheKey); fresh.push(`${p.name || '(' + p.cacheKey.split(',').filter((t) => t && t !== 'false' && t !== 'true').slice(0, 4).join(',') + ')'}`) }
    const dtex = window.__g.renderer.info.memory.textures - window.__tex
    window.__tex = window.__g.renderer.info.memory.textures
    return { st, fresh, dtex, gpu: window.__g.gpuMs() }
  })
  worstEver = Math.max(worstEver, r.st.max)
  console.log(`${String(x).padStart(5)},${String(z).padStart(5)}  p50 ${String(r.st.p50).padStart(5)} p99 ${String(r.st.p99).padStart(5)} max ${String(r.st.max).padStart(6)} ms · hitches>25ms ${String(r.st.over25).padStart(3)} · +${r.fresh.length} programs${r.fresh.length ? ' [' + r.fresh.join(', ') + ']' : ''} +${r.dtex} textures`)
  if (r.st.worst && r.st.worst.ms > 25) {
    const sec = Object.entries(r.st.worst.sec).filter(([, v]) => v > 0.5).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' · ')
    console.log(`         worst frame ${r.st.worst.ms.toFixed(0)} ms: ${sec}`)
  }
}
console.log(`\nworst frame of the lap: ${worstEver} ms`)
await browser.close()

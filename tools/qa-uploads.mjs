// H7's instrument: WHICH textures upload the first time you see a region, and
// where they live.
//
// `tools/qa-hitch.mjs` reports "+58 textures, newTex 52 ms" and stops there,
// which is enough to know a stutter exists and not enough to fix it. This
// names them: after every stop it walks the whole scene graph and reports each
// texture that has just been given a `__webglTexture` — three's own record
// that the upload happened — with its size, its source file, and the object it
// hangs off. The upload warden's job is to make this list EMPTY.
//   node tools/qa-uploads.mjs [url] [--720]
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const url = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:4173'
const small = args.includes('--720')

const LAP = [[0, 1560], [-286, 793], [-250, 1040], [700, 900], [300, -560], [0, -870], [-700, -400], [-900, 1250]]

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const page = await browser.newPage({ viewport: { width: small ? 1280 : 2560, height: small ? 720 : 1440 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 160)))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(30000)

const install = () => page.evaluate(() => {
  window.__texSeen = new Set()
  window.__texScan = () => {
    const r = window.__g.renderer
    const out = []
    const note = (tex, where) => {
      if (!tex || !tex.isTexture) return
      const p = r.properties.get(tex)
      if (!p || p.__webglTexture === undefined) return
      if (window.__texSeen.has(tex.uuid)) return
      window.__texSeen.add(tex.uuid)
      const img = tex.image
      const src = (img && (img.src || img.currentSrc)) || ''
      out.push({
        w: img?.width ?? 0, h: img?.height ?? 0,
        name: tex.name || '',
        src: src ? src.slice(src.lastIndexOf('/') + 1) : (tex.isDataTexture ? '(data)' : tex.isCanvasTexture ? '(canvas)' : '(?)'),
        where,
      })
    }
    const walk = (root, label) => root.traverse((o) => {
      const m = o.material
      if (!m) return
      for (const mat of Array.isArray(m) ? m : [m]) {
        for (const [k, v] of Object.entries(mat)) if (v && v.isTexture) note(v, `${label}/${o.name || o.type}.${k}`)
        const u = mat.uniforms
        if (u) for (const [k, v] of Object.entries(u)) if (v && v.value && v.value.isTexture) note(v.value, `${label}/${o.name || o.type}.u_${k}`)
      }
    })
    walk(window.__g.scene, 'scene')
    note(window.__g.scene.environment, 'scene.environment')
    note(window.__g.scene.background, 'scene.background')
    return out
  }
  window.__texScan() // everything already up is the baseline
  return window.__g.renderer.info.memory.textures
})

const baseline = await install()
console.log(`after load: ${baseline} GPU textures, all of them the baseline\n`)
await page.evaluate(() => { const g = window.__g; g.setAdaptive(false); g.setPixelRatio(1); g.setTime(0.5); g.game.setGod(true) })

for (const [x, z] of LAP) {
  const before = await page.evaluate(() => window.__g.renderer.info.memory.textures)
  await page.evaluate(([px, pz]) => { const g = window.__g; g.teleport(px, pz); g.setIntent(0, -6); g.frameStats() }, [x, z])
  await page.waitForTimeout(6000)
  const st = await page.evaluate(() => { const s = window.__g.frameStats(); window.__g.setIntent(0, 0); return s })
  const after = await page.evaluate(() => window.__g.renderer.info.memory.textures)
  const named = await page.evaluate(() => window.__texScan())
  console.log(`${String(x).padStart(5)},${String(z).padStart(5)}  max ${String(st.max).padStart(6)} ms · +${after - before} GPU textures · ${named.length} of them named below`)
  const roll = new Map()
  for (const t of named) {
    const k = `${t.w}×${t.h} ${t.src}${t.name ? ` "${t.name}"` : ''}`
    const e = roll.get(k) ?? { n: 0, where: t.where }
    e.n++
    roll.set(k, e)
  }
  for (const [k, e] of [...roll].sort((a, b) => b[1].n - a[1].n).slice(0, 14)) console.log(`         ${String(e.n).padStart(3)} × ${k}   ← ${e.where}`)
}
await browser.close()

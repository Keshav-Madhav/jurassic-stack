// THE INSTRUMENT H8 ASKED FOR (PERFORMANCE.md): what actually gets COMPILED,
// and when.
//
// `renderer.info.programs.length` was the old proxy and PERFORMANCE.md records
// that it is not sound — a bisect reported 29 "new" programs for objects that
// had demonstrably already been drawn. So ask the driver instead: patch
// `WebGL2RenderingContext.prototype.shaderSource` and `linkProgram` before the
// page loads and record every single link, with the `#define SHADER_NAME` that
// three stamps into the source and the defines that came with it.
//
// That turns "something compiled around here" into "THIS material, with THESE
// flags, at THIS moment", which is the difference between guessing and fixing.
//   node tools/qa-compile.mjs [url] [--720]
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const url = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:4173'
const small = args.includes('--720')

/** the same lap the hitch hunt walks, so the two reports line up */
const LAP = [[0, 1560], [-286, 793], [-250, 1040], [700, 900], [300, -560], [0, -870], [-700, -400], [-900, 1250]]

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const page = await browser.newPage({ viewport: { width: small ? 1280 : 2560, height: small ? 720 : 1440 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 160)))

await page.addInitScript(() => {
  const patch = (Proto) => {
    if (!Proto) return
    const src = Proto.shaderSource
    const link = Proto.linkProgram
    let pending = []
    Proto.shaderSource = function (shader, code) {
      const m = /#define SHADER_NAME (.*)/.exec(code)
      const t = /#define SHADER_TYPE (.*)/.exec(code)
      // THE VALUE MATTERS. `NUM_POINT_LIGHTS 0` and `NUM_POINT_LIGHTS 3` are
      // two different programs, and a first pass at this tool that recorded
      // only the define's NAME reported them as identical.
      const defs = (code.match(/^#define [A-Za-z0-9_]+.*$/gm) ?? []).map((s) => s.slice(8).trim())
      pending.push({ name: (m ? m[1].trim() : '') || '(unnamed)', type: t ? t[1].trim() : '?', defs })
      return src.call(this, shader, code)
    }
    const del = Proto.deleteProgram
    Proto.deleteProgram = function (program) {
      const w = window
      w.__deletes = (w.__deletes ?? 0) + 1
      return del.call(this, program)
    }
    Proto.linkProgram = function (program) {
      const w = window
      w.__links = w.__links ?? []
      const who = w.__drawing
      w.__links.push({
        t: performance.now(),
        name: pending[0]?.name ?? '(unnamed)',
        type: pending[0]?.type ?? '?',
        defs: pending[0]?.defs ?? [],
        // WHO WAS BEING DRAWN. three fires onBeforeRender / onBeforeShadow
        // immediately before the draw that forces the compile, so the object
        // recorded there is the owner — the thing six rounds of guessing at H8
        // never had (M55).
        owner: who ? `${who.pass}: ${who.obj} · ${who.mat}${who.parent ? ` under ${who.parent}` : ''}` : '',
      })
      pending = []
      return link.call(this, program)
    }
  }
  patch(window.WebGL2RenderingContext?.prototype)
  patch(window.WebGLRenderingContext?.prototype)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(30000) // the load's own compiles, uploads and streaming

// NAME THE OWNER. three fires Object3D.onBeforeShadow / onBeforeRender right
// before the draw call that forces a compile, so whatever those last recorded
// is the object whose material is being linked. Reach the prototype through a
// live object — three is bundled, there is no global THREE.
await page.evaluate(() => {
  let proto = Object.getPrototypeOf(window.__g.scene)
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'onBeforeShadow')) proto = Object.getPrototypeOf(proto)
  if (!proto) { console.warn('qa-compile: no Object3D prototype found — owners will be blank'); return }
  const tag = (o) => o.name || o.type || '?'
  const slot = { pass: '', obj: '', mat: '', parent: '' }
  window.__drawing = null
  proto.onBeforeShadow = function (r, object) {
    const m = Array.isArray(object.material) ? object.material[0] : object.material
    slot.pass = 'shadow'; slot.obj = tag(object); slot.mat = m ? (m.name || m.type) : '—'; slot.parent = object.parent ? tag(object.parent) : ''
    window.__drawing = slot
  }
  proto.onBeforeRender = function (r, scene, camera, geometry, material) {
    slot.pass = 'main'; slot.obj = tag(this); slot.mat = material ? (material.name || material.type) : '—'; slot.parent = this.parent ? tag(this.parent) : ''
    window.__drawing = slot
  }
})

const mark = () => page.evaluate(() => { const n = (window.__links ?? []).length; window.__mark = n; return n })
const since = () => page.evaluate(() => {
  const all = window.__links ?? []
  const fresh = all.slice(window.__mark ?? 0)
  window.__mark = all.length
  return fresh
})

const boot = await page.evaluate(() => (window.__links ?? []).length)
const bootRoll = await page.evaluate(() => {
  const c = {}
  for (const l of window.__links ?? []) { const k = `${l.type} · ${l.name}`; c[k] = (c[k] ?? 0) + 1 }
  return Object.entries(c).sort((a, b) => b[1] - a[1])
})
console.log(`load linked ${boot} programs:`)
for (const [name, n] of bootRoll) console.log(`   ${String(n).padStart(3)} × ${name}`)
console.log()

await page.evaluate(() => { const g = window.__g; g.setAdaptive(false); g.setPixelRatio(1); g.setTime(0.5); g.game.setGod(true); window.__delMark = window.__deletes ?? 0; window.__keys = new Set(window.__g.renderer.info.programs.map((p) => p.cacheKey)) })
await mark()

for (const [x, z] of LAP) {
  await page.evaluate(([px, pz]) => { const g = window.__g; g.teleport(px, pz); g.setIntent(0, -6); g.frameStats() }, [x, z])
  await page.waitForTimeout(6000)
  const st = await page.evaluate(() => { const s = window.__g.frameStats(); window.__g.setIntent(0, 0); return s })
  const fresh = await since()
  const gone = await page.evaluate(() => { const n = (window.__deletes ?? 0) - (window.__delMark ?? 0); window.__delMark = window.__deletes ?? 0; return n })
  // THE CACHE KEY IS THE TRUTH. Identical shader source that still links a new
  // program means three saw a different cache key — and the key carries things
  // the source never shows. Diff each new key against the nearest older key
  // FOR THE SAME SHADER, and the differing token is the cause.
  const keyDiffs = await page.evaluate(() => {
    const now = window.__g.renderer.info.programs.map((p) => p.cacheKey)
    const seen = window.__keys
    const out = []
    for (const k of now) {
      if (seen.has(k)) continue
      const B = k.split(',')
      let best = null, bestN = 1e9
      for (const o of seen) {
        const A = o.split(',')
        if (A[0] !== B[0]) continue // a different shader entirely
        let n = Math.abs(A.length - B.length)
        for (let i = 0; i < Math.min(A.length, B.length); i++) if (A[i] !== B[i]) n++
        if (n < bestN) { bestN = n; best = A }
      }
      const d = []
      if (best) for (let i = 0; i < Math.max(best.length, B.length); i++) if (best[i] !== B[i]) d.push(`[${i}] ${String(best[i]).slice(0, 60)} → ${String(B[i]).slice(0, 60)}`)
      out.push({ id: B[0].slice(0, 40), n: best ? bestN : -1, diff: d.slice(0, 5) })
      seen.add(k)
    }
    return out
  })
  for (const d of keyDiffs) console.log(`         ↳ NEW KEY ${d.id} · ${d.n < 0 ? 'no sibling with this shader' : d.n + ' token(s) from its nearest sibling'}${d.diff.length ? ': ' + d.diff.join(' | ') : ''}`)
  console.log(`${String(x).padStart(5)},${String(z).padStart(5)}  p50 ${String(st.p50).padStart(5)} max ${String(st.max).padStart(6)} ms · hitches>25ms ${String(st.over25).padStart(3)} · ${fresh.length} LINKS · ${gone} deleted`)
  for (const f of fresh) {
    // only the defines that say what KIND of program this is — the full list
    // is 80 lines of three boilerplate
    const tell = f.defs.filter((d) => /DEPTH_PACKING|SHADOWMAP$|INSTANCING|SKINNING|MORPHTARGETS$|ALPHATEST|USE_MAP|USE_FOG|USE_ENVMAP|VERTEX_COLORS|USE_ALPHAMAP|FLAT_SHADED|DOUBLE_SIDED|USE_TRANSMISSION/.test(d))
    console.log(`         ${f.type} · ${f.name}  [${tell.join(' ')}]`)
    if (f.owner) console.log(`            drawn by ${f.owner}`)
    // WAS THIS MATERIAL ALREADY COMPILED, IN A DIFFERENT SHAPE? If so the
    // interesting thing is not the material but the DEFINE THAT CHANGED —
    // that is the flag whose value the warm-up got wrong.
    const prior = await page.evaluate(([name, type, i]) => {
      const all = window.__links
      const me = all[i]
      const before = all.slice(0, i).filter((l) => l.name === name && l.type === type)
      if (!before.length) return null
      // the closest earlier sibling: fewest defines differing
      let best = null, bestN = 1e9
      for (const b of before) {
        const A = new Set(b.defs), B = new Set(me.defs)
        const only = [...A].filter((d) => !B.has(d)).map((d) => '-' + d).concat([...B].filter((d) => !A.has(d)).map((d) => '+' + d))
        if (only.length < bestN) { bestN = only.length; best = only }
      }
      return best
    }, [f.name, f.type, (await page.evaluate(() => window.__links.length)) - fresh.length + fresh.indexOf(f)])
    if (prior) console.log(`            same material seen before; only these defines differ: ${prior.join(' ') || '(none — an identical program?!)'}`)
  }
}

await browser.close()

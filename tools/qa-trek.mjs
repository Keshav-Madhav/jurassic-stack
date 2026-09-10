// THE TREK: one continuous run across the island, no teleports.
//
// Every other instrument here teleports — qa-hitch, qa-soak, qa-uploads, the
// gates. That is the right way to isolate a region's FIRST-SIGHT cost, and it
// is the wrong way to answer the only question a player actually asks: does it
// stutter while I am running? A teleport gives the terrain streamer, the
// collider builder, the scatter visibility sweep and the upload warden zero
// warning; a player at a sprint gives them a couple of seconds. This walks the
// island the way a player crosses it, and reports what the frame did.
//
//   node tools/qa-trek.mjs [url] [--720] [--speed=8]
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const url = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:4173'
const small = args.includes('--720')
const speed = Number((args.find((a) => a.startsWith('--speed=')) ?? '--speed=8').slice(8))
/** NB `--speed` is the movement INTENT, not the resulting speed: the mover
 *  clamps it to the player's own sprint (~4.4 m/s measured), so a leg of a
 *  kilometre takes about four minutes and the 150 s cap cuts most of them
 *  short. That is fine — the numbers come from the ground actually covered. */
/** path queries a frame; pass a big number for the old unbudgeted behaviour */
const navBudget = Number((args.find((a) => a.startsWith('--nav=')) ?? '--nav=0').slice(6))
/** terrain LOD cache time-to-live in ms; pass a huge number to switch eviction off (M62 A/B) */
const ttl = Number((args.find((a) => a.startsWith('--ttl=')) ?? '--ttl=0').slice(6))

/** south beach → meadow → the wood → the plain → the river → the swamp edge →
 *  back west over the foothills → the dunes. About 5 km of ground. */
const ROUTE = [
  ['the beach', 0, 1560],
  ['the meadow', -140, 1300],
  ['the wood', -286, 793],
  ['the plain', -250, 1040],
  ['the river', 700, 900],
  ['the swamp edge', 620, 620],
  ['the pines', 300, -560],
  ['the foothills', -700, -400],
  ['the dunes', -900, 1250],
]

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const page = await browser.newPage({ viewport: { width: small ? 1280 : 2560, height: small ? 720 : 1440 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(20000) // let the load settle: this is about the WALK

await page.evaluate(([x, z]) => {
  const g = window.__g
  g.setAdaptive(false); g.setPixelRatio(1); g.setTime(0.5); g.game.setGod(true)
  g.teleport(x, z)
}, [ROUTE[0][1], ROUTE[0][2]])
await page.waitForTimeout(6000)
await page.evaluate((n) => {
  if (n[0] > 0) window.__g.game.setNavBudget(n[0])
  if (n[1] > 0) window.__g.game.setTerrainCacheTtl(n[1])
  window.__g.frameStats()
  window.__tex = window.__g.renderer.info.memory.textures
  window.__pro = window.__g.renderer.info.programs.length
  window.__nav = { ...window.__g.game.nav() }
  window.__g.game.worstDino()
}, [navBudget, ttl])

console.log(`trek at ${speed} m/s, ${small ? 1280 : 2560}×${small ? 720 : 1440}${navBudget ? `, nav budget ${navBudget}/frame` : ''}${ttl ? `, terrain cache TTL ${ttl} ms` : ''}\n`)
let worstEver = { ms: 0, leg: '' }
let totalOver25 = 0
let totalOver50 = 0
let metres = 0

for (let i = 1; i < ROUTE.length; i++) {
  const [name, tx, tz] = ROUTE[i]
  const t0 = Date.now()
  let last = null
  const trail = []
  let stuck = false
  let cut = false
  let detours = 0
  // WALK ROUND IT, LIKE A PERSON (M71). Steering straight at the target and
  // nothing else reported two "navigation walls" in the foothills — and both
  // were this bot, not the island. The capsule slides off a trunk perfectly
  // well (measured: 8 m sideways in 4 s against a tree at 20°), but a bot that
  // re-aims dead at the target every tick just presses back into the same pine
  // for ever. `detour` steers perpendicular for a few ticks when progress
  // stalls, alternating sides, which is what a player does without thinking.
  let detour = 0
  let detourSide = 1
  let legOver25 = 0, legOver50 = 0, legMax = 0, legWorst = null, legFrames = 0, legSum = 0
  // steer every 400 ms: point the camera down the line of travel, because what
  // is in the frustum is what has to stream
  for (;;) {
    const at = await page.evaluate(([px, pz, v, det, side]) => {
      const g = window.__g
      const p = g.player()
      const dx = px - p.x, dz = pz - p.z
      const d = Math.hypot(dx, dz) || 1
      let ux = dx / d, uz = dz / d
      if (det > 0) {
        // 75° off the straight line, so it still makes ground toward the target
        const a = side * 1.31
        const cx = Math.cos(a), sn = Math.sin(a)
        const rx = ux * cx - uz * sn, rz = ux * sn + uz * cx
        ux = rx; uz = rz
      }
      g.setIntent(ux * v, uz * v)
      g.setCam(Math.atan2(-ux, -uz), 0.02)
      return { x: p.x, z: p.z, d }
    }, [tx, tz, speed, detour, detourSide])
    if (detour > 0) detour--
    if (last) metres += Math.hypot(at.x - last.x, at.z - last.z)
    last = at
    const st = await page.evaluate(() => window.__g.frameStats())
    legFrames += st.n
    legSum += st.p50 * st.n
    legOver25 += st.over25
    legOver50 += st.n && st.max > 50 ? 1 : 0
    if (st.max > legMax) { legMax = st.max; legWorst = st.worst }
    if (at.d < 12) break
    // STUCK. A river, a cliff or a rock the steering cannot get round — say so
    // and step over it rather than spending the leg's whole budget standing in
    // the water, which is what the first run of this tool did (five of eight
    // legs timed out and the numbers came from a player who was not moving).
    trail.push(at)
    if (trail.length > 12 && detour === 0) {
      const then = trail[trail.length - 12]
      if (Math.hypot(at.x - then.x, at.z - then.z) < 4) {
        // blocked: try sidling round it before declaring the island impassable
        detours++
        if (detours > 6) { stuck = true; break }
        detour = 6
        detourSide = -detourSide
        trail.length = 0
      }
    }
    if (Date.now() - t0 > 150000) { cut = true; break }
    await page.waitForTimeout(400)
  }
  const d = await page.evaluate(() => {
    const t = window.__g.renderer.info.memory.textures, p = window.__g.renderer.info.programs.length
    const n = window.__g.game.nav()
    const o = {
      tex: t - window.__tex, pro: p - window.__pro,
      navCalls: n.calls - window.__nav.calls,
      navMs: n.ms - window.__nav.ms,
      navPeak: n.peakFrameCalls,
      navDenied: n.denied - window.__nav.denied,
      worstDino: window.__g.game.worstDino(),
      terrain: window.__g.mem().terrainEvicted,
    }
    window.__tex = t; window.__pro = p; window.__nav = { ...n }
    return o
  })
  if (legMax > worstEver.ms) worstEver = { ms: legMax, leg: name }
  totalOver25 += legOver25
  totalOver50 += legOver50
  console.log(`→ ${name.padEnd(16)} ${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s · mean ${(legSum / Math.max(1, legFrames)).toFixed(1)} ms · worst ${String(legMax).padStart(6)} ms · frames>25ms ${String(legOver25).padStart(3)} · +${d.pro} progs +${d.tex} tex · paths ${d.navCalls} in ${d.navMs.toFixed(0)} ms (peak ${d.navPeak}/frame, ${d.navDenied} deferred)${stuck ? `  ⟨STUCK at ${Math.round(last.x)},${Math.round(last.z)}, ${Math.round(last.d)} m short after ${detours} detours — stepped over⟩` : cut ? `  ⟨still walking, ${Math.round(last.d)} m short at the 150 s cap — stepped over⟩` : ''}`)
  if (d.terrain && (d.terrain.count || d.terrain.rebuilt)) console.log(`     terrain cache: ${d.terrain.count} LODs freed (${d.terrain.mb} MB), ${d.terrain.rebuilt} REBUILT`)
  if (d.worstDino && d.worstDino.ms > 4) console.log(`     dearest single animal: ${d.worstDino.ms.toFixed(1)} ms — ${d.worstDino.species} (${d.worstDino.state}${d.worstDino.dormant ? ', dormant' : ''}) at ${d.worstDino.dist} m`)
  if (stuck || cut) { await page.evaluate(([px, pz]) => window.__g.teleport(px, pz), [tx, tz]); await page.waitForTimeout(2500) }
  if (legWorst && legWorst.ms > 25) {
    const sec = Object.entries(legWorst.sec).filter(([, v]) => v > 0.5).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' · ')
    console.log(`     worst frame ${legWorst.ms.toFixed(0)} ms: ${sec}`)
  }
}
await page.evaluate(() => window.__g.setIntent(0, 0))
console.log(`\n${Math.round(metres)} m walked · ${totalOver25} frames over 25 ms · ${totalOver50} sample windows with a frame over 50 ms · worst ${worstEver.ms} ms on the way to ${worstEver.leg}`)
if (errors.length) console.log(`\nCONSOLE ERRORS:\n  ${errors.slice(0, 10).join('\n  ')}`)
await browser.close()

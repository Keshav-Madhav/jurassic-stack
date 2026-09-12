// M5 water gate: water queries, swim buoyancy, river current drift, ocean swim.
//   node tools/gate-m5.mjs [url]
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:4173'
let failed = false
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`)
  if (!ok) failed = true
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => { console.error('page error:', e.message); failed = true })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(1000)

// --- find a river midpoint from world meta (via the page) ---
const probe = await page.evaluate(async () => {
  const meta = await (await fetch('world/world-meta.json')).json()
  const path = meta.rivers[0]
  const mid = path[Math.floor(path.length / 2)]
  const g = window.__g
  return {
    mid,
    lake: meta.lakes[0],
    wlRiver: g.game.waterLevelAt(mid.x, mid.z),
    flowRiver: g.game.riverFlowAt(mid.x, mid.z),
    wlOcean: g.game.waterLevelAt(meta.spawn.x, meta.spawn.z + 130), // off the spawn beach
    wlLake: g.game.waterLevelAt(meta.lakes[0].deep.x, meta.lakes[0].deep.z),
    wlDryLand: g.game.waterLevelAt(meta.spawn.x, meta.spawn.z),
  }
})
check(probe.wlRiver !== null, `river reports water (level ${probe.wlRiver?.toFixed(1)})`)
check(probe.flowRiver !== null, `river reports flow (${probe.flowRiver?.x.toFixed(2)}, ${probe.flowRiver?.z.toFixed(2)})`)
check(probe.wlOcean !== null && Math.abs(probe.wlOcean) < 0.01, `ocean reports sea level (${probe.wlOcean})`)
check(probe.wlLake !== null && probe.wlLake > 0.5, `lake reports its level (${probe.wlLake?.toFixed(1)})`)
check(probe.wlDryLand === null, 'spawn beach reports dry')

// --- river swim: drop in with zero intent, the current must carry us ---
await page.evaluate((mid) => {
  const g = window.__g
  g.teleport(mid.x, mid.z)
  g.setIntent(0, 0)
}, probe.mid)
await page.waitForTimeout(800)
const swim0 = await page.evaluate(() => ({ p: window.__g.player(), swimming: window.__g.game.swimming() }))
check(swim0.swimming, 'swimming in the river')
await page.waitForTimeout(4000)
const swim1 = await page.evaluate(() => ({ p: window.__g.player(), swimming: window.__g.game.swimming() }))
const drift = Math.hypot(swim1.p.x - swim0.p.x, swim1.p.z - swim0.p.z)
const alongFlow = (swim1.p.x - swim0.p.x) * probe.flowRiver.x + (swim1.p.z - swim0.p.z) * probe.flowRiver.z
check(drift > 4, `current carried the swimmer ${drift.toFixed(1)}m`)
check(alongFlow > drift * 0.6, `drift is downstream (${alongFlow.toFixed(1)}m along flow)`)
const wlHere = await page.evaluate((p) => window.__g.game.waterLevelAt(p.x, p.z), swim1.p)
if (wlHere !== null) {
  check(Math.abs(swim1.p.y - wlHere) < 2.0, `floating near the surface (y=${swim1.p.y.toFixed(1)} vs level ${wlHere.toFixed(1)})`)
} else {
  check(true, 'drifted out of channel (mouth reached) — acceptable')
}

// --- ocean swim: buoyancy holds at sea level ---
await page.evaluate(() => {
  const g = window.__g
  const sp = g.game.spawn()
  g.teleport(sp.x, sp.z + 130) // just off the beach: shallow, so buoyancy has 2.5 s to surface
  g.setIntent(0, 0)
})
await page.waitForTimeout(2500)
const ocean = await page.evaluate(() => ({ p: window.__g.player(), swimming: window.__g.game.swimming() }))
check(ocean.swimming, 'swimming in the ocean')
check(ocean.p.y > -1.6 && ocean.p.y < 1.6, `buoyant at sea level (y=${ocean.p.y.toFixed(2)})`)

// --- back on land: walking resumes ---
await page.evaluate(() => {
  const g = window.__g
  const sp = g.game.spawn()
  g.teleport(sp.x, sp.z)
  g.setIntent(0, -4)
})
await page.waitForTimeout(1500)
await page.evaluate(() => window.__g.setIntent(0, 0))
const land = await page.evaluate(() => window.__g.game.swimming())
check(!land, 'back to walking on the beach')

// UNDER THE WATER LOOKS LIKE UNDER THE WATER (M67). Swimming used to look
// exactly like walking: the ocean sheet IS drawn from below, but nothing else
// changed — no murk, no colour cast — and the sky's cloud cards drew straight
// over the surface (renderOrder 5-6 against water's 1-4, and the water writes
// no depth), so four metres down you looked up at a clear sky with clouds.
{
  const look = async (y) => {
    await page.evaluate((yy) => {
      const g = window.__g
      g.setTime(0.5); g.game.setGod(true); g.teleport(0, 1760); g.setFreeCam(0, yy, 1760, 0, -0.1)
    }, y)
    await page.waitForTimeout(2500)
    return page.evaluate(() => {
      const f = window.__g.scene.fog
      return { far: Math.round(f.far), hex: f.color.getHexString(), clouds: !!window.__g.scene.getObjectByName('skyExtras')?.children.length }
    })
  }
  const above = await look(3.0)
  const below = await look(-4.5)
  check(above.far > 1000, `above the surface the view is open (fog far ${above.far} m)`)
  check(below.far < 200, `under it the water closes in (fog far ${below.far} m)`)
  check(below.hex !== above.hex, `and the world takes the water's colour (#${above.hex} → #${below.hex})`)
  // back up, and it lifts again rather than sticking
  const again = await look(3.0)
  check(again.far > 1000, `surfacing gives the view back (fog far ${again.far} m)`)
}

// THE WELLSPRING FALL (M72). PLAN has promised since the island v2 that the
// river "pours out of its mouth from a spring pool a few dozen metres up —
// from the beach it looks like the river comes out of the sea cliffs", and
// what the world actually had was a dammed pool ninety metres behind a forty
// metre cliff with nothing running between them. These checks are about the
// three things that can silently stop being true: the channel reaching the
// lip with water in it, the sheet hanging on real rock, and the landing.
{
  const falls = await page.evaluate(() => window.__g.game.falls())
  check(falls.length > 0, `the island has a waterfall (${falls.length})`)
  const f = falls[0]
  check(f.drop > 20, `and it is a real drop, not a step (${f.drop} m)`)
  check(f.foot < 1.0, `it lands in water, not on sand (foot ${f.foot} m)`)

  // the SPILL is a river you can stand in: the gorge above the lip
  await page.evaluate(() => { window.__g.game.setGod(true); window.__g.teleport(1123, -1290) })
  await page.waitForTimeout(1600)
  const inChannel = await page.evaluate(() => {
    const g = window.__g
    const p = g.player()
    return { level: g.game.waterLevelAt(p.x, p.z), ground: g.groundAt(p.x, p.z), flow: g.game.riverFlowAt(p.x, p.z) }
  })
  check(inChannel.level !== null && inChannel.level > inChannel.ground + 0.5,
    `the spill channel holds water (${inChannel.level === null ? 'DRY' : (inChannel.level - inChannel.ground).toFixed(1) + ' m deep'})`)
  check(inChannel.flow !== null, 'and it runs — there is a current in it')
  // ...and it is ABOVE the sea, which is the whole point of the Wellspring
  check(inChannel.ground > 25, `thirty metres up, not at sea level (${inChannel.ground.toFixed(0)} m)`)

  // the sheet hangs on rock: every row of the traced profile must sit at or
  // below the ground it was traced from, or the water is inside the cliff
  const hang = await page.evaluate((name) => {
    const g = window.__g
    const fd = g.game.falls().find((q) => q.name === name)
    let worst = -Infinity
    for (const p of fd.path) worst = Math.max(worst, p.y - g.groundAt(p.x, p.z))
    return worst
  }, f.name)
  check(hang < 3.5, `the sheet follows the rock it was traced on (worst ${hang.toFixed(1)} m proud of it)`)

  // and it is DETACHED when you are nowhere near it (M24)
  await page.evaluate(() => { const s = window.__g.game.spawn(); window.__g.teleport(s.x, s.z) })
  await page.waitForTimeout(1800)
  check((await page.evaluate(() => window.__g.game.falls()))[0].attached === false,
    'and from the spawn beach, 3 km away, it is not in the scene at all')
}

// --- the rivers are see-through (user: "make water a bit transparent for
// rivers"). The depth term rides on the shore block's real heightmap read, so
// what can break silently is the WIRING: a material that stops being marked
// clear goes back to a flat sheet with nothing to show for it.
const clearSheets = await page.evaluate(() => window.__g.setRiverClarity(1))
check(clearSheets >= 3, `the river sheets are the ones authored see-through (${clearSheets} of them)`)

await browser.close()
console.log(failed ? '\nGATE FAILED' : '\nGATE PASSED')
process.exit(failed ? 1 : 0)

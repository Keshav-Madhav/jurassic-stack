// The soak: play for a few minutes through every verb the game has, watching
// for the things gates do not catch — console errors, resources that only ever
// grow (textures, geometries, programs, scene objects), and frame times that
// drift. Everything here is something that has bitten this project at least
// once. node tools/qa-soak.mjs [url]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 200)}`) })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.mouse.click(640, 400)
const snap = async (label) => {
  const r = await page.evaluate(() => ({
    tex: window.__g.renderer.info.memory.textures,
    geo: window.__g.renderer.info.memory.geometries,
    prog: window.__g.renderer.info.programs.length,
    objs: (() => { let n = 0; window.__g.scene.traverse(() => n++); return n })(),
    js: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : 0,
  }))
  console.log(`${label.padEnd(22)} tex ${String(r.tex).padStart(4)} · geo ${String(r.geo).padStart(5)} · progs ${String(r.prog).padStart(3)} · objects ${String(r.objs).padStart(5)} · heap ${r.js} MB`)
  return r
}
const g = (e) => page.evaluate(e)
const first = await snap('after load')

await g('window.__g.game.setGod(true)')
// a lap: walk each region, fight, gather, build, sleep, save/load, toggle settings
const stops = [[0, 1560], [-286, 793], [-250, 1040], [700, 900], [300, -560], [-700, -400], [-900, 1250], [0, -870]]
for (const [x, z] of stops) {
  await page.evaluate(([px, pz]) => { const gg = window.__g; gg.teleport(px, pz); gg.setIntent(0, -6) }, [x, z])
  await page.waitForTimeout(2500)
  await g('window.__g.setIntent(0, 0); window.__g.game.swing()')
  await page.waitForTimeout(400)
}
const afterLap = await snap('after a lap')

// combat and death
for (let i = 0; i < 3; i++) {
  const idx = await g('(() => { const p = window.__g.player(); return window.__g.game.spawnDino("raptor", p.x + 4, p.z - 4) })()')
  await page.waitForTimeout(1500)
  await page.evaluate((k) => window.__g.game.killDino(k), idx)
  await page.waitForTimeout(800)
}
await g('window.__g.game.hurt(999)')
await page.waitForTimeout(800)
const afterFight = await snap('after fights + death')

// build everything, store, sleep, save, reload
await g('["wood","stone","fiber","hide","berry"].forEach((i) => window.__g.game.give(i, 90)); ["workbench","chest","bedroll","campfire","canopy","fence","torch"].forEach((i) => window.__g.game.give(i, 2))')
await g('window.__g.teleport(-120, 1300)')
await page.waitForTimeout(1200)
for (const [item, ox, oz] of [['workbench', 0, -5], ['chest', 5, 0], ['bedroll', 0, 5], ['campfire', -5, 0], ['canopy', 6, -6], ['fence', -6, -6], ['torch', 3, 3]]) {
  await page.evaluate(([it, x, z]) => { const gg = window.__g; gg.teleport(-120 + x, 1300 + z + 3); gg.setCam(0, -0.5); gg.game.selectItem(it); gg.game.swing() }, [item, ox, oz])
  await page.waitForTimeout(400)
}
await g('window.__g.game.chestMove && 1')
await page.keyboard.press('Tab'); await page.waitForTimeout(400); await page.keyboard.press('Tab')
await page.keyboard.press('KeyO'); await page.waitForTimeout(400); await page.keyboard.press('KeyO')
await g('window.__g.game.save()')
await page.waitForTimeout(600)
const afterBuild = await snap('after building + UI')

await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.waitForTimeout(3000)
const afterReload = await snap('after reload')
console.log(`\npieces restored: ${await g('window.__g.game.pieces()')}`)
console.log(`errors/warnings: ${errors.length}`)
for (const e of [...new Set(errors)].slice(0, 12)) console.log('  ' + e)
const grew = (a, b, k) => `${k} ${a[k]} → ${b[k]}`
console.log(`\ngrowth over the run: ${['tex','geo','prog','objs'].map((k) => grew(first, afterBuild, k)).join(' · ')}`)
await browser.close()

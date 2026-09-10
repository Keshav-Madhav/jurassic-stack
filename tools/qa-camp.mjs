// Camp QA: build a hut with a campfire and two torches on the spawn meadow,
// shoot it at noon and at night (the fire has to matter), open the inventory
// (icons, cursor), and check the panel closes on Tab/Esc/✕.
//   node tools/qa-camp.mjs [url] [prefix]
import { chromium } from 'playwright-core'
import { wipeAndReload } from './_page.mjs'
const url = process.argv[2] ?? 'http://localhost:4173'
const prefix = process.argv[3] ?? 'shots/camp'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await wipeAndReload(page)
await page.waitForTimeout(3000)
const g = (expr) => page.evaluate(expr)
await g('window.__g.game.setGod(true); window.__g.setTime(0.5); window.__g.teleport(-30, 1430)')
await g('for (const [id, n] of [["wood", 60], ["stone", 20], ["fiber", 40], ["flint", 4], ["hide", 6], ["berry", 8], ["rawmeat", 3], ["cookedmeat", 2]]) window.__g.game.give(id, n)')
for (const it of ['hatchet', 'spear', 'foundation', 'foundation', 'wall', 'wall', 'wall', 'ceiling', 'ceiling', 'campfire', 'torch']) await page.evaluate((i) => window.__g.game.craft(i), it)
// build: two foundations, walls on the far edges, ceilings, fire + torches
const place = async (item, x, z) => { const ok = await page.evaluate(([item, x, z]) => window.__g.game.placeAt(item, x, z), [item, x, z]); if (!ok) console.log('  could not place', item, 'at', x, z) }
// the grid is 3 m cells: foundations at cell centres, walls aimed at a cell's far edge
await place('foundation', -30, 1425); await place('foundation', -27, 1425)
await place('wall', -30, 1423.7); await place('wall', -27, 1423.7); await place('wall', -31.3, 1425)
await place('ceiling', -30, 1425); await place('ceiling', -27, 1425)
await place('campfire', -24, 1428); await place('torch', -33, 1428); await place('torch', -21, 1428)
console.log('pieces:', await g('window.__g.game.pieces()'))
const shot = async (name, t, x, z, yaw, pitch, y = 1.7) => {
  await page.evaluate(([t, x, z, yaw, pitch, y]) => { const g = window.__g; g.setTime(t); g.teleport(x, z); const gy = g.groundAt(x, z); g.setFreeCam(x, gy + y, z, yaw, pitch) }, [t, x, z, yaw, pitch, y])
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `${prefix}-${name}.png` })
  console.log(`${prefix}-${name}.png`)
}
await shot('noon', 0.5, -27, 1438, 0.15, -0.12, 2.4)
await shot('night', 0.02, -27, 1438, 0.15, -0.12, 2.4)
await shot('night-close', 0.02, -24, 1433, 0, -0.35, 2.2)
await shot('noon-close', 0.5, -24, 1433, 0, -0.35, 2.2)
console.log('building meshes:', await g('(() => { let n = 0, tex = 0; window.__g.scene.getObjectByName("building").traverse((o) => { if (o.isMesh && o.visible) { n++; if (o.material.map) tex++ } }); return n + " (" + tex + " textured)" })()'))
// inventory
await g('window.__g.clearFreeCam()')
await page.keyboard.press('Tab')
await page.waitForTimeout(600)
await page.screenshot({ path: `${prefix}-inventory.png` })
console.log(`${prefix}-inventory.png`)
const open1 = await g('window.__g.game.panelOpen()')
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
const open2 = await g('window.__g.game.panelOpen()')
await page.keyboard.press('Tab'); await page.waitForTimeout(200)
await page.click('#hud-panel .close'); await page.waitForTimeout(200)
const open3 = await g('window.__g.game.panelOpen()')
console.log(`panel: after Tab ${open1} · after Esc ${open2} · after ✕ ${open3}`)
console.log('icons rendered:', await g('window.__g.game.iconCount()'))
await browser.close()

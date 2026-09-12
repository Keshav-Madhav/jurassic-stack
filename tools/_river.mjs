// River clarity probe: frame a flowing river from a steep angle, where the
// bed is what you are trying to see through the sheet.
//   node tools/_river.mjs [url] [suffix]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const tag = process.argv[3] ?? 'now'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await b.newPage({ viewport: { width: 1000, height: 640 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate(() => {
  window.__g.setTime(0.5)
  document.querySelectorAll('body > div').forEach((d) => { if (!d.querySelector('canvas')) d.style.display = 'none' })
})
// pick a real FLOWING leg out of the world meta rather than guessing at
// coordinates: the ring reads as a lake and told me nothing
const legs = await page.evaluate(async () => {
  const meta = await (await fetch('world/world-meta.json')).json()
  const parts = (meta.river?.parts ?? []).filter((p) => p.flow)
  return parts.slice(0, 3).map((p) => {
    const m = p.path[Math.floor(p.path.length / 2)]
    return [p.name, m.x, m.z]
  })
})
const shots = [
  // straight down from 15 m: no guessing which way the channel runs, and the
  // bed either reads through the sheet or it does not
  ...legs.map(([n, x, z], i) => [`leg${i}-${n}`, x, 15, z, 0, -1.45]),

  ['gorge', 1123, 5.0, -1290, -0.45, -0.38] // the spill channel above the fall
]
const scale = Number(process.argv[4] ?? 1)
console.log('clarity scale', scale, '→', await page.evaluate((v) => window.__g.setRiverClarity(v), scale), 'sheets')
// and one from the BANK, which is where anyone actually looks at a river:
// walk outward until the water query says dry, then look back across it
for (const [n, cx, cz] of legs.slice(0, 2)) {
  const bank = await page.evaluate(([x, z]) => {
    const g = window.__g
    for (const dir of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      for (let d = 6; d < 40; d += 2) {
        const bx = x + dir[0] * d, bz = z + dir[1] * d
        if (g.game.waterLevelAt(bx, bz) === null) return { x: bx, z: bz, yaw: Math.atan2(dir[0], dir[1]) }
      }
    }
    return null
  }, [cx, cz])
  if (bank) shots.push([`bank-${n}`, bank.x, 1.7, bank.z, bank.yaw, -0.12])
}
for (const [name, x, y, z, yaw, pitch] of shots) {
  await page.evaluate(([xx, yy, zz, ya, pi]) => {
    const g = window.__g
    g.teleport(xx, zz)
    g.setFreeCam(xx, g.groundAt(xx, zz) + yy, zz, ya, pi)
  }, [x, y, z, yaw, pitch])
  await page.waitForTimeout(1400)
  await page.screenshot({ path: `shots/river-${name}-${tag}.png` })
  console.log(`shots/river-${name}-${tag}.png`)
}
await b.close()

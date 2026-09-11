// Facing audit repeatability (M85): run the mesh audit three times over and
// print each species' spread. Written to answer "is this number stable?" —
// it was not (the stego moved 0.44 between runs), and making it stable then
// showed it was also wrong. Kept because it is the tool that answers that
// question about any future heuristic.
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await b.newPage({ viewport: { width: 900, height: 560 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate(() => {
  const g = window.__g, p = g.player()
  g.game.speciesList().forEach((id, i) => {
    const a = (i / 15) * Math.PI * 2
    g.game.spawnDino(id, p.x + Math.cos(a) * 26, p.z + Math.sin(a) * 26)
  })
})
await new Promise((r) => setTimeout(r, 14000))
const runs = []
for (let i = 0; i < 3; i++) {
  runs.push(await page.evaluate(() => window.__g.game.facingAudit()))
  await new Promise((r) => setTimeout(r, 2500))
}
const ids = [...new Set(runs.flatMap((r) => Object.keys(r)))].sort()
for (const id of ids) {
  const vs = runs.map((r) => r[id]).filter((v) => v !== undefined)
  const spread = vs.length > 1 ? (Math.max(...vs) - Math.min(...vs)).toFixed(2) : 'n/a'
  console.log(`${id.padEnd(12)} ${vs.map((v) => String(v).padStart(6)).join(' ')}   spread ${spread}`)
}
await b.close()

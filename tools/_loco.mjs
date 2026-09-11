// Locomotion probe (M84): hold each movement key and photograph what the body
// does, plus the swim. The blend tree is the thing under test, so every shot
// is paired with locoState() — a screenshot alone cannot tell a strafe clip
// from a forward run on a turned body.
//   node tools/_loco.mjs [url] [outPrefix]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const prefix = process.argv[3] ?? 'shots/loco'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })

const look = async (side, dist = 5.5, up = 0.5) => {
  // yaw points INTO the scene: the free cam looks along -(sin yaw, cos yaw),
  // so a camera parked at +(sin a, cos a) looks back with yaw = a.
  await page.evaluate(([sd, d, u]) => {
    const g = window.__g, p = g.player()
    const a = sd === 'side' ? Math.PI / 2 : sd === 'front' ? Math.PI : 0
    g.setFreeCam(p.x + Math.sin(a) * d, p.y + u, p.z + Math.cos(a) * d, a, -0.06)
  }, [side, dist, up])
  await new Promise((r) => setTimeout(r, 220))
}

const hold = async (key, ms) => {
  await page.keyboard.down(key)
  await new Promise((r) => setTimeout(r, ms))
}

const cases = [
  ['idle', null, 'front'],
  ['fwd', 'KeyW', 'side'],
  ['back', 'KeyS', 'side'],
  ['left', 'KeyA', 'front'],
  ['right', 'KeyD', 'front'],
]
await page.evaluate(() => { window.__g.setTime(0.5); window.__g.setCam(0, 0) })
await new Promise((r) => setTimeout(r, 1200))
for (const [name, key, side] of cases) {
  await page.evaluate(() => window.__g.setCam(0, 0))
  if (key) await hold(key, 1400)
  else await new Promise((r) => setTimeout(r, 800))
  await look(side)
  const st = await page.evaluate(() => window.__g.game.locoState())
  await page.screenshot({ path: `${prefix}-${name}.png` })
  if (key) await page.keyboard.up(key)
  const w = Object.entries(st.weights).filter(([, v]) => v > 0.02).map(([k, v]) => `${k}=${v}`).join(' ')
  console.log(`${name.padEnd(6)} dirF=${String(st.dirF).padStart(5)} dirR=${String(st.dirR).padStart(5)} move=${st.moveWeight}  ${w}`)
  await new Promise((r) => setTimeout(r, 600))
}

// --- the swim ---
for (const [name, z, side, ms] of [['swim-tread', 1700, 'side', 1500], ['swim-stroke', 1700, 'side', 2600]]) {
  await page.evaluate((zz) => { window.__g.teleport(0, zz); window.__g.setCam(Math.PI, 0) }, z)
  await new Promise((r) => setTimeout(r, 1500))
  if (name === 'swim-stroke') await hold('KeyW', ms)
  else await new Promise((r) => setTimeout(r, ms))
  await look(side, 4.5, 1.2)
  const st = await page.evaluate(() => window.__g.game.locoState())
  await page.screenshot({ path: `${prefix}-${name}.png` })
  if (name === 'swim-stroke') await page.keyboard.up('KeyW')
  console.log(`${name.padEnd(11)} swimming=${st.swimming} swimBlend=${st.swimBlend} pitch=${st.pitch} arms=${st.arms} move=${st.moveWeight}`)
}
console.log('clips bound:', (await page.evaluate(() => window.__g.game.locoState())).clips.join(','))
await browser.close()

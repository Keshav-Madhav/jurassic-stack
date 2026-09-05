// Dino QA: (1) the animation audit — every species' clip list and which clip
// each slot (idle/walk/run/attack/ko) resolved to; (2) side-on walking
// portraits: the camera sits 14 m to the dino's LEFT so it should move
// left→right across the frame — a rig that walks backwards shows its head on
// the left.   node tools/qa-dinos.mjs [url] [outPrefix]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const prefix = process.argv[3] ?? 'shots/dino'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(9000)
const audit = await page.evaluate(() => window.__g.game.animAudit())
for (const [id, a] of Object.entries(audit)) {
  const missing = Object.entries(a.slots).filter(([, v]) => v === null).map(([k]) => k)
  console.log(`${id.padEnd(11)} ${missing.length ? 'MISSING ' + missing.join(',') : 'all slots'} · ` + Object.entries(a.slots).map(([k, v]) => `${k}=${v}`).join(' ') + `\n             clips: ${a.clips.join(', ')}`)
}
const only = process.argv[4] ? process.argv[4].split(',') : null
for (const id of Object.keys(audit)) {
  if (only && !only.includes(id)) continue
  // stand near it, wait for it to wander, then frame it side-on
  await page.evaluate((id) => { window.__g.game.setCreative(true); window.__g.game.setFlying(true); window.__g.game.gotoSpecies(id, 30) }, id)
  let pose = null
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500)
    pose = await page.evaluate((id) => window.__g.game.dinoPose(id), id)
    if (pose && pose.speed > 0.5 && (pose.state === 'wander' || pose.state === 'flee' || pose.state === 'aggro')) break
  }
  if (!pose) continue
  // its left side: heading h moves along (sin h, cos h); left = (-cos h, sin h)... camera 14 m out on the left, looking back at it
  const lx = -Math.cos(pose.heading), lz = Math.sin(pose.heading)
  const dist = Math.max(7, (audit[id].height ?? 3) * 3.2)
  await page.evaluate(([p, lx, lz, dist, h]) => {
    const g = window.__g
    g.setTime(0.5)
    const cx = p.x + lx * dist, cz = p.z + lz * dist
    const yaw = Math.atan2(-(p.x - cx), -(p.z - cz))
    const cy = Math.max(g.groundAt(cx, cz) + 1.4, p.y + h * 0.55)
    const pitch = -Math.atan2(cy - (p.y + h * 0.45), dist)
    g.setFreeCam(cx, cy, cz, yaw, pitch)
  }, [pose, lx, lz, dist, audit[id].height ?? 3])
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${prefix}-${id}.png` })
  // ground truth: where did it actually go over the next second, in camera terms?
  const p2 = await page.evaluate((id) => window.__g.game.dinoPose(id), id)
  await page.waitForTimeout(1000)
  const p3 = await page.evaluate((id) => window.__g.game.dinoPose(id), id)
  // camera right vector = the animal's heading direction (camera looks from its left)
  const rx = Math.sin(pose.heading), rz = Math.cos(pose.heading)
  const moved = p3 && p2 ? (p3.x - p2.x) * rx + (p3.z - p2.z) * rz : 0
  console.log(`${prefix}-${id}.png  (${pose.state}, speed ${pose.speed.toFixed(1)}) — it moved ${moved > 0.2 ? 'RIGHT' : moved < -0.2 ? 'LEFT' : 'barely'} across the frame (${moved.toFixed(1)} m/s); the head must point that way`)
  await page.evaluate(() => window.__g.clearFreeCam())
}
await browser.close()

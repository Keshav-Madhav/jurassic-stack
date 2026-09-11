// Animation gate (M84): the body has to match what the player is doing.
// Locomotion used to spin the model to face whatever key you pressed (so
// backing away played a forward sprint), swimming was an upright alert-idle
// sliding through the water, and all three tools shared one carry rotation.
// Each of those looked fine in a still and wrong in motion, so every check
// here reads the live blend tree or a measured transform, never a pixel.
//   node tools/gate-anim.mjs [url]
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
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
const state = () => page.evaluate(() => window.__g.game.locoState())
const settle = (ms) => page.waitForTimeout(ms)

await page.evaluate(() => { window.__g.setTime(0.5); window.__g.setCam(0, 0) })
await settle(1200)

// --- 1. the clips the rig carries are all bound ---
const st0 = await state()
for (const slot of ['idle', 'armed', 'walk', 'run', 'back', 'left', 'right', 'air', 'punch', 'chop', 'throw', 'hurt', 'interact']) {
  check(st0.clips.includes(slot), `clip bound: ${slot}`)
}
check(st0.arms === 2 && st0.forearms === 2, `swim arm bones matched (${st0.arms} upper, ${st0.forearms} fore)`)

// --- 2. directional locomotion: the body holds the camera heading and the
// direction is carried by the clip, not by spinning the model ---
const face0 = st0.facing
for (const [key, want, dir] of [['KeyW', 'walk', [1, 0]], ['KeyS', 'back', [-1, 0]], ['KeyA', 'left', [0, -1]], ['KeyD', 'right', [0, 1]]]) {
  await page.evaluate(() => window.__g.setCam(0, 0))
  await page.keyboard.down(key)
  await settle(1300)
  const st = await state()
  await page.keyboard.up(key)
  const w = st.weights[want]
  const others = Object.entries(st.weights).filter(([k]) => ['walk', 'run', 'back', 'left', 'right'].includes(k) && k !== want)
  check(w > 0.8, `${key} → ${want} clip carries the movement (${w})`)
  check(others.every(([, v]) => v < 0.2), `${key} → no other locomotion clip fights it (${others.map(([k, v]) => `${k}=${v}`).join(' ')})`)
  check(Math.abs(st.dirF - dir[0]) < 0.25 && Math.abs(st.dirR - dir[1]) < 0.25, `${key} → travel reads [${st.dirF}, ${st.dirR}] in body space`)
  check(Math.abs(st.facing - face0) < 0.05, `${key} → the body kept the camera's heading (${st.facing})`)
  await settle(700)
}

// --- 3. held tools: the fist is on the grip and the tool points somewhere
// sane in the player's own frame ---
await page.evaluate(() => { for (const i of ['hatchet', 'spear', 'torch']) window.__g.game.give(i, 1) })
await settle(500)
for (const [item, armed, minY] of [['hatchet', true, -0.2], ['spear', true, 0.5], ['torch', false, 0.8]]) {
  const ok = await page.evaluate((i) => window.__g.game.selectItem(i), item)
  await settle(800)
  const p = await page.evaluate(() => window.__g.game.heldProbe())
  const st = await state()
  check(ok && p && p.item === item, `${item} equips into the hand`)
  check(p && p.gripGap < 0.2, `${item} held at the grip end (butt ${p?.gripGap} m from the fist)`)
  check(p && p.dir[1] >= minY, `${item} points sensibly (up-component ${p?.dir[1]})`)
  check(armed ? st.armBlend > 0.9 : st.armBlend < 0.1, `${item} ${armed ? 'raises a ready stance' : 'is carried, not readied'} (armBlend ${st.armBlend})`)
}
// the spear is long: it must not be carried horizontally through the world
const spear = await page.evaluate(() => { window.__g.game.selectItem('spear'); return window.__g.game.heldProbe() })
check(spear.tip[1] > 1.6, `the spear's point is carried high (tip y ${spear.tip[1]} m)`)

// --- 4. the swim ---
await page.evaluate(() => window.__g.game.selectItem('hatchet'))
await page.evaluate(() => { window.__g.setCam(Math.PI, 0); window.__g.teleport(0, 1700) })
await settle(1800)
const tread = await state()
check(tread.swimming && tread.swimBlend > 0.9, `deep water puts him in the swim state (blend ${tread.swimBlend})`)
check(tread.weights.air < 0.05, `swimming is not the airborne clip (air ${tread.weights.air})`)
check(tread.pitch > 0.15 && tread.pitch < 0.7, `treading water holds him upright-ish (pitch ${tread.pitch} rad)`)
await page.keyboard.down('KeyW')
await settle(2000)
const swim = await state()
await page.keyboard.up('KeyW')
check(swim.pitch > 1.2, `stroking tips him prone (pitch ${swim.pitch} rad)`)
check(swim.bodyY > -0.25 && swim.bodyY < 0.4, `he floats at the surface, not under it (body y ${swim.bodyY})`)
await settle(2500)
const after = await state()
check(after.pitch < 0.7, `the prone pitch relaxes when he stops (pitch ${after.pitch})`)

// --- 5. dinosaur facing: no rig may walk backwards. This reads the MESH, not
// bone names, so it covers the four rigs whose bones are called "Bone.001" —
// and only LIVE rigs, because a dormant animal's skeleton is parked in an
// arbitrary pose and measuring it is measuring nothing (see backProbe).
await page.evaluate(() => {
  const g = window.__g, p = g.player()
  g.teleport(0, 1560)
  g.game.speciesList().forEach((id, i) => {
    const a = (i / 15) * Math.PI * 2
    g.game.spawnDino(id, p.x + Math.cos(a) * 26, p.z + Math.sin(a) * 26)
  })
})
await settle(14000)
const audit = await page.evaluate(() => window.__g.game.facingAudit())
const species = await page.evaluate(() => window.__g.game.speciesList())
check(Object.keys(audit).length >= species.length - 2, `facing audit read ${Object.keys(audit).length} live rigs of ${species.length}`)
// -0.15, not 0: the measure is the centroid of the top FIFTH of the body
// projected on the travel axis, and on a rig with a high-held tail (carno,
// allo) or a dorsal sail over the hips (spino) that centroid sits slightly
// behind centre while the animal is plainly walking forwards — all three
// were checked against side-on walking portraits. A rig that is genuinely
// reversed lands between -0.2 and -0.7, which this still catches.
const backwards = Object.entries(audit).filter(([, v]) => v < -0.15)
check(backwards.length === 0, `no rig walks backwards (${backwards.map(([k, v]) => `${k}=${v}`).join(' ') || 'all forward'})`)
console.log('  facing audit:', JSON.stringify(audit))

// --- 6. the saddle: the rider's hip has to land ON the animal's back. These
// are measured numbers now (seatFit), not hand-typed ones, so they can be
// asserted. ±0.3 is the measurement's own noise: a walking animal's mid-body
// back height moves by about that much through its stride.
await page.evaluate(() => { window.__g.game.setCreative(true); window.__g.game.give('saddle', 10) })
await settle(900)
for (const sp of ['raptor', 'parasaur']) {
  const idx = await page.evaluate((i) => { const p = window.__g.player(); return window.__g.game.spawnDino(i, p.x + 5, p.z - 4) }, sp)
  try { await page.waitForFunction((i) => window.__g.game.gotoDinoIndex(i) === true, idx, { timeout: 15000 }) } catch { /* reported below */ }
  for (const want of ['ko', 'tamed']) {
    for (let a = 0; a < 12; a++) {
      await page.evaluate(([i, w]) => { window.__g.game.gotoDinoIndex(i); return w === 'ko' ? window.__g.game.swing() : window.__g.game.interact() }, [idx, want])
      try { await page.waitForFunction(([i, w]) => window.__g.game.dinoStates()[i]?.state === w, [idx, want], { timeout: 1500 }); break } catch { /* again */ }
    }
  }
  let riding = false
  for (let a = 0; a < 4 && !riding; a++) {
    await page.evaluate((i) => { window.__g.game.gotoDinoIndex(i); window.__g.game.interact() }, idx)
    try { await page.waitForFunction('window.__g.game.riding() === true', null, { timeout: 2500 }); riding = true } catch { /* again */ }
  }
  check(riding, `${sp} can be knocked out, tamed and ridden`)
  if (!riding) continue
  await settle(1000)
  const fit = await page.evaluate(() => window.__g.game.seatFit())
  check(fit.sitBlend > 0.9, `${sp}: the rider is in the straddle, not standing (sitBlend ${fit.sitBlend})`)
  check(Math.abs(fit.hipOverBack - 0.1) < 0.3, `${sp}: the rider's hip sits on the back (${fit.hipOverBack} m over it)`)
  for (let a = 0; a < 5; a++) {
    await page.evaluate(() => window.__g.game.interact())
    try { await page.waitForFunction('window.__g.game.riding() === false', null, { timeout: 2000 }); break } catch { /* again */ }
  }
}

await browser.close()
console.log(failed ? 'GATE FAILED' : 'GATE PASSED')
process.exit(failed ? 1 : 0)

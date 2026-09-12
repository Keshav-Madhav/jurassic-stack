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

// THE DIVE (M86). The buoyancy used to push the head back to the surface the
// instant it dipped below, so the sea floor — and the rocks, weed and shelves
// scattered over it — could not be reached at all.
await page.evaluate(() => window.__g.teleport(0, 1740))
await settle(2600)
const floatY = (await page.evaluate(() => window.__g.player())).y
await page.keyboard.down('ShiftLeft')
await settle(3200)
const deep = await state()
const deepY = (await page.evaluate(() => window.__g.player())).y
const sub = await page.evaluate(() => window.__g.game.air().submerged)
check(deep.diving === true, 'SHIFT in deep water reads as a dive')
check(deepY < floatY - 2.5, `he goes down (${floatY.toFixed(1)} → ${deepY.toFixed(1)} m)`)
check(sub > 0.9, `the camera is under the surface (submerged ${sub.toFixed(2)})`)
const bed = await page.evaluate(() => { const p = window.__g.player(); return window.__g.groundAt(p.x, p.z) })
check(deepY - bed < 2.0, `he reaches the sea floor (${(deepY - bed).toFixed(1)} m above it)`)
await page.keyboard.up('ShiftLeft')
await settle(4000)
const backUp = (await page.evaluate(() => window.__g.player())).y
check(backUp > deepY + 2, `letting go floats him back up (${deepY.toFixed(1)} → ${backUp.toFixed(1)} m)`)
const surf = await state()
check(surf.diving === false, 'and the dive flag clears')

// --- 5. dinosaur facing is NOT checked here, and the reason is worth
// recording. Two rig-agnostic measurements were tried: where the top fifth of
// the body sits along the travel axis, and which way the walk cycle slides
// the ground-contact vertices. Both are plausible and both are wrong — the
// first reads a raised tail as a head (raptor -0.19, trike -0.36), the second
// reads root-motion clips as no motion at all and put the trike at +1.6.
// All of those animals were then photographed walking, side-on, by
// `qa-dinos.mjs`, and every one of them leads with its head. The real check
// is the head-BONE probe in gate-m4, which is a measurement rather than a
// heuristic and covers the twelve rigs that name their bones; the four that
// do not (carno, spino, trike, sauropelta) are verified by portrait. A gate
// that asserts a number nobody trusts is worse than no gate.

// --- 6. the flinch. Four rigs carry a hurt clip; the invariant is that a
// species which DECLARES one binds it (a renamed clip would unbind silently)
// and that being hit actually plays it.
const flinch = await page.evaluate(() => window.__g.game.flinchAudit())
const declared = Object.entries(flinch).filter(([, v]) => v.declared)
check(declared.length >= 4, `the rigs that carry a flinch declare it (${declared.map(([k]) => k).join(' ')})`)
const unbound = declared.filter(([, v]) => !v.bound)
check(unbound.length === 0, `every declared flinch is bound (${unbound.map(([k]) => k).join(' ') || 'all bound'})`)
{
  const idx = await page.evaluate(() => { const p = window.__g.player(); return window.__g.game.spawnDino('raptor', p.x + 4, p.z - 3) })
  // wait for the RIG, not just the object: the clips arrive after it appears
  try {
    await page.waitForFunction((j) => { const f = window.__g.game.dinoFlinch(j); return !!f && f.bound }, idx, { timeout: 15000 })
  } catch { /* the check below reports it */ }
  let hit = null
  for (let a = 0; a < 6 && !(hit && hit.t > 0); a++) {
    hit = await page.evaluate((j) => {
      window.__g.game.gotoDinoIndex(j)
      window.__g.game.swing()
      return { f: window.__g.game.dinoFlinch(j), t: window.__g.game.dinoStates()[j]?.torpor ?? 0 }
    }, idx)
    await settle(120)
  }
  check(hit?.t > 0, `the test raptor took the blow (torpor ${hit?.t})`)
  check(!!hit?.f?.running, `being hit plays the rig's flinch (${hit?.f?.seconds}s clip)`)
}

// --- 5b. THE JUMP. The rig has no jump clip, so the airborne slot falls back
// to an alert idle: without a pose over the top of it the castaway stands
// bolt upright a metre above the grass on every jump.
await page.evaluate(() => { window.__g.teleport(0, 1560); window.__g.setCam(0, 0) })
await settle(1500)
const ground = await state()
check(ground.tuck < 0.05, `standing on the ground there is no air pose (tuck ${ground.tuck})`)
// HOLD it: the jump is read inside the fixed step, and a keyboard.press is
// down-and-up inside 10 ms — one 16 ms step can miss it entirely
await page.keyboard.down('Space')
await settle(140)
await page.keyboard.up('Space')
const rising = await state()
check(rising.airBlend > 0.5, `a jump reads as airborne (blend ${rising.airBlend})`)
check(rising.tuck > 0.3, `and the legs tuck on the way up (tuck ${rising.tuck})`)
// and the landing crouch, which lasts 0.42 s — too short to sample blind
let crouch = 0
try {
  await page.waitForFunction('window.__g.game.locoState().land > 0.15', null, { timeout: 4000, polling: 30 })
  crouch = (await state()).land
} catch { /* reported below */ }
check(crouch > 0.15, `touching down spends the fall on a crouch (land ${crouch})`)
await settle(1400)
const landed = await state()
check(landed.tuck < 0.05 && landed.airBlend < 0.1, `landing clears it again (tuck ${landed.tuck}, air ${landed.airBlend})`)
check(landed.land === 0, `and the crouch comes back up (land ${landed.land})`)

// --- 6a. one blow is not every blow. Six rigs carry more than one attack and
// every fight used to play the same single clip.
const atk = await page.evaluate(() => window.__g.game.attackAudit())
const many = Object.entries(atk).filter(([, v]) => v >= 2)
check(many.length >= 6, `the rigs with more than one attack bind them all (${many.map(([k, v]) => `${k}:${v}`).join(' ')})`)
// the one-clip rigs are the ones with none, and that is correct: their single
// cycle is re-timed for the attack rather than cross-faded (M52)
const none = Object.entries(atk).filter(([, v]) => v === 0).map(([k]) => k).sort()
check(none.join(',') === 'dilo,sauropelta,spino', `only the one-clip rigs have no attack action (${none.join(' ') || 'none'})`)

// the raptor eats rather than chewing a slowed bite (its rig ships "Eat Prey")
const audit = await page.evaluate(() => window.__g.game.animAudit())
check(!!audit.raptor?.slots?.eat, `the raptor has a feeding clip of its own (${audit.raptor?.slots?.eat})`)

// --- 6c. the head follows you. Eleven rigs name a head or neck bone; the
// four that call everything Bone.001 do not track, and that is the same four
// the facing probe cannot read.
{
  const idx = await page.evaluate(() => { const p = window.__g.player(); return window.__g.game.spawnDino('stego', p.x + 12, p.z - 10) })
  try {
    await page.waitForFunction((j) => window.__g.game.dinoHead(j)?.bone, idx, { timeout: 15000 })
  } catch { /* reported below */ }
  const bone = (await page.evaluate((j) => window.__g.game.dinoHead(j), idx))?.bone
  check(!!bone, `the stego's head bone is bound (${bone})`)
  // COMPARE THE YAW AGAINST THE BEARING IT IS AIMING AT, not against the side
  // the player stands on: an animal that turns its whole BODY to face you has
  // nothing left to turn its head by, and reads as a failure. That is exactly
  // how this check failed first time (left -0.019 with the stego squared up).
  const sampleSide = async (side) => {
    await page.evaluate(([j, sd]) => { const p = window.__g.game.dinoPos(j); window.__g.teleport(p.x + sd * 9, p.z + 1) }, [idx, side])
    await settle(2200)
    return await page.evaluate((j) => window.__g.game.dinoHead(j), idx)
  }
  let agreed = 0
  let testable = 0
  for (const side of [-1, 1]) {
    const h = await sampleSide(side)
    if (!h || Math.abs(h.bearing) < 0.2) continue
    testable++
    if (Math.sign(h.yaw) === Math.sign(h.bearing) && Math.abs(h.yaw) > 0.05) agreed++
  }
  check(testable > 0 && agreed === testable, `and the head turns the way it is looking (${agreed}/${testable} samples agreed)`)
  const heads = await page.evaluate(() => window.__g.game.headAudit())
  const tracked = Object.entries(heads).filter(([, v]) => v.bone)
  check(tracked.length >= 10, `most of the roster can turn its head (${tracked.length} of ${Object.keys(heads).length})`)
}

// --- 6b. the death. Four rigs carry a collapse distinct from their knockout
// and used to play the knockout for both.
const deaths = await page.evaluate(() => window.__g.game.deathAudit())
const withDeath = Object.entries(deaths).filter(([, v]) => v.declared > 0)
check(withDeath.length >= 4, `the rigs with a death clip declare one (${withDeath.map(([k]) => k).join(' ')})`)
const shortDeath = withDeath.filter(([, v]) => v.bound < v.declared)
check(shortDeath.length === 0, `every declared death clip is bound (${shortDeath.map(([k, v]) => `${k} ${v.bound}/${v.declared}`).join(' ') || 'all bound'})`)
{
  // a stego is the unambiguous one: it stands 3 m and its death clip lays it
  // flat, so the collapse can be measured and not just named
  const idx = await page.evaluate(() => { const p = window.__g.player(); return window.__g.game.spawnDino('stego', p.x + 9, p.z - 7) })
  try {
    await page.waitForFunction((j) => { const d = window.__g.game.dinoDeath(j); return !!d && d.bound > 0 }, idx, { timeout: 15000 })
  } catch { /* reported below */ }
  const standing = await page.evaluate((j) => window.__g.game.dinoHeight(j), idx)
  const st = await page.evaluate((j) => { window.__g.game.killDino(j); return window.__g.game.dinoDeath(j) }, idx)
  check(!!st?.running, `killing a stego plays its death clip (${st?.clip})`)
  await settle(2600)
  const down = await page.evaluate((j) => window.__g.game.dinoHeight(j), idx)
  check(standing !== null && down !== null && down < standing * 0.66,
    `and it goes down with it (${standing?.toFixed(1)} → ${down?.toFixed(1)} m)`)
}

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
  // the rider is not welded on: main feeds the mount's pace to the seat pose
  await page.keyboard.down('KeyW')
  await settle(1400)
  const moving = await state()
  await page.keyboard.up('KeyW')
  check(moving.rideSpeed > 0.05, `${sp}: the seat knows the animal's pace (rideSpeed ${moving.rideSpeed})`)
  for (let a = 0; a < 5; a++) {
    await page.evaluate(() => window.__g.game.interact())
    try { await page.waitForFunction('window.__g.game.riding() === false', null, { timeout: 2000 }); break } catch { /* again */ }
  }
}

await browser.close()
console.log(failed ? 'GATE FAILED' : 'GATE PASSED')
process.exit(failed ? 1 : 0)

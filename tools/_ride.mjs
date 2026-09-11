// Ride portraits (M84): mount every rideable species in turn and photograph
// the rider on its back, side-on, with the seat numbers printed beside the
// shot. Fifteen hand-typed seat offsets cannot be judged any other way.
//   node tools/_ride.mjs [url] [only]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const only = process.argv[3] ? process.argv[3].split(',') : null
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
await page.evaluate(() => {
  window.__g.setTime(0.5)
  window.__g.game.setCreative(true)
  // MOUNTING CONSUMES A SADDLE. Creative grants materials, not saddles, so
  // after five animals the run was out and every species after that reported
  // "could not mount" — a probe running dry, not a game that cannot be ridden.
  window.__g.game.give('saddle', 40)
})
await page.waitForTimeout(1200)
// speciesList() is an ARRAY of ids, not a map — reading it with
// Object.entries gives "0".."14", and spawnDino then quietly gave every
// portrait the same raptor.
const list = await page.evaluate(() => window.__g.game.speciesList())
const species = only ?? list
console.log('rideable:', species.join(' '))
// SPREAD THE SPAWNS OUT. interact() mounts the NEAREST tame, not the one
// under the crosshair, so leaving the last species tamed a few metres away
// made the next iteration climb back onto it — the run reported a carno seat
// that was really the stego's, one row off the whole way down.
// ...but spread them on a RING around the spawn, not along a line: a line of
// 70 m steps put the tenth species 700 m out to sea, and its portrait came
// back as an underwater silhouette.
const home = await page.evaluate(() => window.__g.player())
let slot = 0
for (const id of species) {
  slot++
  const idx = await page.evaluate(([sp, k, n, hx, hz]) => {
    const a = (k / n) * Math.PI * 2
    return window.__g.game.spawnDino(sp, hx + Math.cos(a) * 70, hz + Math.sin(a) * 70)
  }, [id, slot, species.length, home.x, home.z])
  // WAIT FOR THE RIG. gotoDinoIndex() refuses an animal whose object is not
  // visible yet, and the big rigs (apato, mammoth) are still loading at
  // 900 ms — the swing then went nowhere and they "would not KO".
  try {
    await page.waitForFunction((i) => window.__g.game.gotoDinoIndex(i) === true, idx, { timeout: 15000 })
  } catch { console.log(`${id.padEnd(12)} never became visible`); continue }
  const rideable = await page.evaluate((i) => window.__g.game.dinoStates()[i]?.rideable, idx)
  if (!rideable) { console.log(`${id.padEnd(12)} not rideable, skipped`); continue }
  // KO and tame both need the crosshair on the animal, and one press is not
  // reliably enough on the big rigs — six of fifteen species never mounted
  // when this waited a flat 400 ms and moved on.
  const untilState = async (want) => {
    for (let a = 0; a < 12; a++) {
      // teleport and swing in ONE evaluate: a wandering animal walks out of
      // the 3.2 m reach during the round trip, which is why the big herbivores
      // "would not KO" while the raptor next to them went down first press.
      await page.evaluate(([i, v]) => {
        window.__g.game.gotoDinoIndex(i)
        return v === 'ko' ? window.__g.game.swing() : window.__g.game.interact()
      }, [idx, want])
      try {
        await page.waitForFunction(([i, w]) => window.__g.game.dinoStates()[i]?.state === w, [idx, want], { timeout: 1800 })
        return true
      } catch { /* press again */ }
    }
    return false
  }
  if (!(await untilState('ko'))) { console.log(`${id.padEnd(12)} would not KO`); continue }
  if (!(await untilState('tamed'))) { console.log(`${id.padEnd(12)} would not tame`); continue }
  let riding = false
  for (let a = 0; a < 4 && !riding; a++) {
    await page.evaluate((i) => window.__g.game.gotoDinoIndex(i), idx)
    await page.evaluate(() => window.__g.game.interact())
    try {
      await page.waitForFunction('window.__g.game.riding() === true', null, { timeout: 2500 })
      riding = true
    } catch { /* press again */ }
  }
  if (!riding) { console.log(`${id.padEnd(12)} could not mount`); continue }
  await page.waitForTimeout(900) // the straddle blends in over ~0.3 s; reading it at once said sit=0
  const fit = await page.evaluate(() => window.__g.game.seatFit())
  // FRAME ON THE RIDER, not on g.player() — which returns the MOUNT's
  // position while riding, so the first pass photographed the animal with the
  // castaway a speck in the background.
  await page.evaluate((r) => {
    window.__g.setFreeCam(r[0] + 3.4, r[1] + 1.0, r[2], Math.PI / 2, -0.16)
  }, fit.riderPos)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `shots/ride-${id}.png` })
  await page.evaluate(() => window.__g.clearFreeCam())
  await page.waitForTimeout(700)
  await page.screenshot({ path: `shots/ride-${id}-play.png` })
  console.log(`${id.padEnd(12)} sit=${fit.sitBlend} seatY=${String(fit.seat.y).padStart(5)} back=${String(fit.backAboveFeet).padStart(5)} hip=${fit.hipAboveOrigin} hipOverBack=${String(fit.hipOverBack).padStart(6)} suggest=${String(fit.suggestY).padStart(5)} axis=${fit.axis} torso=${fit.torsoAlong}`)
  // DISMOUNT, AND MAKE SURE OF IT. swing() and interact() both return early
  // while `riding` is set, so one missed dismount silently poisons every
  // species after it: the run reported an `allo` seat that was really the
  // stego's, and five animals that "could not mount" were never approached
  // because the player was still on the last one.
  for (let a = 0; a < 5; a++) {
    await page.evaluate(() => window.__g.game.interact())
    try {
      await page.waitForFunction('window.__g.game.riding() === false', null, { timeout: 2000 })
      break
    } catch { /* press again */ }
  }
  await page.waitForTimeout(400)
}
await browser.close()

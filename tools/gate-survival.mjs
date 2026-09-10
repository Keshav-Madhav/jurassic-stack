// Gate: survival (M21). Food and water drain and refill; stamina gates the
// sprint; a carcass yields meat and hide; meat cooks at a campfire; drinking
// works at the water's edge; starving bleeds hp; everything survives a reload.
//   node tools/gate-survival.mjs [url]
import { chromium } from 'playwright-core'
import { wipeAndReload } from './_page.mjs'
const url = process.argv[2] ?? 'http://localhost:4173'
let failed = false
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await wipeAndReload(page)
await page.waitForTimeout(3000)
const g = (expr) => page.evaluate(expr)

const s0 = await g('window.__g.game.survival()')
check(s0.food > 95 && s0.water > 95 && s0.stamina > 95, `fresh spawn: food ${s0.food.toFixed(0)} water ${s0.water.toFixed(0)} stamina ${s0.stamina.toFixed(0)}`)
// five bars since M50: hp, food, water, stamina, and warmth (hidden until the
// cold is real, so this counts the elements, not the visible ones)
check(await page.evaluate(() => document.querySelectorAll('#hud-vitals .bar').length === 5), 'five vitals bars in the HUD')
check(await page.evaluate(() => document.querySelector('#hud-vitals .bar.warmth').hidden), 'and warmth is hidden while you are warm')

// drains while sprinting (creative off): 12 s of sprint
await g('window.__g.game.setGod(true); window.__g.game.setCreative(false); window.__g.teleport(0, 1560); window.__g.setIntent(0, -9)')
await page.waitForTimeout(12000)
const s1 = await g('window.__g.game.survival()')
await g('window.__g.setIntent(0, 0)')
check(s1.food < s0.food && s1.water < s0.water, `food/water drain while moving: ${s1.food.toFixed(1)} / ${s1.water.toFixed(1)}`)

// stamina: run it dry → winded; a sprint burst from full lasts ~9 s
await g('window.__g.game.setSurvival({ stamina: 3 })')
await g('window.__g.teleport(0, 1560); window.__g.setIntent(0, -9)')
await page.waitForTimeout(1200)
const winded = await g('window.__g.game.survival()')
await g('window.__g.setIntent(0, 0)')
check(winded.winded === true, `stamina runs dry sprinting → winded (${winded.stamina.toFixed(0)})`)
await page.waitForTimeout(3000)
const s2 = await g('window.__g.game.survival()')
check(s2.stamina > 30 && s2.winded === false, `stamina regenerates (${s2.stamina.toFixed(0)}) and winded clears over 25`)

// eat: berries restore food
await g('window.__g.game.setSurvival({ food: 40 })')
await g('window.__g.game.give("berry", 3)')
await page.keyboard.press('KeyF')
await page.waitForTimeout(200)
const s3 = await g('window.__g.game.survival()')
check(s3.food > 45, `a berry restores food (${s3.food.toFixed(0)})`)

// carcass → meat + hide: spawn a raptor, creative-KO... no: kill it with a spear (creative punch KOs; use spear 12 dmg × 12)
await g('window.__g.game.give("spear", 1); window.__g.game.selectItem("spear")')
const idx = await page.evaluate(() => { const p = window.__g.player(); return window.__g.game.spawnDino('pachy', p.x + 2.5, p.z - 1) })
await page.waitForTimeout(1500)
for (let i = 0; i < 30; i++) { // 160 hp / 12 a spear = 14 hits; the swing cools 0.45 s
  await page.evaluate((i) => window.__g.game.gotoDinoIndex(i), idx)
  await g('window.__g.game.swing()')
  await page.waitForTimeout(480)
  if ((await page.evaluate((i) => window.__g.game.dinoStates()[i].state, idx)) === 'dead') break
}
check((await page.evaluate((i) => window.__g.game.dinoStates()[i].state, idx)) === 'dead', 'the pachy is killed (a carcass)')
let meat = 0
for (let i = 0; i < 6; i++) {
  await page.evaluate((i) => window.__g.game.gotoDinoIndex(i), idx)
  await g('window.__g.game.swing()')
  await page.waitForTimeout(480)
  meat = await g('window.__g.game.count("rawmeat")')
}
const hide = await g('window.__g.game.count("hide")')
check(meat >= 2 && hide >= 1, `harvested the carcass: ${meat} raw meat, ${hide} hide`)

// cook at a campfire
await g('window.__g.game.give("campfire", 1); window.__g.game.selectItem("campfire")')
await page.evaluate(() => { const g = window.__g; g.setCam(0, -0.6) })
await page.waitForTimeout(300)
await g('window.__g.game.swing()') // place
await page.waitForTimeout(400)
const placed = await g('window.__g.game.pieces()')
check(placed >= 1, `campfire placed (${placed} pieces)`)
const pre = await page.evaluate(() => { const g = window.__g; const p = g.player(); return { raw: g.game.count('rawmeat'), nearFire: g.game.nearFire?.(), prompt: document.getElementById('hud-prompt')?.textContent, x: p.x.toFixed(1), z: p.z.toFixed(1) } })
await g('window.__g.game.interact()')
await page.waitForTimeout(200)
const cooked = await g('window.__g.game.count("cookedmeat")')
if (cooked < 1) console.log('   cook debug:', JSON.stringify(pre), 'toast:', await page.evaluate(() => document.getElementById('hud-toast')?.textContent))
check(cooked >= 1, `cooked at the fire: ${cooked} cooked meat`)
await g('window.__g.game.setSurvival({ food: 30 })')
await g('window.__g.game.selectItem("cookedmeat")')
await page.keyboard.press('KeyF')
await page.waitForTimeout(200)
check((await g('window.__g.game.survival()')).food > 60, 'cooked meat is a real meal')

// drink at the beach
await g('window.__g.game.setSurvival({ water: 20 })')
await g('window.__g.teleport(0, 1596); window.__g.setCam(Math.PI, 0)') // toward the sea
await page.waitForTimeout(500)
let drank = false
for (let z = 1620; z <= 1668 && !drank; z += 4) {
  await page.evaluate((z) => window.__g.teleport(0, z), z)
  await page.waitForTimeout(250)
  if (await g('window.__g.game.nearWater()')) { await g('window.__g.game.interact()'); await page.waitForTimeout(200); drank = (await g('window.__g.game.survival()')).water > 40 }
}
check(drank, `drank at the shore (water ${(await g('window.__g.game.survival()')).water.toFixed(0)})`)

// starving bleeds hp
await g('window.__g.game.setGod(false); window.__g.game.setSurvival({ food: 0, water: 0 })')
await g('window.__g.teleport(0, 1560)')
const hp0 = await g('window.__g.game.hp()')
await page.waitForTimeout(3000)
const hp1 = await g('window.__g.game.hp()')
check(hp1 < hp0 - 3, `starving + parched bleeds hp: ${hp0.toFixed(0)} → ${hp1.toFixed(0)} in 3 s`)

// survives reload
await g('window.__g.game.setSurvival({ food: 33, water: 44, stamina: 55 })')
await g('window.__g.game.save()')
await page.waitForTimeout(200)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(800)
const s9 = await g('window.__g.game.survival()')
check(Math.abs(s9.food - 33) < 3 && Math.abs(s9.water - 44) < 3, `stats survive reload (food ${s9.food.toFixed(0)} water ${s9.water.toFixed(0)})`)

// --- M37: the bedroll — where you wake, and sleeping the night off ---
await g('window.__g.game.setCreative(false); window.__g.game.setGod(true)')
await g('window.__g.teleport(-120, 1300)')
await page.waitForTimeout(1200)
await g('window.__g.game.give("bedroll", 1); window.__g.game.selectItem("bedroll")')
await page.waitForTimeout(300)
await g('window.__g.game.swing()') // lay it down
await page.waitForTimeout(600)
const bed = await g('window.__g.game.bedroll()')
check(bed !== null, `the bedroll is laid down${bed ? ` at ${bed.x.toFixed(0)}, ${bed.z.toFixed(0)}` : ''}`)

// sleeping: refuse by day, work by night
await g('window.__g.setTime(0.5)')
await page.waitForTimeout(300)
await g('window.__g.game.interact()')
await page.waitForTimeout(300)
const noonTime = await g('window.__g.game.timeOfDay ? window.__g.game.timeOfDay() : 0.5')
check(Math.abs(noonTime - 0.5) < 0.02, 'you cannot sleep at noon')
// stand ON the bed: it snaps to the build grid a few metres ahead of where you aimed
await page.evaluate(([x, z]) => window.__g.teleport(x, z), [bed.x, bed.z])
await g('window.__g.setTime(0.95); window.__g.game.setSurvival({ food: 90, water: 90 })')
await page.waitForTimeout(800)
await g('window.__g.game.interact()')
await page.waitForTimeout(500)
const slept = await g('window.__g.game.survival()')
check(slept.food < 85, `sleeping through the night costs a night's meals (food 90 → ${slept.food.toFixed(0)})`)

// dying wakes you at the bedroll, not on the beach
await g('window.__g.game.setGod(false)')
await g('window.__g.teleport(-90, 1340)')
await page.waitForTimeout(800)
await g('window.__g.game.hurt(999)')
await page.waitForTimeout(800)
const p2 = await g('window.__g.player()')
const dist = Math.hypot(p2.x - bed.x, p2.z - bed.z)
check(dist < 6, `you wake at your bedroll, ${dist.toFixed(1)} m from it (not the beach)`)

// --- M50: the cold on the ranges (PLAN beat 4) ---
await g('window.__g.game.setCreative(false); window.__g.game.setGod(true); window.__g.setTime(0.5)')
const warmthAt = async (x, z, secs) => {
  await page.evaluate(([px, pz]) => window.__g.teleport(px, pz), [x, z])
  await page.waitForTimeout(secs * 1000)
  return page.evaluate(() => ({ w: window.__g.game.survival().warmth, y: window.__g.player().y }))
}
await g('window.__g.game.setSurvival({ warmth: 100 })')
const low = await warmthAt(0, 1560, 4)
check(low.w > 95, `the beach is warm (${low.w.toFixed(0)} at ${low.y.toFixed(0)} m)`)
const high = await warmthAt(-1290, -160, 14)
check(high.y > 300, `the west crest is high ground (${high.y.toFixed(0)} m)`)
check(high.w < 30, `and it freezes you without a coat (warmth ${high.w.toFixed(0)})`)

// the coat is a licence to be up here, not a discount on dying
await g('window.__g.game.give("furcoat", 1); window.__g.game.setSurvival({ warmth: 100 })')
const coated = await warmthAt(-1290, -160, 14)
check(coated.w > 55, `a fur coat makes the crest survivable (warmth ${coated.w.toFixed(0)})`)

// and fur comes off the shaggy animals, which is the only way to get one.
// (Down on the plain: a mammoth spawned on a 370 m crest lands on a cliff
// face and the butchering test measures the terrain, not the yield.)
await g('window.__g.teleport(-250, 1040)')
await page.waitForTimeout(2500)
const mIdx = await page.evaluate(() => { const p = window.__g.player(); return window.__g.game.spawnDino('mammoth', p.x + 6, p.z - 6) })
await page.waitForTimeout(2500)
await page.evaluate((i) => window.__g.game.killDino(i), mIdx)
await page.waitForTimeout(2200)
const fur0 = await g('window.__g.game.count("fur")')
await g('window.__g.game.give("hatchet", 1); window.__g.game.selectItem("hatchet")')
for (let i = 0; i < 6; i++) {
  await page.evaluate((k) => window.__g.game.gotoDinoIndex(k), mIdx)
  await page.waitForTimeout(250)
  await g('window.__g.game.swing()')
  await page.waitForTimeout(400)
}
check((await g('window.__g.game.count("fur")')) > fur0, `a mammoth carcass yields fur (${await g('window.__g.game.count("fur")')})`)

await browser.close()
console.log(failed ? '\nGATE FAILED' : '\nGATE PASSED')
process.exit(failed ? 1 : 0)

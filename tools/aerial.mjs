// QA aerial shots: whole-island and per-region overheads via the free camera.
//   node tools/aerial.mjs [url] [outPrefix]
import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const prefix = process.argv[3] ?? 'shots/aerial'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.error('[err]', e.message.slice(0, 200)))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
await page.waitForTimeout(2500)
const shots = [
  ['island', 0, 950, 1400, 0, -0.62, 0.5], // the user's judge view: high south, looking north
  ['lakes-west', -430, 420, 320, 0, -0.9, 0.5],
  ['lake-east', 300, 500, 550, 0, -0.9, 0.5],
  ['swamp', 560, 420, 620, 0, -0.9, 0.5],
  ['desert', -520, 420, 580, 0, -0.9, 0.5],
  ['ridge-ne', 700, 260, 420, 0.12, -0.18, 0.55], // south of the NE range looking north along it
  ['ridge-ground', 520, 40, 150, -0.8, 0.12, 0.45], // eye-ish level looking up at the range
]
for (const [name, x, y, z, yaw, pitch, t] of shots) {
  await page.evaluate(([xx, yy, zz, ya, pi, tt]) => {
    const g = window.__g
    g.setTime(tt)
    g.setFreeCam(xx, yy, zz, ya, pi)
  }, [x, y, z, yaw, pitch, t])
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${prefix}-${name}.png` })
  console.log(`${prefix}-${name}.png`)
}
await page.evaluate(() => window.__g.clearFreeCam())
await browser.close()

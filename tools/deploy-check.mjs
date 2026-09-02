// Smoke-check a deployed (or local preview) build: loads the page in headless
// Chrome, asserts the boot status line rendered, and saves a screenshot.
//   node tools/deploy-check.mjs [url] [shotPath]
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'https://jurrasic.keshav-madhav.com'
const shot = process.argv[3] ?? 'shots/deploy.png'

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
// Two attempts: the first visit after a deploy pulls tens of MB through a cold
// CDN edge and can exceed any sane timeout; the reload runs on a warm cache.
let ok = false
for (let attempt = 0; attempt < 2 && !ok; attempt++) {
  await page.goto(url, { waitUntil: 'networkidle' })
  ok = await page
    .waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 90000 })
    .then(() => true)
    .catch(() => false)
  if (!ok) console.log(`attempt ${attempt + 1}: not ready in 90s (cold edge?), retrying`)
}
if (!ok) {
  console.error('FAIL: game never reached ready')
  process.exit(1)
}
await page.waitForTimeout(500)

const status = await page.textContent('#status')
console.log('status line:', status)
await page.screenshot({ path: shot })
console.log('screenshot:', shot)
await browser.close()

if (!/three r\d+/.test(status ?? '')) {
  console.error('FAIL: status line missing or malformed')
  process.exit(1)
}

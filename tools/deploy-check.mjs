// Smoke-check a deployed (or local preview) build: loads the page in headless
// Chrome, asserts the boot status line rendered, and saves a screenshot.
//   node tools/deploy-check.mjs [url] [shotPath]
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'https://jurrasic.keshav-madhav.com'
const shot = process.argv[3] ?? 'shots/deploy.png'

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const status = await page.textContent('#status')
console.log('status line:', status)
await page.screenshot({ path: shot })
console.log('screenshot:', shot)
await browser.close()

if (!status?.includes('boot OK')) {
  console.error('FAIL: boot status line missing')
  process.exit(1)
}

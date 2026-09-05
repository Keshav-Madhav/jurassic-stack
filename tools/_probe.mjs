import { chromium } from 'playwright-core'
const url = process.argv[2] ?? 'http://localhost:4173'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('console', (m) => { if (/worker|Worker/i.test(m.text())) console.log('[console]', m.text().slice(0, 200)) })
page.on('response', (r) => { if (r.status() >= 400) console.log('[http]', r.status(), r.url()) })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
for (let i = 0; i < 6; i++) { await page.waitForTimeout(3000); console.log(`t+${(i + 1) * 3}s worker:`, await page.evaluate(() => window.__g.terrainWorker())) }
await browser.close()

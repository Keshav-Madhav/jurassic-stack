// Shared page helpers for the gates and QA tools.
//
// THE RELOAD RACE (M73). Every tool that starts from a clean island did this:
//
//   await page.evaluate(() => window.__g.game.wipeAndReload())
//   await page.waitForTimeout(2500)
//   await page.waitForFunction('window.__g && window.__g.ready === true')
//
// and every one of them could sail straight through against the OLD document.
// `wipeAndReload` returns immediately and the browser navigates whenever it
// gets round to it; until it does, `window.__g.ready` is still the previous
// page's `true`. So the wait proves nothing, the "fresh" island is the old
// one, and the checks run against whatever state the last block left behind.
//
// Against localhost the navigation almost always beats the 2.5 s and nobody
// ever saw it. Against the deployment, with 8 MB of world to re-fetch, it
// does not: gate-m8 failed five Wayfinder checks on production because the
// player was still carrying the relic the previous block had given them, so
// `count('wayfinder')` came back 2. The same run passed on the retry. Ten
// call sites across seven files had this shape.
//
// The fix is to wait for the DOCUMENT, not for a flag that survives it: stamp
// the window, then wait for the stamp to be gone AND the new page to be up.
// `window.__reloadMark` cannot survive a navigation, so its absence is proof.

/** Wipe the save and reload, and do not come back until the NEW page is up. */
export async function wipeAndReload(page, timeout = 120000) {
  await page.evaluate(() => {
    window.__reloadMark = true
    window.__g.game.wipeAndReload()
  })
  await page.waitForFunction(
    'window.__reloadMark === undefined && window.__g && window.__g.ready === true',
    null,
    { timeout },
  )
}

/** Reload the page (keeping the save) and wait for the new document. */
export async function reload(page, timeout = 120000) {
  await page.evaluate(() => { window.__reloadMark = true })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    'window.__reloadMark === undefined && window.__g && window.__g.ready === true',
    null,
    { timeout },
  )
}

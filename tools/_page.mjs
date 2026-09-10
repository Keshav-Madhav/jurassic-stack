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

// ---------------------------------------------------------------------------
// AND THE SAME MISTAKE ON THE WAY IN (M73b).
//
// Every tool opened with `page.goto(url, { waitUntil: 'networkidle' })` and
// then, on the very next line, waited for `window.__g.ready === true`. The
// second wait is the real one — the game says when it is ready — so the
// first was pure redundancy, and it was the fragile half: `networkidle`
// wants a 500 ms gap with no requests in flight, and a page that streams a
// 8 MB heightmap, a 5 MB navmesh and 30 MB of dino GLBs off a cold CDN edge
// may not get one inside the 30 s default. `goto` then throws before the
// ready-poll it was standing in front of ever runs.
//
// `tools/deploy-check.mjs` worked this out on its own some rounds ago and
// carries the comment to prove it — and the lesson never left that file.
// Thirty-four tools, thirty-nine call sites, all now
// `{ waitUntil: 'domcontentloaded', timeout: 120000 }`: get the document,
// then wait for the fact.
//
// Rule of thumb for this whole directory, and the third time it has been
// written down (M64's saddle, M73b's reload, this): NEVER wait for a proxy
// when the thing itself is observable. `waitForTimeout` and `networkidle`
// are both guesses about a machine you do not control.

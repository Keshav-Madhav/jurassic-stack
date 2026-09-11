// Run every gate and report once.
//
// The round's rule is "all eleven gates green", and checking that by hand meant
// a shell loop whose output had to be read gate by gate — six of the eleven did
// not even print a verdict, so "no FAIL line" was the only signal and a gate
// that CRASHED looked exactly like a gate that passed (M54). This runs them in
// order, counts the checks, keeps the failures, and gives one answer.
//
//   node tools/gates.mjs                      every gate, against localhost:4173
//   node tools/gates.mjs --url=https://…      against the deployment
//   node tools/gates.mjs --only=settings,m4   just these
//   node tools/gates.mjs --skip=perf
//   node tools/gates.mjs --write        re-baseline the expected check counts
//
// A gate that runs FEWER checks than last time has silently skipped one, which
// looks exactly like passing. That happened between a local run (256) and the
// same commit against the deployment (255): one `check()` simply did not
// execute, no FAIL, no SKIP, nothing to see. The counts are baselined in
// tools/gate-counts.json and a shortfall is a failure (M64).          all but these
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

const args = process.argv.slice(2)
const arg = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3)
const url = arg('url', 'http://localhost:4173')
const only = arg('only', '').split(',').filter(Boolean)
const skip = arg('skip', '').split(',').filter(Boolean)
const rebaseline = args.includes('--write')
const countsFile = new URL('./gate-counts.json', import.meta.url)
const expected = existsSync(countsFile) ? JSON.parse(readFileSync(countsFile, 'utf8')) : {}

// gate-perf last: it is the one that measures, so it should not share the GPU
// with anything else in the run
const ORDER = ['m3', 'm4', 'm5', 'm8', 'creative', 'ecology', 'survival', 'sound', 'homestead', 'settings', 'anim', 'perf']
const found = readdirSync(new URL('.', import.meta.url)).filter((f) => /^gate-.+\.mjs$/.test(f)).map((f) => f.slice(5, -4))
const missing = found.filter((n) => !ORDER.includes(n))
if (missing.length) console.log(`note: ${missing.join(', ')} exist but are not in this runner's ORDER — add them\n`)
const list = ORDER.filter((n) => found.includes(n) && (!only.length || only.includes(n)) && !skip.includes(n))

const run = (name) => new Promise((resolve) => {
  const t0 = Date.now()
  const p = spawn(process.execPath, [`tools/gate-${name}.mjs`, url], { cwd: new URL('..', import.meta.url).pathname })
  let out = ''
  p.stdout.on('data', (d) => { out += d })
  p.stderr.on('data', (d) => { out += d })
  p.on('close', (code) => resolve({ name, code, out, secs: Math.round((Date.now() - t0) / 1000) }))
})

console.log(`${list.length} gates against ${url}\n`)
const results = []
for (const name of list) {
  const r = await run(name)
  const pass = (r.out.match(/^PASS /gm) ?? []).length
  const fail = (r.out.match(/^FAIL /gm) ?? []).length
  const skipped = (r.out.match(/^SKIP /gm) ?? []).length
  // a gate that printed no checks at all did not run — a crash reads exactly
  // like a pass if you only look for the word FAIL
  const want = expected[name]
  // A DECLARED SKIP IS ACCOUNTED FOR. gate-m3 deliberately skips its fps check
  // on a contended machine and says so, and counting that as a missing check
  // turned an honest "I could not measure this" into a failure (M68). The
  // guard is for checks that vanish SILENTLY.
  const short = want !== undefined && pass + skipped < want
  const ok = r.code === 0 && fail === 0 && pass > 0 && !short
  results.push({ ...r, pass, fail, skipped, ok, short, want })
  const note = short ? `  ⟨${want - pass - skipped} CHECK(S) DID NOT RUN — expected ${want}⟩` : want !== undefined && pass > want ? `  (+${pass - want} new)` : ''
  console.log(`${ok ? ' ok ' : 'FAIL'}  gate-${name.padEnd(10)} ${String(pass).padStart(3)} pass · ${String(fail).padStart(2)} fail${skipped ? ` · ${skipped} skip` : ''} · exit ${r.code} · ${r.secs}s${note}`)
  if (!ok) {
    const named = r.out.split('\n').filter((l) => /^FAIL |Error|error:|\[err\]/.test(l)).slice(0, 12)
    for (const line of named) console.log(`        ${line}`)
    // A GATE CAN DIE WITH NOTHING TO SAY. gate-m8 once exited 1 after 11 of its
    // 48 checks with no FAIL and no matching error line, and the runner printed
    // only the shortfall — which is the same "silence looks like success" trap
    // this file exists to close (M67). If nothing above matched, show the tail.
    if (!named.length) {
      const tail = r.out.trimEnd().split('\n').slice(-6)
      console.log(`        ⟨no FAIL line — last ${tail.length} lines of output:⟩`)
      for (const line of tail) console.log(`        | ${line}`)
    }
  }
}

if (rebaseline) {
  const next = { ...expected }
  for (const r of results) if (r.fail === 0 && r.code === 0) next[r.name] = Math.max(r.pass + r.skipped, expected[r.name] ?? 0)
  writeFileSync(countsFile, JSON.stringify(next, null, 2) + '\n')
  console.log('\nexpected check counts re-baselined (tools/gate-counts.json)')
}
const bad = results.filter((r) => !r.ok)
const checks = results.reduce((a, r) => a + r.pass, 0)
console.log(`\n${checks} checks across ${results.length} gates · ${bad.length ? `${bad.length} FAILED: ${bad.map((r) => r.name).join(', ')}` : 'ALL GREEN'}`)
process.exit(bad.length ? 1 : 0)

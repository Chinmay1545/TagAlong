// Rehearses spec section 9 via the dev hooks (window.__tt) in a running Chrome (CDP).
// Usage: node scripts/demo-check.mjs [baseUrl=http://localhost:5173/?demo=1] [runs=10] [--expect-hand|--no-hand]
// Env: CDP_PORT (default 9333). Needs `npm run dev` and Chrome with --remote-debugging-port.
const args = process.argv.slice(2)
const flags = args.filter((a) => a.startsWith('--'))
const [url = 'http://localhost:5173/?demo=1', runsArg = '10'] = args.filter((a) => !a.startsWith('--'))
const runs = Number(runsArg)
const noHand = flags.includes('--no-hand')
const port = process.env.CDP_PORT ?? 9333

const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
})
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return r.result?.value
}
const state = () => ev('window.__tt ? window.__tt.state() : null')

// Poll until fn(state) is truthy or timeout; returns the last state.
async function waitFor(fn, ms) {
  const end = Date.now() + ms
  let s = null
  while (Date.now() < end) {
    s = await state().catch(() => null)
    if (s && fn(s)) return s
    await sleep(200)
  }
  return s
}
const setApp = async (on) => {
  const s = await state()
  if (s.withoutApp === on) await ev("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'w',bubbles:true}))")
}
// Say a sentence; return rows added, waiting up to 4 s for `want` rows then 1 s to settle.
async function say(text, want) {
  const before = (await state()).log.length
  await ev(`window.__tt.say(${JSON.stringify(text)})`)
  await waitFor((s) => s.log.length - before >= want, 4000)
  await sleep(1000)
  const after = await state()
  return { rows: after.log.slice(0, after.log.length - before), transcript: after.transcript.at(-1) ?? null }
}
const played = (r) => /· \d+(\.\d+)? s$/.test(r)
const kind = (r) => (played(r) ? 'played' : r.includes('· muted') ? 'muted' : r.includes('silent') ? 'silent' : '?')
const summary = (rows) => (rows.length ? rows.map(kind).join(',') : 'no rows')

let failed = 0
for (let n = 1; n <= runs; n++) {
  await send('Page.enable')
  await send('Page.navigate', { url })
  await sleep(500)
  const ready = await waitFor((s) => Array.isArray(s.log), 15000)
  await sleep(1000) // let board terms load (stats/fixture)
  const results = []
  if (!ready) results.push(['load', 'state() reachable', 'unreachable', false])
  else {
    const quiet = noHand ? 'silent' : 'muted'
    await setApp(false)
    let r = await say('this cancels with that', 1)
    results.push(['2 without app', `all ${quiet}, none played`, summary(r.rows), r.rows.length > 0 && r.rows.every((x) => kind(x) === quiet)])

    await setApp(true)
    r = await say('this cancels with that', noHand ? 1 : 2)
    if (noHand) results.push(['3 app on', 'all silent (no hand)', summary(r.rows), r.rows.length > 0 && r.rows.every((x) => kind(x) === 'silent')])
    else {
      const t = r.transcript
      results.push(['3 app on', '2 played', summary(r.rows), r.rows.length === 2 && r.rows.every(played)])
      results.push(['3 meant != said', 'differs', t ? `said="${t.said}" meant="${t.meant}"` : 'no transcript', !!t && t.meant !== t.said])
    }

    if (noHand) {
      r = await say('so this is my favorite part', 1)
      results.push(['4 no pointing', '1 silent', summary(r.rows), r.rows.length === 1 && kind(r.rows[0]) === 'silent'])
    } else results.push(['4 no pointing', '-', 'skipped (hand in frame)', true])
  }
  console.log(`\nRun ${n}/${runs}`)
  for (const [b, e, g, p] of results) console.log(`  ${p ? 'ok  ' : 'FAIL'} ${b.padEnd(16)} expected: ${e.padEnd(24)} got: ${g}`)
  if (results.some((x) => !x[3])) failed++
}
ws.close()
console.log(failed ? `\nFAIL ${failed}/${runs}` : `\nPASS ${runs}/${runs}`)
process.exit(failed ? 1 : 0)

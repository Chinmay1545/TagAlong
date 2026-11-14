import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error plain .mjs script
import { parseArgs, readReply, summarize, formatTable, bench, main, TARGET_MS } from '../scripts/bench-board.mjs'

type Handler = (req: IncomingMessage, res: ServerResponse) => void
const SECRET = 'hunter2-secret-pass'
const term = (id: string) => ({ id, latex: 'x^2', phrase: 'x squared', box: [0, 0, 1, 1] })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

let folder: string
let server: Server | undefined
let seen: IncomingMessage[] = []

async function serve(handler: Handler): Promise<string> {
  seen = []
  server = createServer((req, res) => {
    seen.push(req)
    req.resume()
    req.on('end', () => handler(req, res))
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
}

const streaming: Handler = async (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
  await wait(30)
  res.write(JSON.stringify({ type: 'term', term: term('a') }) + '\n')
  await wait(80)
  // split one line across two writes to exercise buffering
  const line = JSON.stringify({ type: 'term', term: term('b') }) + '\n'
  res.write(line.slice(0, 10))
  await wait(10)
  res.write(line.slice(10))
  await wait(40)
  res.end(JSON.stringify({ type: 'done', count: 2, ms: 160 }) + '\n')
}

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), 'bench-board-'))
  writeFileSync(join(folder, 'one.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  writeFileSync(join(folder, 'two.JPEG'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  writeFileSync(join(folder, 'notes.json'), '{}')
})
afterAll(() => rmSync(folder, { recursive: true, force: true }))
afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r))
  server = undefined
})

describe('parseArgs', () => {
  it('uses defaults', () => {
    expect(parseArgs([], {})).toEqual({ folder: 'public/fixtures', url: 'http://127.0.0.1:8787', runs: 1, passcode: undefined, json: false })
  })
  it('reads flags, positional folder and env passcode', () => {
    expect(parseArgs(['pics', '--url', 'https://x.example/', '--runs', '3', '--json'], { DEMO_PASSCODE: 'envpw' }))
      .toEqual({ folder: 'pics', url: 'https://x.example', runs: 3, passcode: 'envpw', json: true })
    expect(parseArgs(['--passcode', 'flagpw'], { DEMO_PASSCODE: 'envpw' }).passcode).toBe('flagpw')
    expect(parseArgs(['--runs=2', '--url=http://h:1'], {})).toMatchObject({ runs: 2, url: 'http://h:1' })
  })
  it('rejects a bad runs value', () => {
    expect(() => parseArgs(['--runs', '0'], {})).toThrow(/runs/)
  })
})

describe('readReply', () => {
  it('streams NDJSON: first term arrives well before the end', async () => {
    const url = await serve(streaming)
    const start = performance.now()
    const res = await fetch(`${url}/api/read-board`, { method: 'POST' })
    const r = await readReply(res, start, () => performance.now())
    expect(r.terms).toBe(2)
    expect(r.firstTermMs).toBeGreaterThanOrEqual(20)
    expect(r.totalMs).toBeGreaterThanOrEqual(r.firstTermMs + 80)
    expect(r.error).toBeUndefined()
  })
  it('plain JSON: first term time equals total', async () => {
    const url = await serve((_q, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ terms: [term('a'), term('b'), term('c')], ms: 5 }))
    })
    const start = performance.now()
    const r = await readReply(await fetch(url, { method: 'POST' }), start, () => performance.now())
    expect(r.terms).toBe(3)
    expect(r.firstTermMs).toBe(r.totalMs)
  })
  it('NDJSON error line is reported', async () => {
    const url = await serve((_q, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      res.end(JSON.stringify({ type: 'term', term: term('a') }) + '\n' + JSON.stringify({ type: 'error', error: 'model timeout' }) + '\n')
    })
    const r = await readReply(await fetch(url, { method: 'POST' }), performance.now(), () => performance.now())
    expect(r.terms).toBe(1)
    expect(r.error).toBe('model timeout')
  })
  it('NDJSON cut off before the done line is an error, not a success', async () => {
    const url = await serve((_q, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      res.end(JSON.stringify({ type: 'term', term: term('a') }) + '\n')
    })
    const r = await readReply(await fetch(url, { method: 'POST' }), performance.now(), () => performance.now())
    expect(r.terms).toBe(1)
    expect(r.error).toMatch(/done/)
  })
})

describe('bench', () => {
  it('posts every jpg sequentially with the right headers, once per run', async () => {
    const url = await serve(streaming)
    const rows = await bench({ folder, url, runs: 2, passcode: SECRET })
    expect(rows.map((r: any) => `${r.file}#${r.run}`)).toEqual(['one.jpg#1', 'one.jpg#2', 'two.JPEG#1', 'two.JPEG#2'])
    expect(rows.every((r: any) => r.ok && r.status === 200 && r.terms === 2)).toBe(true)
    expect(rows[0].firstTermMs).toBeLessThan(rows[0].totalMs)
    expect(seen).toHaveLength(4)
    for (const req of seen) {
      expect(req.method).toBe('POST')
      expect(req.url).toBe('/api/read-board')
      expect(req.headers['content-type']).toBe('image/jpeg')
      expect(req.headers.accept).toBe('application/x-ndjson, application/json')
      expect(req.headers['x-demo-passcode']).toBe(SECRET)
    }
  })
  it('omits the passcode header when none given', async () => {
    const url = await serve((_q, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"terms":[],"ms":1}') })
    await bench({ folder, url, runs: 1 })
    expect(seen[0].headers['x-demo-passcode']).toBeUndefined()
  })
  it('records 403 and 502 as error rows without throwing', async () => {
    let n = 0
    const url = await serve((_q, res) => {
      const status = n++ === 0 ? 403 : 502
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: status === 403 ? 'bad passcode' : 'upstream down' }))
    })
    const rows = await bench({ folder, url, runs: 1 })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ ok: false, status: 403 })
    expect(rows[0].error).toContain('bad passcode')
    expect(rows[1]).toMatchObject({ ok: false, status: 502 })
  })
  it('records network errors without throwing', async () => {
    const fetchImpl = async () => { throw new Error('ECONNREFUSED') }
    const rows = await bench({ folder, url: 'http://127.0.0.1:1', runs: 1, fetchImpl })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ ok: false, status: undefined })
    expect(rows[0].error).toContain('ECONNREFUSED')
  })
})

describe('summarize / formatTable', () => {
  const rows = [
    { file: 'a.jpg', run: 1, ok: true, status: 200, terms: 2, firstTermMs: 1000, totalMs: 4000 },
    { file: 'a.jpg', run: 2, ok: true, status: 200, terms: 2, firstTermMs: 7000, totalMs: 9000 },
    { file: 'b.jpg', run: 1, ok: true, status: 200, terms: 1, firstTermMs: 3000, totalMs: 5000 },
    { file: 'c.jpg', run: 1, ok: false, status: 502, terms: 0, firstTermMs: undefined, totalMs: 30, error: 'HTTP 502' },
  ]
  it('computes medians over successful reads and counts target hits', () => {
    const s = summarize(rows)
    expect(TARGET_MS).toBe(6000)
    expect(s).toMatchObject({ reads: 4, succeeded: 3, failed: 1, medianFirstTermMs: 3000, medianTotalMs: 5000, metTarget: 2, targetMs: 6000 })
  })
  it('even count median averages the middle two; empty is null', () => {
    expect(summarize(rows.slice(0, 2)).medianFirstTermMs).toBe(4000)
    expect(summarize([]).medianTotalMs).toBeNull()
  })
  it('renders a readable table with a summary line', () => {
    const t = formatTable(rows)
    const lines = t.split('\n')
    expect(lines[0]).toMatch(/file\s+\|\s*run\s+\|\s*terms\s+\|\s*first term ms\s+\|\s*total ms\s+\|\s*status/)
    expect(t).toContain('HTTP 502')
    expect(t).toMatch(/median first term 3000 ms/)
    expect(t).toMatch(/median total 5000 ms/)
    expect(t).toMatch(/2\/4 reads met target/)
  })
})

describe('main (CLI)', () => {
  it('prints table, never the passcode, exit 0 on success', async () => {
    const url = await serve(streaming)
    const out: string[] = []
    const code = await main([folder, '--url', url, '--passcode', SECRET], {}, (s: string) => out.push(s))
    expect(code).toBe(0)
    const text = out.join('\n')
    expect(text).toContain('one.jpg')
    expect(text).not.toContain(SECRET)
  })
  it('--json prints machine-readable output without the passcode', async () => {
    const url = await serve(streaming)
    const out: string[] = []
    const code = await main([folder, '--url', url, '--json'], { DEMO_PASSCODE: SECRET }, (s: string) => out.push(s))
    expect(code).toBe(0)
    const parsed = JSON.parse(out.join('\n'))
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.summary.succeeded).toBe(2)
    expect(out.join('\n')).not.toContain(SECRET)
    expect(seen[0].headers['x-demo-passcode']).toBe(SECRET)
  })
  it('exit 1 when nothing succeeded', async () => {
    const url = await serve((_q, res) => { res.writeHead(403); res.end('nope') })
    const out: string[] = []
    expect(await main([folder, '--url', url, '--passcode', SECRET], {}, (s: string) => out.push(s))).toBe(1)
    expect(out.join('\n')).not.toContain(SECRET)
  })
})

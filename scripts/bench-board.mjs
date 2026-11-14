#!/usr/bin/env node
// Benchmark the board-read endpoint: time to first term and total time per image.
// Usage: node scripts/bench-board.mjs [folder=public/fixtures] [--url http://127.0.0.1:8787]
//        [--runs 1] [--passcode X | env DEMO_PASSCODE] [--json]
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const TARGET_MS = 6000
const DEFAULTS = { folder: 'public/fixtures', url: 'http://127.0.0.1:8787', runs: 1 }
const ACCEPT = 'application/x-ndjson, application/json'

export function parseArgs(argv, env = process.env) {
  const opts = { folder: DEFAULTS.folder, url: DEFAULTS.url, runs: DEFAULTS.runs, passcode: env.DEMO_PASSCODE || undefined, json: false }
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i]
    let value
    const eq = arg.indexOf('=')
    if (arg.startsWith('--') && eq > 0) { value = arg.slice(eq + 1); arg = arg.slice(0, eq) }
    const take = () => {
      if (value !== undefined) return value
      const next = argv[++i]
      if (next === undefined) throw new Error(`${arg} needs a value`)
      return next
    }
    if (arg === '--json') opts.json = true
    else if (arg === '--url') opts.url = take()
    else if (arg === '--passcode') opts.passcode = take()
    else if (arg === '--runs') {
      const raw = take()
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 1) throw new Error(`--runs must be a positive integer (got "${raw}")`)
      opts.runs = n
    } else if (arg.startsWith('--')) throw new Error(`unknown flag ${arg}`)
    else opts.folder = arg
  }
  opts.url = opts.url.replace(/\/+$/, '')
  return opts
}

const round = (ms) => Math.round(ms)

/** Read a 200 reply (NDJSON stream or plain JSON). Returns { terms, firstTermMs, totalMs, error? }. */
export async function readReply(response, startMs, now = () => performance.now()) {
  const type = response.headers.get('content-type') || ''
  if (type.includes('ndjson') && response.body) {
    let terms = 0
    let firstTermMs
    let error
    let buffer = ''
    const handleLine = (line) => {
      if (!line.trim()) return
      let msg
      try { msg = JSON.parse(line) } catch { error ??= 'bad NDJSON line'; return }
      if (msg.type === 'term') {
        terms++
        if (firstTermMs === undefined) firstTermMs = round(now() - startMs)
      } else if (msg.type === 'error') error = String(msg.error ?? 'error')
      else if (msg.type === 'done' && typeof msg.count === 'number' && msg.count !== terms) error ??= `done.count ${msg.count} != ${terms} terms`
    }
    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
      }
    }
    buffer += decoder.decode()
    handleLine(buffer)
    const totalMs = round(now() - startMs)
    const out = { terms, firstTermMs, totalMs }
    if (error !== undefined) out.error = error
    return out
  }
  const text = await response.text()
  const totalMs = round(now() - startMs)
  try {
    const body = JSON.parse(text)
    const terms = Array.isArray(body.terms) ? body.terms.length : 0
    const out = { terms, firstTermMs: terms > 0 ? totalMs : undefined, totalMs }
    if (!Array.isArray(body.terms)) out.error = body.error ? String(body.error) : 'reply has no terms array'
    return out
  } catch {
    return { terms: 0, firstTermMs: undefined, totalMs, error: 'reply is not JSON' }
  }
}

async function errorText(response) {
  let detail = ''
  try {
    const text = await response.text()
    try { detail = JSON.parse(text).error ?? text } catch { detail = text }
  } catch { /* ignore */ }
  detail = String(detail).replace(/\s+/g, ' ').trim().slice(0, 120)
  return detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`
}

const redact = (s, secret) => (secret && typeof s === 'string' ? s.split(secret).join('***') : s)

export async function listImages(folder) {
  const names = await readdir(folder)
  return names.filter((n) => /\.jpe?g$/i.test(n)).sort()
}

/** Run the benchmark. Returns one row per (file, run). Never throws for per-request failures. */
export async function bench({ folder, url, runs = 1, passcode, fetchImpl = globalThis.fetch, now = () => performance.now() }) {
  const files = await listImages(folder)
  const endpoint = `${url.replace(/\/+$/, '')}/api/read-board`
  const rows = []
  for (const file of files) {
    const bytes = await readFile(join(folder, file))
    for (let run = 1; run <= runs; run++) {
      const headers = { 'Content-Type': 'image/jpeg', Accept: ACCEPT }
      if (passcode) headers['x-demo-passcode'] = passcode
      const row = { file, run, ok: false, status: undefined, terms: 0, firstTermMs: undefined, totalMs: undefined }
      const start = now()
      try {
        const response = await fetchImpl(endpoint, { method: 'POST', headers, body: bytes })
        row.status = response.status
        if (response.status !== 200) {
          row.error = await errorText(response)
          row.totalMs = round(now() - start)
        } else {
          const r = await readReply(response, start, now)
          Object.assign(row, r)
          row.ok = r.error === undefined
        }
      } catch (err) {
        row.totalMs = round(now() - start)
        const cause = err?.cause?.code ?? err?.cause?.errors?.[0]?.code ?? err?.cause?.message
        row.error = cause ? `${err.message} (${cause})` : String(err?.message ?? err)
      }
      if (row.error !== undefined) row.error = redact(row.error, passcode)
      rows.push(row)
    }
  }
  return rows
}

function median(values) {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function summarize(rows, targetMs = TARGET_MS) {
  const good = rows.filter((r) => r.ok)
  const firsts = good.map((r) => r.firstTermMs).filter((v) => typeof v === 'number')
  return {
    reads: rows.length,
    succeeded: good.length,
    failed: rows.length - good.length,
    medianFirstTermMs: median(firsts),
    medianTotalMs: median(good.map((r) => r.totalMs).filter((v) => typeof v === 'number')),
    metTarget: firsts.filter((v) => v < targetMs).length,
    targetMs,
  }
}

const show = (v) => (v === undefined || v === null ? '-' : String(v))

export function formatTable(rows) {
  const header = ['file', 'run', 'terms', 'first term ms', 'total ms', 'status']
  const body = rows.map((r) => [
    r.file,
    String(r.run),
    String(r.terms ?? 0),
    show(r.firstTermMs),
    show(r.totalMs),
    r.ok ? `${r.status} ok` : (r.error ?? `HTTP ${show(r.status)}`),
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)))
  const line = (cells) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]))).join(' | ')
  const s = summarize(rows)
  const summary =
    `median first term ${show(s.medianFirstTermMs)} ms, median total ${show(s.medianTotalMs)} ms; ` +
    `${s.metTarget}/${s.reads} reads met target (first term < ${s.targetMs} ms); ${s.failed} failed`
  return [line(header), widths.map((w) => '-'.repeat(w)).join('-+-'), ...body.map(line), '', summary].join('\n')
}

/** CLI entry. Returns the exit code. `print` receives whole output chunks. */
export async function main(argv, env = process.env, print = (s) => console.log(s)) {
  let opts
  try { opts = parseArgs(argv, env) } catch (err) { print(`bench-board: ${err.message}`); return 1 }
  let rows
  try {
    rows = await bench({ folder: opts.folder, url: opts.url, runs: opts.runs, passcode: opts.passcode })
  } catch (err) {
    print(`bench-board: ${redact(String(err?.message ?? err), opts.passcode)}`)
    return 1
  }
  if (rows.length === 0) { print(`bench-board: no .jpg/.jpeg files in ${opts.folder}`); return 1 }
  if (opts.json) print(JSON.stringify({ url: opts.url, runs: opts.runs, rows, summary: summarize(rows) }, null, 2))
  else print(formatTable(rows))
  return rows.some((r) => r.ok) ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code })
}

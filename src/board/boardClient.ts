import type { Term } from '../core/types'

export const isFixtureMode = (search: string): boolean => new URLSearchParams(search).get('fixture') === '1'

export async function loadFixture(): Promise<Term[]> {
  const res = await fetch('/fixtures/board-fraction.json')
  if (!res.ok) throw new Error(`fixture load failed: ${res.status}`)
  return (await res.json()).terms
}

type Line = { type: 'term'; term: Term } | { type: 'done' } | { type: 'error'; error?: string }

// Reads an NDJSON board reply line by line. onTerm fires per term as it arrives; resolves with all
// terms on "done", throws on an error line or when the stream ends without "done" (a cut-off read).
async function readTermStream(body: ReadableStream<Uint8Array>, onTerm?: (t: Term) => void): Promise<Term[]> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  const terms: Term[] = []
  let buf = ''
  const handle = (raw: string): boolean => {
    if (!raw.trim()) return false
    const line = JSON.parse(raw) as Line
    if (line.type === 'error') throw new Error(line.error || 'board read failed')
    if (line.type === 'done') return true
    if (line.type === 'term') { terms.push(line.term); onTerm?.(line.term) }
    return false
  }
  for (;;) {
    const { value, done } = await reader.read()
    buf += done ? dec.decode() : dec.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const raw = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (handle(raw)) { void reader.cancel().catch(() => {}); return terms }
    }
    if (done) {
      if (handle(buf)) return terms
      throw new Error('board read incomplete')
    }
  }
}

export async function readBoard(jpeg: Blob, onTerm?: (t: Term) => void): Promise<Term[]> {
  const res = await fetch('/api/read-board', {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', Accept: 'application/x-ndjson, application/json' },
    body: jpeg,
  })
  if (res.ok && res.body && /ndjson/.test(res.headers?.get('content-type') ?? '')) return readTermStream(res.body, onTerm)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `read-board failed: ${res.status}`)
  return body.terms
}

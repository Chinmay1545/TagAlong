import type { Box, Term } from '../core/types'

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
  try {
    for (;;) {
      const { value, done } = await reader.read()
      buf += done ? dec.decode() : dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const raw = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (handle(raw)) return terms
      }
      if (done) {
        if (handle(buf)) return terms
        throw new Error('board read incomplete')
      }
    }
  } finally {
    void reader.cancel().catch(() => {}) // stop downloading on done, error line or bad line
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

// The reader sees a square photo (frame at the top left, black padding), so its boxes are fractions of
// the square. Back to fractions of the scaled frame; null when the box centre is in the padding.
export function fromSquare(b: Box, scaledW: number, scaledH: number): Box | null {
  const side = Math.max(scaledW, scaledH)
  const kx = side / scaledW, ky = side / scaledH
  const cx = (b.x + b.w / 2) * kx, cy = (b.y + b.h / 2) * ky
  if (cx > 1 || cy > 1) return null
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1e6) / 1e6 // 6 places: no float dust in a box
  const x = c(b.x * kx), y = c(b.y * ky)
  return { x, y, w: Math.min(c(b.w * kx), 1 - x), h: Math.min(c(b.h * ky), 1 - y) } // inside the frame
}

export const termsFromSquare = (terms: Term[], w: number, h: number): Term[] =>
  terms.flatMap(t => { const box = fromSquare(t.box, w, h); return box ? [{ ...t, box }] : [] })

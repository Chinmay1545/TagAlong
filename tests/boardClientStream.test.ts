import { describe, it, expect, vi, afterEach } from 'vitest'
import { readBoard } from '../src/board/boardClient'
import type { Term } from '../src/core/types'

afterEach(() => { vi.unstubAllGlobals() })

const A: Term = { id: 1, latex: '2x', phrase: 'the 2x on top', box: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } }
const B: Term = { id: 2, latex: '3y', phrase: 'the 3y on the right', box: { x: 0.7, y: 0.2, w: 0.1, h: 0.1 } }

// A streamed NDJSON response whose body arrives in the given string pieces.
const ndjson = (pieces: string[]) => new Response(new ReadableStream({
  start(c) { for (const p of pieces) c.enqueue(new TextEncoder().encode(p)); c.close() },
}), { headers: { 'content-type': 'application/x-ndjson' } })

describe('readBoard with a streamed reply', () => {
  it('asks for NDJSON and calls onTerm per term, lines split across chunks', async () => {
    const text = [{ type: 'term', term: A }, { type: 'term', term: B }, { type: 'done', count: 2, ms: 5 }].map(l => JSON.stringify(l) + '\n').join('')
    const fetchMock = vi.fn(async () => ndjson([text.slice(0, 17), text.slice(17, 90), text.slice(90)]))
    vi.stubGlobal('fetch', fetchMock)
    const seen: Term[] = []
    expect(await readBoard(new Blob(['x']), t => seen.push(t))).toEqual([A, B])
    expect(seen).toEqual([A, B])
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((init.headers as Record<string, string>).Accept).toContain('application/x-ndjson')
  })
  it('throws on an error line (terms already seen are not returned)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([JSON.stringify({ type: 'term', term: A }) + '\n', JSON.stringify({ type: 'error', error: 'board read failed' }) + '\n'])))
    await expect(readBoard(new Blob(['x']))).rejects.toThrow('board read failed')
  })
  it('throws when the stream ends without a done line (cut off)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([JSON.stringify({ type: 'term', term: A }) + '\n'])))
    await expect(readBoard(new Blob(['x']))).rejects.toThrow(/incomplete/)
  })
  it('still accepts a plain JSON reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ terms: [A] }), { headers: { 'content-type': 'application/json' } })))
    expect(await readBoard(new Blob(['x']))).toEqual([A])
  })
})

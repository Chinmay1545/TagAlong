import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolutionMsg, finalMsg, boardMsg, modeMsg, helloMsg, createBroadcaster, subscribe, type Channel } from '../src/live/broadcast'
import type { Resolution, Term } from '../src/core/types'

const term = (phrase: string): Term => ({ phrase, box: { x: 0, y: 0, w: 1, h: 1 } }) as Term
const res = (word: string, ...phrases: string[]): Resolution => ({ word: { word, t: 0, isPointer: true }, terms: phrases.map(term) }) as Resolution

function fakeChannel() {
  const c = { sent: [] as unknown[], closed: false, onmessage: null as ((e: { data: unknown }) => void) | null,
    postMessage(m: unknown) { c.sent.push(m) }, close() { c.closed = true } }
  return c satisfies Channel & Record<string, unknown>
}

describe('broadcast builders', () => {
  it('hello message', () => expect(helloMsg()).toEqual({ type: 'hello' }))
  it('resolution joins phrases with and', () => {
    expect(resolutionMsg(res('this', 'mitosis', 'meiosis'), 412, false)).toEqual({ type: 'resolution', word: 'this', phrase: 'mitosis and meiosis', latencyMs: 412, muted: false })
  })
  it('silent resolution has null phrase and is not muted', () => {
    expect(resolutionMsg(res('that'), null, true)).toMatchObject({ phrase: null, muted: false })
  })
  it('muted when without app and terms exist', () => {
    expect(resolutionMsg(res('this', 'ATP'), null, true)).toMatchObject({ phrase: 'ATP', muted: true })
  })
  it('final, board, mode', () => {
    expect(finalMsg('a this', 'a ATP')).toEqual({ type: 'final', said: 'a this', meant: 'a ATP' })
    expect(boardMsg(res('board', 'x', 'y'))).toEqual({ type: 'board', phrases: ['x', 'y'] })
    expect(modeMsg(true)).toEqual({ type: 'mode', withoutApp: true })
  })
})

describe('channel plumbing', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('broadcaster posts and closes', () => {
    const ch = fakeChannel()
    const b = createBroadcaster(ch)
    b.send(modeMsg(false))
    b.close()
    expect(ch.sent).toEqual([{ type: 'mode', withoutApp: false }])
    expect(ch.closed).toBe(true)
  })
  it('subscribe delivers messages and unsubscribe closes', () => {
    const ch = fakeChannel()
    const got: unknown[] = []
    const off = subscribe(m => got.push(m), ch)
    ch.onmessage!({ data: modeMsg(true) })
    off()
    expect(got).toEqual([{ type: 'mode', withoutApp: true }])
    expect(ch.closed).toBe(true)
  })
  it('no-ops without BroadcastChannel', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const b = createBroadcaster()
    expect(() => { b.send(modeMsg(true)); b.close() }).not.toThrow()
    expect(() => subscribe(() => {})()).not.toThrow()
  })
})

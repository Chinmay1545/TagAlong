import { describe, it, expect, vi, afterEach } from 'vitest'
import { connectRoom, roomSocketUrl, type RoomState } from '../src/live/roomClient'

class FakeWs {
  static all: FakeWs[] = []
  static OPEN = 1
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) { FakeWs.all.push(this) }
  send(d: string) { this.sent.push(d) }
  close() { this.readyState = 3; this.onclose?.() }
  open() { this.readyState = 1; this.onopen?.() }
  drop() { this.readyState = 3; this.onclose?.() }
  recv(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }) }
}
afterEach(() => { FakeWs.all = []; vi.useRealTimers() })

const setup = () => {
  vi.useFakeTimers()
  const states: RoomState[] = [], msgs: unknown[] = []
  const conn = connectRoom('ws://h/ws/room?role=student&room=math201&t=x', { onMessage: m => msgs.push(m), onState: s => states.push(s) }, FakeWs as never)
  return { conn, states, msgs, ws: () => FakeWs.all.at(-1)! }
}

describe('connectRoom', () => {
  it('reports connecting, then open, and passes parsed messages on', () => {
    const { states, msgs, ws } = setup()
    ws().open()
    ws().recv({ type: 'status', live: true })
    expect(states).toEqual(['connecting', 'open'])
    expect(msgs).toEqual([{ type: 'status', live: true }])
  })

  it('ignores messages that are not JSON', () => {
    const { msgs, ws } = setup()
    ws().open()
    ws().onmessage?.({ data: 'garbage' })
    expect(msgs).toEqual([])
  })

  it('reconnects after a drop, waiting longer each time up to 10 s', async () => {
    const { states, ws } = setup()
    ws().open()
    ws().drop()
    expect(states.at(-1)).toBe('reconnecting')
    expect(FakeWs.all).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeWs.all).toHaveLength(2)
    ws().drop() // failed again before opening
    await vi.advanceTimersByTimeAsync(1999)
    expect(FakeWs.all).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeWs.all).toHaveLength(3)
    for (let i = 0; i < 6; i++) { ws().drop(); await vi.advanceTimersByTimeAsync(10_000) }
    expect(FakeWs.all).toHaveLength(9) // capped at 10 s, so one per 10 s
    ws().open()
    expect(states.at(-1)).toBe('open')
    ws().drop()
    await vi.advanceTimersByTimeAsync(1000) // a successful open resets the wait
    expect(FakeWs.all).toHaveLength(10)
  })

  it('sends only while open, and stops for good when closed', async () => {
    const { conn, states, ws } = setup()
    conn.send({ type: 'status', open: true })
    expect(ws().sent).toEqual([])
    ws().open()
    conn.send({ type: 'status', open: true })
    expect(ws().sent).toEqual(['{"type":"status","open":true}'])
    conn.close()
    expect(states.at(-1)).toBe('closed')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWs.all).toHaveLength(1)
  })
})

describe('roomSocketUrl', () => {
  it('uses wss on https and keeps the page host', () => {
    expect(roomSocketUrl({ protocol: 'https:', host: 'tagalong.up.railway.app' }, { role: 'student', room: 'math201', token: 'abc' }))
      .toBe('wss://tagalong.up.railway.app/ws/room?role=student&room=math201&t=abc')
    expect(roomSocketUrl({ protocol: 'http:', host: 'localhost:5173' }, { role: 'camera', room: 'math201' }))
      .toBe('ws://localhost:5173/ws/room?role=camera&room=math201')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRelay, relayUrl, type RelayStatus } from '../src/live/relay'

class FakeWS {
  static instances: FakeWS[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  closed = false
  constructor(public url: string) { FakeWS.instances.push(this) }
  send(s: string) { this.sent.push(s) }
  close() { this.closed = true; this.onclose?.() }
  open() { this.onopen?.() }
  message(o: unknown) { this.onmessage?.({ data: JSON.stringify(o) }) }
  drop() { this.onclose?.() }
}
const last = () => FakeWS.instances[FakeWS.instances.length - 1]
const WS = FakeWS as unknown as typeof WebSocket

function make(extra: Record<string, unknown> = {}) {
  const msgs: unknown[] = []
  const statuses: RelayStatus[] = []
  const rtts: number[] = []
  const relay = createRelay({
    url: 'ws://x/ws/room', WS, doc: undefined,
    onMessage: (m: unknown) => msgs.push(m), onStatus: (s: RelayStatus) => statuses.push(s), onRtt: (r: number) => rtts.push(r),
    ...extra,
  } as never)
  return { relay, msgs, statuses, rtts }
}

describe('relay', () => {
  beforeEach(() => { vi.useFakeTimers(); FakeWS.instances = [] })
  afterEach(() => { vi.useRealTimers() })

  it('relayUrl picks wss on https and ws on http', () => {
    expect(relayUrl({ protocol: 'https:', host: 'a.b' }, { room: 'x', role: 'teacher' })).toBe('wss://a.b/ws/room?room=x&role=teacher')
    expect(relayUrl({ protocol: 'http:', host: 'localhost:3000' }, { room: 'x' })).toBe('ws://localhost:3000/ws/room?room=x')
  })

  it('opens, reports status, delivers messages, sends only when open', () => {
    const { relay, msgs, statuses } = make()
    expect(relay.status()).toBe('connecting')
    expect(relay.send({ a: 1 })).toBe(false)
    last().open()
    expect(relay.status()).toBe('open')
    expect(relay.send({ a: 1 })).toBe(true)
    expect(last().sent).toEqual(['{"a":1}'])
    last().message({ type: 'hi' })
    last().onmessage?.({ data: 'not json' })
    expect(msgs).toEqual([{ type: 'hi' }])
    expect(statuses).toEqual(['connecting', 'open'])
    relay.close()
  })

  it('reconnects with 500, 1000, 2000, 4000, 5000, 5000 ms and reports reconnecting only after it had been open', () => {
    const { relay, statuses } = make()
    for (const ms of [500, 1000, 2000, 4000, 5000, 5000]) {
      const n = FakeWS.instances.length
      last().drop()
      vi.advanceTimersByTime(ms - 1)
      expect(FakeWS.instances.length).toBe(n)
      vi.advanceTimersByTime(1)
      expect(FakeWS.instances.length).toBe(n + 1)
    }
    expect(statuses).not.toContain('reconnecting')
    last().open()
    last().drop()
    expect(relay.status()).toBe('reconnecting')
    relay.close()
  })

  it('backoff resets after a successful open', () => {
    const { relay } = make()
    last().drop(); vi.advanceTimersByTime(500)
    last().drop(); vi.advanceTimersByTime(1000)
    last().open()
    last().drop()
    const n = FakeWS.instances.length
    vi.advanceTimersByTime(500)
    expect(FakeWS.instances.length).toBe(n + 1)
    relay.close()
  })

  it('pings every 10 s and reports round-trip time; pongs are not delivered', () => {
    let t = 0
    const { relay, msgs, rtts } = make({ now: () => t })
    last().open()
    t = 10000; vi.advanceTimersByTime(10000)
    expect(JSON.parse(last().sent[0])).toEqual({ type: 'ping', t: 10000 })
    t = 10042; last().message({ type: 'pong', t: 10000 })
    expect(rtts).toEqual([42])
    expect(msgs).toEqual([])
    t = 20000; vi.advanceTimersByTime(10000)
    expect(last().sent.length).toBe(2)
    relay.close()
  })

  it('a silent connection is closed and reopened after 25 s', () => {
    const { relay } = make()
    const first = last()
    first.open()
    vi.advanceTimersByTime(24999)
    expect(first.closed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(first.closed).toBe(true)
    vi.advanceTimersByTime(500)
    expect(FakeWS.instances.length).toBe(2)
    relay.close()
  })

  it('returning to the page reconnects at once', () => {
    const doc = new EventTarget() as unknown as Document & { visibilityState: string }
    ;(doc as { visibilityState: string }).visibilityState = 'hidden'
    const { relay } = make({ doc })
    last().open()
    last().drop()
    ;(doc as { visibilityState: string }).visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(FakeWS.instances.length).toBe(2)
    relay.close()
  })

  it('close stops reconnecting', () => {
    const { relay } = make()
    last().open()
    relay.close()
    expect(relay.status()).toBe('closed')
    vi.advanceTimersByTime(60000)
    expect(FakeWS.instances.length).toBe(1)
    expect(relay.send({})).toBe(false)
  })
})

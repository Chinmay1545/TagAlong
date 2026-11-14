// Browser side of the classroom relay: one WebSocket to /ws/room that comes back by itself after a drop
// (Wi-Fi hiccup, phone waking up), waiting 1 s, 2 s, 4 s ... up to 10 s between tries.

export type RoomState = 'connecting' | 'open' | 'reconnecting' | 'closed'
type WsLike = { readyState: number; send(d: string): void; close(): void; onopen: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onclose: (() => void) | null; onerror: (() => void) | null }
type WsCtor = { new (url: string): WsLike; OPEN: number }

const BACKOFF_MS = [1000, 2000, 4000, 8000, 10_000]

export function roomSocketUrl(loc: { protocol: string; host: string }, p: { role: 'camera' | 'student'; room: string; token?: string }): string {
  const q = new URLSearchParams({ role: p.role, room: p.room })
  if (p.token) q.set('t', p.token)
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws/room?${q}`
}

export function connectRoom(
  url: string,
  on: { onMessage(m: unknown): void; onState?(s: RoomState): void },
  Ws: WsCtor = WebSocket as unknown as WsCtor,
) {
  let ws: WsLike | null = null
  let tries = 0
  let closed = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const open = () => {
    on.onState?.(tries === 0 ? 'connecting' : 'reconnecting')
    const w = new Ws(url)
    ws = w
    w.onopen = () => { tries = 0; on.onState?.('open') }
    w.onmessage = e => { try { on.onMessage(JSON.parse(String(e.data))) } catch { /* not ours */ } }
    w.onerror = () => {} // a close always follows
    w.onclose = () => {
      if (closed || ws !== w) return
      on.onState?.('reconnecting')
      timer = setTimeout(open, BACKOFF_MS[Math.min(tries, BACKOFF_MS.length - 1)])
      tries++
    }
  }
  open()

  return {
    send(m: unknown) { if (ws && ws.readyState === Ws.OPEN) ws.send(JSON.stringify(m)) },
    close() {
      closed = true
      if (timer) clearTimeout(timer)
      ws?.close()
      on.onState?.('closed')
    },
  }
}

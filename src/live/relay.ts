export type RelayStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export const RECONNECT_MS = [500, 1000, 2000, 4000, 5000]
export const PING_MS = 10000
export const DEAD_MS = 25000
export const REPLACED = 4001 // server/rooms.ts: another tab took this room over; reconnecting would steal it back

export const relayUrl = (loc: { protocol: string; host: string }, params: Record<string, string>): string =>
  `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws/room?${new URLSearchParams(params)}`

type Opts = {
  url: string
  onMessage(m: any): void
  onStatus?(s: RelayStatus): void
  onRtt?(ms: number): void
  WS?: typeof WebSocket
  now?: () => number
  doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>
}

export function createRelay(o: Opts) {
  const WSImpl = o.WS ?? WebSocket
  const now = o.now ?? Date.now
  const doc = 'doc' in o ? o.doc : typeof document !== 'undefined' ? document : undefined
  let ws: WebSocket | null = null
  let status: RelayStatus = 'connecting'
  let everOpen = false
  let attempt = 0
  let done = false
  let retry: ReturnType<typeof setTimeout> | undefined
  let ping: ReturnType<typeof setInterval> | undefined
  let dead: ReturnType<typeof setTimeout> | undefined

  const set = (s: RelayStatus) => { if (s !== status) { status = s; o.onStatus?.(s) } }
  const stopTimers = () => { clearInterval(ping); clearTimeout(dead) }
  const detach = () => {
    stopTimers()
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close() } catch { /* already gone */ } }
    ws = null
  }
  const armDead = () => { clearTimeout(dead); dead = setTimeout(lost, DEAD_MS) }

  function lost() {
    if (done) return
    detach()
    set(everOpen ? 'reconnecting' : 'connecting')
    retry = setTimeout(connect, RECONNECT_MS[Math.min(attempt++, RECONNECT_MS.length - 1)])
  }

  function connect() {
    clearTimeout(retry)
    detach()
    const sock = new WSImpl(o.url)
    ws = sock
    sock.onopen = () => {
      everOpen = true
      attempt = 0
      set('open')
      armDead()
      ping = setInterval(() => { try { sock.send(JSON.stringify({ type: 'ping', t: now() })) } catch { /* closing; the close handler reconnects */ } }, PING_MS)
    }
    sock.onmessage = e => {
      armDead()
      let m: any
      try { m = JSON.parse(String(e.data)) } catch { return }
      if (!m || typeof m !== 'object') return
      if (m.type === 'pong') { if (typeof m.t === 'number') o.onRtt?.(now() - m.t) }
      else o.onMessage(m)
    }
    sock.onclose = (e?: { code?: number }) => {
      if (ws !== sock) return
      if (e?.code === REPLACED) return shut()
      lost()
    }
  }

  function shut() {
    done = true
    clearTimeout(retry)
    detach()
    doc?.removeEventListener('visibilitychange', onVisible)
    set('closed')
  }

  const onVisible = () => {
    if (done || doc?.visibilityState !== 'visible' || status === 'open') return
    attempt = 0
    connect()
  }
  doc?.addEventListener('visibilitychange', onVisible)
  o.onStatus?.(status)
  connect()

  return {
    send(m: object): boolean {
      if (status !== 'open' || !ws) return false
      try { ws.send(JSON.stringify(m)); return true } catch { return false }
    },
    close: shut,
    status: () => status,
  }
}

import type { Resolution, Term } from '../core/types'
import { readingOrder } from './boardQuery'
import { overview } from './overview'
import { clipPhrase, MAX_BOARD_PHRASES, whisperFromResolution, type CameraMsg } from './roomProtocol'
import { connectRoom, roomSocketUrl, type RoomState } from './roomClient'

// Camera device side of the classroom relay: opens a class (a room), publishes every whisper and the board,
// and re-sends the class status and latest board after a reconnect so late or returning students are current.
type Conn = { send(m: unknown): void; close(): void }
type Deps = {
  connect: (url: string, on: { onMessage(m: unknown): void; onState?(s: RoomState): void }) => Conn
  fetchLink: (room: string) => Promise<string> // path of the student link, e.g. /?student&room=math201&t=...
  location: { protocol: string; host: string; origin: string }
}

const defaultDeps = (): Deps => ({
  connect: (url, on) => connectRoom(url, on),
  fetchLink: async room => {
    const r = await fetch(`/api/room-link?room=${encodeURIComponent(room)}`)
    if (!r.ok) throw new Error(r.status === 400 ? 'Use 1-40 characters: a-z, 0-9 and -' : `could not open the class (${r.status})`)
    return (await r.json() as { path: string }).path
  },
  location: window.location,
})

export function createClassroom(deps: Deps = defaultDeps()) {
  let conn: Conn | null = null
  let room: string | null = null
  let board: CameraMsg | null = null
  let isOpen = false
  const listenerCbs = new Set<(n: number) => void>()
  const stateCbs = new Set<(s: RoomState) => void>()
  const send = (m: CameraMsg) => { if (conn && isOpen) conn.send(m) }

  const api = {
    room: () => room,
    async open(name: string): Promise<string> {
      const path = await deps.fetchLink(name)
      api.close()
      room = name
      // `c` is not assigned yet when connect() reports its first state synchronously: `ready` guards that.
      let ready = false
      const c: Conn = deps.connect(roomSocketUrl(deps.location, { role: 'camera', room: name }), {
        onMessage: m => {
          const msg = m as { type?: unknown; count?: unknown }
          if (msg.type === 'listeners' && typeof msg.count === 'number') listenerCbs.forEach(cb => cb(msg.count as number))
        },
        onState: s => {
          if (!ready || c !== conn) return
          isOpen = s === 'open'
          if (isOpen) { c.send({ type: 'status', open: true }); if (board) c.send(board) }
          stateCbs.forEach(cb => cb(s))
        },
      })
      conn = c
      ready = true
      return deps.location.origin + path
    },
    close() {
      if (!conn) return
      if (isOpen) conn.send({ type: 'status', open: false })
      conn.close()
      conn = null
      room = null
      isOpen = false
    },
    whisper(r: Resolution) { const m = whisperFromResolution(r); if (m) send(m) },
    board(terms: Term[]) {
      const clip = (ps: string[]) => ps.slice(0, MAX_BOARD_PHRASES).map(clipPhrase) // the server drops a whole board over either limit
      board = { type: 'board', phrases: clip(readingOrder(terms).map(t => t.phrase)), overview: clip(overview(terms)) }
      send(board)
    },
    notice(text: string) { send({ type: 'notice', text }) },
    onListeners(cb: (n: number) => void) { listenerCbs.add(cb); return () => { listenerCbs.delete(cb) } },
    onState(cb: (s: RoomState) => void) { stateCbs.add(cb); return () => { stateCbs.delete(cb) } },
  }
  return api
}

export type Classroom = ReturnType<typeof createClassroom>

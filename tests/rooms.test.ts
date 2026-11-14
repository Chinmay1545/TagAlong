import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import { WebSocket } from 'ws'
import { createRoomHub, roomToken, CAMERA_GRACE_MS } from '../server/rooms'
import { COOKIE, type Access } from '../server/access'

// Real HTTP server + real WebSocket clients: one camera device, several student phones.
const KEY = 'test-access-key'
const hosted: Access = { hosts: new Set(['127.0.0.1', 'localhost']), key: KEY, isPublic: true }

type Client = { ws: WebSocket; msgs: unknown[]; next(): Promise<unknown>; closed: Promise<number> }
const servers: http.Server[] = []
const hubs: { close(): void }[] = []
afterEach(async () => {
  hubs.splice(0).forEach(h => h.close())
  await Promise.all(servers.splice(0).map(s => new Promise(r => { s.closeAllConnections(); s.close(r) })))
})

async function start(opts: { access?: Access; maxStudents?: number; graceMs?: number } = {}) {
  const server = http.createServer()
  const hub = createRoomHub({ access: opts.access ?? hosted, maxStudents: opts.maxStudents, graceMs: opts.graceMs })
  hub.attach(server)
  hubs.push(hub)
  servers.push(server)
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  const open = (query: string, headers: Record<string, string> = {}): Promise<Client> => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/room?${query}`, { headers: { origin: `http://127.0.0.1:${port}`, ...headers } })
    const msgs: unknown[] = []
    const waiters: ((m: unknown) => void)[] = []
    ws.on('message', d => { const m = JSON.parse(String(d)); const w = waiters.shift(); if (w) w(m); else msgs.push(m) })
    const closed = new Promise<number>(r => ws.on('close', code => r(code)))
    ws.on('open', () => resolve({ ws, msgs, closed, next: () => (msgs.length ? Promise.resolve(msgs.shift()) : new Promise(r => waiters.push(r))) }))
    ws.on('unexpected-response', (_req, res) => reject(new Error(`http ${res.statusCode}`)))
    ws.on('error', reject)
  })
  const camera = (room = 'math201') => open(`role=camera&room=${room}`, { cookie: `${COOKIE}=${KEY}` })
  const student = (room = 'math201', token = roomToken(KEY, room)) => open(`role=student&room=${room}&t=${token}`)
  return { hub, open, camera, student }
}
const settle = () => new Promise(r => setTimeout(r, 30))

describe('room tokens', () => {
  it('are stable per room and secret, and differ across rooms and secrets', () => {
    expect(roomToken(KEY, 'math201')).toBe(roomToken(KEY, 'math201'))
    expect(roomToken(KEY, 'math201')).not.toBe(roomToken(KEY, 'bio110'))
    expect(roomToken('other-key', 'math201')).not.toBe(roomToken(KEY, 'math201'))
    expect(roomToken(KEY, 'math201')).toMatch(/^[A-Za-z0-9_-]{20,}$/) // URL-safe
  })
})

describe('room hub', () => {
  it('a student in an empty room hears "not live", then "live" when the camera joins, and "not live" when it leaves', async () => {
    const { camera, student } = await start({ graceMs: 40 })
    const s = await student()
    expect(await s.next()).toEqual({ type: 'status', live: false })
    const c = await camera()
    expect(await s.next()).toEqual({ type: 'status', live: true })
    c.ws.close()
    expect(await s.next()).toEqual({ type: 'status', live: false })
  })

  it('waits 10 s by default before a dropped camera ends the class', () => {
    expect(CAMERA_GRACE_MS).toBe(10_000)
  })

  it('a camera that drops and returns within the grace period is never missed: students hear nothing', async () => {
    const { camera, student, hub } = await start({ graceMs: 200 })
    const c = await camera()
    const s = await student()
    expect(await s.next()).toEqual({ type: 'status', live: true })
    c.ws.close()
    await settle()
    expect(hub.isLive('math201')).toBe(true) // phones keep the class during the grace period
    await camera()
    await new Promise(r => setTimeout(r, 300))
    expect(s.msgs.filter(m => (m as { type: string }).type === 'status')).toEqual([])
    expect(hub.isLive('math201')).toBe(true)
  })

  it('a camera gone longer than the grace period tells students not live', async () => {
    const { camera, student, hub } = await start({ graceMs: 60 })
    const c = await camera()
    const s = await student()
    expect(await s.next()).toEqual({ type: 'status', live: true })
    c.ws.close()
    expect(await s.next()).toEqual({ type: 'status', live: false })
    expect(hub.isLive('math201')).toBe(false)
  })

  it('closing the class ends it at once even with a long grace period, and then a drop is not delayed', async () => {
    const { camera, student, hub } = await start({ graceMs: 60_000 })
    const c = await camera()
    const s = await student()
    expect(await s.next()).toEqual({ type: 'status', live: true })
    c.ws.send(JSON.stringify({ type: 'status', open: false }))
    expect(await s.next()).toEqual({ type: 'status', live: false })
    expect(hub.isLive('math201')).toBe(false)
  })

  it('the room survives its grace period when nobody else is in it, and hub.close() clears the timer', async () => {
    const { camera, hub } = await start({ graceMs: 60_000 })
    const c = await camera()
    c.ws.close()
    await settle()
    expect(hub.isLive('math201')).toBe(true)
    hub.close()
    expect(hub.isLive('math201')).toBe(false)
  })

  it('relays a whisper from the camera to every student in the room, not to other rooms', async () => {
    const { camera, student } = await start()
    const c = await camera()
    const ss = await Promise.all([student(), student(), student()])
    const other = await student('bio110')
    for (const s of ss) expect(await s.next()).toEqual({ type: 'status', live: true })
    expect(await other.next()).toEqual({ type: 'status', live: false })
    const whisper = { type: 'whisper', word: 'this', items: [{ phrase: 'the 2x on top', x: 0.3 }] }
    c.ws.send(JSON.stringify(whisper))
    for (const s of ss) expect(await s.next()).toEqual(whisper)
    await settle()
    expect(other.msgs).toEqual([])
  })

  it('gives a late joiner the latest board right after the status', async () => {
    const { camera, student } = await start()
    const c = await camera()
    c.ws.send(JSON.stringify({ type: 'board', phrases: ['old'] }))
    c.ws.send(JSON.stringify({ type: 'board', phrases: ['the x on the left', 'the 5 on the left'] }))
    await settle()
    const s = await student()
    expect(await s.next()).toEqual({ type: 'status', live: true })
    expect(await s.next()).toEqual({ type: 'board', phrases: ['the x on the left', 'the 5 on the left'] })
  })

  it('remembers the overview with the board: late joiners get it, and its phrases may be voiced', async () => {
    const { hub, camera, student } = await start()
    const c = await camera()
    c.ws.send(JSON.stringify({ type: 'board', phrases: ['x'], overview: ['the equation: x plus 1 equals 2'] }))
    await settle()
    const s = await student()
    expect(await s.next()).toEqual({ type: 'status', live: true })
    expect(await s.next()).toEqual({ type: 'board', phrases: ['x'], overview: ['the equation: x plus 1 equals 2'] })
    expect(hub.allowsPhrase('math201', 'the equation: x plus 1 equals 2')).toBe(true)
  })

  it('tells the camera how many students are listening', async () => {
    const { camera, student } = await start()
    const c = await camera()
    expect(await c.next()).toEqual({ type: 'listeners', count: 0 })
    const a = await student()
    expect(await c.next()).toEqual({ type: 'listeners', count: 1 })
    await student()
    expect(await c.next()).toEqual({ type: 'listeners', count: 2 })
    a.ws.close()
    expect(await c.next()).toEqual({ type: 'listeners', count: 1 })
  })

  it('closing the class (status open: false) tells students it is not live; reopening tells them it is', async () => {
    const { camera, student } = await start()
    const c = await camera()
    const s = await student()
    expect(await s.next()).toEqual({ type: 'status', live: true })
    c.ws.send(JSON.stringify({ type: 'status', open: false }))
    expect(await s.next()).toEqual({ type: 'status', live: false })
    c.ws.send(JSON.stringify({ type: 'status', open: true }))
    expect(await s.next()).toEqual({ type: 'status', live: true })
  })

  it('a second camera for the same room replaces the first', async () => {
    const { camera } = await start()
    const first = await camera()
    await camera()
    expect(await first.closed).toBe(4000)
  })

  it('a camera that reconnects before its old socket closes does not re-announce the class to students', async () => {
    const { camera, student } = await start()
    await camera()
    const s = await student()
    expect(await s.next()).toEqual({ type: 'status', live: true })
    await camera()
    await settle()
    expect(s.msgs).toEqual([])
  })

  it('relays nothing invalid, and nothing a student sends (one way only)', async () => {
    const { camera, student } = await start()
    const c = await camera()
    expect(await c.next()).toEqual({ type: 'listeners', count: 0 })
    const s1 = await student(), s2 = await student()
    await s1.next(); await s2.next()
    await c.next(); await c.next() // listener counts
    c.ws.send('not json')
    c.ws.send(JSON.stringify({ type: 'whisper', word: 'this', items: [{ phrase: 'p', x: 9 }] }))
    s1.ws.send(JSON.stringify({ type: 'whisper', word: 'this', items: [{ phrase: 'fake', x: 0.5 }] }))
    await settle()
    expect(s1.msgs).toEqual([])
    expect(s2.msgs).toEqual([])
    expect(c.msgs).toEqual([])
  })

  it('rejects a wrong token, a token for another room, a bad room name, and a camera without the key', async () => {
    const { open, student } = await start()
    await expect(student('math201', 'wrong')).rejects.toThrow(/401/)
    await expect(student('math201', roomToken(KEY, 'bio110'))).rejects.toThrow(/401/)
    await expect(open(`role=student&room=Math%20201&t=${roomToken(KEY, 'Math 201')}`)).rejects.toThrow(/400/)
    await expect(open('role=camera&room=math201')).rejects.toThrow(/401/)
    await expect(open(`role=camera&room=math201`, { cookie: `${COOKIE}=wrong` })).rejects.toThrow(/401/)
    await expect(open('role=admin&room=math201', { cookie: `${COOKIE}=${KEY}` })).rejects.toThrow(/400/)
  })

  it('rejects a connection from another website (origin check)', async () => {
    const { open } = await start()
    await expect(open(`role=student&room=math201&t=${roomToken(KEY, 'math201')}`, { origin: 'https://evil.example' })).rejects.toThrow(/403/)
  })

  it('caps the students in one room', async () => {
    const { student } = await start({ maxStudents: 2 })
    await student(); await student()
    await expect(student()).rejects.toThrow(/503/)
  })

  it('only phrases the camera published in a room may be voiced for that room', async () => {
    const { hub, camera } = await start()
    const c = await camera()
    c.ws.send(JSON.stringify({ type: 'whisper', word: 'this', items: [{ phrase: 'the 2x on top', x: 0.3 }] }))
    c.ws.send(JSON.stringify({ type: 'board', phrases: ['the 3 on the bottom'] }))
    await settle()
    expect(hub.allowsPhrase('math201', 'the 2x on top')).toBe(true)
    expect(hub.allowsPhrase('math201', 'the 3 on the bottom')).toBe(true)
    expect(hub.allowsPhrase('math201', 'say something rude')).toBe(false)
    expect(hub.allowsPhrase('bio110', 'the 2x on top')).toBe(false)
  })

  it('works locally with no access key: a camera needs no cookie and student links still need the right token', async () => {
    const local: Access = { hosts: new Set(['127.0.0.1', 'localhost']), isPublic: false }
    const { open } = await start({ access: local })
    const c = await open('role=camera&room=math201')
    expect(await c.next()).toEqual({ type: 'listeners', count: 0 })
    const tok = createRoomHub({ access: local }).tokenFor('math201')
    await open(`role=student&room=math201&t=${tok}`)
    await expect(open('role=student&room=math201&t=wrong')).rejects.toThrow(/401/)
  })
})

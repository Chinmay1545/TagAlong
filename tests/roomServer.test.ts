import { describe, it, expect, afterEach } from 'vitest'
import type http from 'node:http'
import { WebSocket } from 'ws'
import { createApp } from '../server/index'
import { attachTranscribe } from '../server/transcribe'
import { createRoomHub, roomToken } from '../server/rooms'
import { COOKIE, type Access } from '../server/access'

// The relay wired into the real app: link endpoint, TTS for students, and two WebSocket paths on one server.
const KEY = 'test-access-key'
const hosted: Access = { hosts: new Set(['127.0.0.1', 'localhost']), key: KEY, isPublic: true }
const cookie = `${COOKIE}=${KEY}`
const tok = roomToken(KEY, 'math201')
const closers: (() => Promise<void>)[] = []
afterEach(async () => { await Promise.all(closers.splice(0).map(c => c())) })

async function start() {
  const hub = createRoomHub({ access: hosted })
  const synthCalls: string[] = []
  const synth = async (text: string) => { synthCalls.push(text); return Buffer.from('mp3:' + text) }
  const server: http.Server = createApp(async () => '', synth, undefined, { access: hosted, rooms: hub }).listen(0, '127.0.0.1')
  await new Promise(r => server.once('listening', r))
  attachTranscribe(server, async function* () {}, hosted) // attached first, as in production: must not swallow /ws/room
  hub.attach(server)
  closers.push(() => { hub.close(); server.closeAllConnections(); return new Promise(r => server.close(() => r())) })
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`
  const ws = (path: string, headers: Record<string, string> = {}) => new Promise<WebSocket>((resolve, reject) => {
    const w = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { origin: base, ...headers } })
    w.on('open', () => resolve(w)); w.on('unexpected-response', (_q, r) => reject(new Error(`http ${r.statusCode}`))); w.on('error', reject)
  })
  const tts = (text: string, headers: Record<string, string>) =>
    fetch(`${base}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ text }) })
  const status = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/room-status`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  return { base, ws, tts, status, synthCalls }
}
const settle = () => new Promise(r => setTimeout(r, 40))

describe('classroom relay in the app', () => {
  it('the transcribe socket and the room socket both work on the same server', async () => {
    const { ws } = await start()
    await expect(ws('/ws/transcribe', { cookie })).resolves.toBeInstanceOf(WebSocket)
    await expect(ws('/ws/room?role=camera&room=math201', { cookie })).resolves.toBeInstanceOf(WebSocket)
    await expect(ws(`/ws/room?role=student&room=math201&t=${tok}`)).resolves.toBeInstanceOf(WebSocket)
  })

  it('gives the camera device the student link for a course (key required)', async () => {
    const { base } = await start()
    const ok = await fetch(`${base}/api/room-link?room=math201`, { headers: { cookie } })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ room: 'math201', path: `/?student&room=math201&t=${tok}` })
    expect((await fetch(`${base}/api/room-link?room=math201`)).status).toBe(401)
    expect((await fetch(`${base}/api/room-link?room=Math%20201`, { headers: { cookie } })).status).toBe(400)
  })

  it('voices a phrase the camera published for a student holding that room\'s token', async () => {
    const { ws, tts, synthCalls } = await start()
    const cam = await ws('/ws/room?role=camera&room=math201', { cookie })
    cam.send(JSON.stringify({ type: 'board', phrases: ['the x on the left'] }))
    await settle()
    const r = await tts('the x on the left', { 'x-room': 'math201', 'x-room-token': tok })
    expect(r.status).toBe(200)
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe('mp3:the x on the left')
    expect(synthCalls).toEqual(['the x on the left'])
  })

  it('ten students asking for the same phrase cost one voice request', async () => {
    const { ws, tts, synthCalls } = await start()
    const cam = await ws('/ws/room?role=camera&room=math201', { cookie })
    cam.send(JSON.stringify({ type: 'whisper', word: 'this', items: [{ phrase: 'the 2x on top', x: 0.4 }] }))
    await settle()
    const rs = await Promise.all(Array.from({ length: 10 }, () => tts('the 2x on top', { 'x-room': 'math201', 'x-room-token': tok })))
    expect(rs.every(r => r.status === 200)).toBe(true)
    expect(synthCalls.length).toBeLessThanOrEqual(2) // cached after the first finishes; at most a racing second
  })

  it('refuses a student any text the camera did not publish, and a wrong or missing token', async () => {
    const { tts, synthCalls } = await start()
    expect((await tts('say something rude', { 'x-room': 'math201', 'x-room-token': tok })).status).toBe(403)
    expect((await tts('the x on the left', { 'x-room': 'math201', 'x-room-token': 'wrong' })).status).toBe(401)
    expect((await tts('the x on the left', {})).status).toBe(401)
    expect(synthCalls).toEqual([])
  })

  it('a room token opens nothing but the voice: other paid routes still need the key', async () => {
    const { base } = await start()
    const h = { 'x-room': 'math201', 'x-room-token': tok }
    expect((await fetch(`${base}/api/read-board`, { method: 'POST', headers: { ...h, 'content-type': 'image/jpeg' }, body: new Uint8Array([1]) })).status).toBe(401)
    expect((await fetch(`${base}/api/room-link?room=math201`, { headers: h })).status).toBe(401)
  })

  it('the camera device keeps using the voice with its key, for any text', async () => {
    const { tts } = await start()
    expect((await tts('anything at all', { cookie })).status).toBe(200)
  })

  it('room-status lists only verified live rooms, with no access key and no headers', async () => {
    const { ws, status } = await start()
    const bio = roomToken(KEY, 'bio110')
    await ws('/ws/room?role=camera&room=math201', { cookie })
    const r = await status({ rooms: [{ room: 'math201', token: tok }, { room: 'bio110', token: bio }, { room: 'chem1', token: 'wrong' }, { room: 'Bad Room', token: 'x' }, { room: 5 }, null] })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ live: ['math201'] })
  })

  it('room-status leaves out a room whose token belongs to another room, and a closed class', async () => {
    const { ws, status } = await start()
    const cam = await ws('/ws/room?role=camera&room=math201', { cookie })
    expect(await (await status({ rooms: [{ room: 'math201', token: roomToken(KEY, 'bio110') }] })).json()).toEqual({ live: [] })
    cam.send(JSON.stringify({ type: 'status', open: false }))
    await settle()
    expect(await (await status({ rooms: [{ room: 'math201', token: tok }] })).json()).toEqual({ live: [] })
  })

  it('room-status refuses more than ten rooms and malformed bodies', async () => {
    const { status } = await start()
    const many = Array.from({ length: 11 }, (_, i) => ({ room: `r${i}`, token: 'x' }))
    expect((await status({ rooms: many })).status).toBe(400)
    expect((await status({ rooms: 'math201' })).status).toBe(400)
    expect((await status({})).status).toBe(400)
    expect((await status('{not json')).status).toBe(400)
  })

  it('a room token still cannot call any other route', async () => {
    const { base } = await start()
    const h = { 'x-room': 'math201', 'x-room-token': tok }
    expect((await fetch(`${base}/api/notes`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{}' })).status).toBe(401)
    expect((await fetch(`${base}/api/read-board`, { method: 'POST', headers: { ...h, 'content-type': 'image/jpeg' }, body: new Uint8Array([1]) })).status).toBe(401)
    expect((await fetch(`${base}/api/room-link?room=math201`, { headers: h })).status).toBe(401)
    expect((await fetch(`${base}/api/room-status`, { headers: h })).status).not.toBe(200) // GET is not the route
  })
})

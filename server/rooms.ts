import type http from 'node:http'
import type { Duplex } from 'node:stream'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { LOCAL_ACCESS, hostAllowed, keyAllowed, originAllowed, type Access } from './access'
import { isRoomName, parseCameraMsg, MAX_PHRASE, type ServerToCamera, type ServerToStudent } from '../src/live/roomProtocol'

// Classroom relay hub at /ws/room. One camera device per room publishes; every student phone in the room
// receives. One way only: whatever a student sends is ignored. No AI, no audio: text messages only.
//   camera:  /ws/room?role=camera&room=math201      needs the access key cookie (like the rest of the app)
//   student: /ws/room?role=student&room=math201&t=T  T = roomToken(secret, room): one secret link per course
// Rooms live in memory on this one server; a late joiner gets the live status and the latest board.

export const ROOM_PATH = '/ws/room'
const LOCAL_SECRET = 'tagalong-local-only' // no ACCESS_KEY (local dev): links still need a token, it just is not secret
const MAX_STUDENTS = 50
const MAX_PAYLOAD = 16 * 1024
const RECENT_PHRASES = 500 // phrases a student may fetch audio for, per room
const PING_MS = 25_000 // keeps proxies from closing idle sockets and finds dead phones

export const roomToken = (secret: string, room: string) =>
  createHmac('sha256', secret).update(`room:${room}`).digest('base64url').slice(0, 24)

type Room = { camera: WebSocket | null; open: boolean; students: Set<WebSocket>; board: string[] | null; phrases: Set<string> }

function reject(socket: Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}

export function createRoomHub({ access = LOCAL_ACCESS, maxStudents = MAX_STUDENTS }: { access?: Access; maxStudents?: number } = {}) {
  const secret = access.key ?? LOCAL_SECRET
  const rooms = new Map<string, Room>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD })
  const alive = new WeakMap<WebSocket, boolean>()

  const tokenFor = (room: string) => roomToken(secret, room)
  const verify = (room: string, token: string | null) => {
    if (!token) return false
    const a = Buffer.from(token), b = Buffer.from(tokenFor(room))
    return a.length === b.length && timingSafeEqual(a, b)
  }
  const roomOf = (name: string) => {
    let r = rooms.get(name)
    if (!r) rooms.set(name, (r = { camera: null, open: false, students: new Set(), board: null, phrases: new Set() }))
    return r
  }
  const live = (r: Room) => r.camera !== null && r.open
  const send = (ws: WebSocket, m: ServerToStudent | ServerToCamera) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)) }
  const toStudents = (r: Room, m: ServerToStudent) => { for (const s of r.students) send(s, m) }
  const listeners = (r: Room) => { if (r.camera) send(r.camera, { type: 'listeners', count: r.students.size }) }
  const remember = (r: Room, phrase: string) => {
    const p = phrase.trim().slice(0, MAX_PHRASE)
    r.phrases.delete(p)
    r.phrases.add(p) // newest last
    if (r.phrases.size > RECENT_PHRASES) r.phrases.delete(r.phrases.values().next().value!)
  }
  const forget = (name: string, r: Room) => { if (!r.camera && r.students.size === 0) rooms.delete(name) }

  function onCamera(ws: WebSocket, name: string) {
    const r = roomOf(name)
    if (r.camera) r.camera.close(4000, 'replaced by another camera device')
    r.camera = ws
    r.open = true
    toStudents(r, { type: 'status', live: true })
    listeners(r)
    ws.on('message', data => {
      if (r.camera !== ws) return
      const m = parseCameraMsg(String(data))
      if (!m) return
      if (m.type === 'status') {
        if (m.open !== r.open) { r.open = m.open; toStudents(r, { type: 'status', live: live(r) }) }
        return
      }
      if (m.type === 'whisper') m.items.forEach(i => remember(r, i.phrase))
      if (m.type === 'board') { r.board = m.phrases; m.phrases.forEach(p => remember(r, p)) }
      toStudents(r, m)
    })
    ws.on('close', () => {
      if (r.camera !== ws) return // replaced: the new camera already took over
      r.camera = null
      toStudents(r, { type: 'status', live: false })
      forget(name, r)
    })
  }

  function onStudent(ws: WebSocket, name: string) {
    const r = roomOf(name)
    r.students.add(ws)
    send(ws, { type: 'status', live: live(r) })
    if (r.board) send(ws, { type: 'board', phrases: r.board })
    listeners(r)
    // Students only listen: incoming messages are ignored.
    ws.on('close', () => { r.students.delete(ws); listeners(r); forget(name, r) })
  }

  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue }
      alive.set(ws, false)
      ws.ping()
    }
  }, PING_MS)
  ping.unref()

  function handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname !== ROOM_PATH) return
    if (!hostAllowed(access, req.headers.host) || !originAllowed(req.headers.origin, access)) return reject(socket, 403, 'Forbidden')
    const role = url.searchParams.get('role'), name = url.searchParams.get('room')
    if ((role !== 'camera' && role !== 'student') || !isRoomName(name)) return reject(socket, 400, 'Bad Request')
    if (role === 'camera' && !keyAllowed(access, req.headers.cookie)) return reject(socket, 401, 'Unauthorized')
    if (role === 'student') {
      if (!verify(name, url.searchParams.get('t'))) return reject(socket, 401, 'Unauthorized')
      if ((rooms.get(name)?.students.size ?? 0) >= maxStudents) return reject(socket, 503, 'Room Full')
    }
    wss.handleUpgrade(req, socket, head, ws => {
      alive.set(ws, true)
      ws.on('pong', () => alive.set(ws, true))
      if (role === 'camera') onCamera(ws, name)
      else onStudent(ws, name)
    })
  }

  return {
    tokenFor,
    verify,
    // Only phrases the camera published in that room may be voiced for a student of that room.
    allowsPhrase: (room: string, text: string) => rooms.get(room)?.phrases.has(text.trim().slice(0, MAX_PHRASE)) ?? false,
    attach(server: http.Server) { server.on('upgrade', handleUpgrade) },
    close() { clearInterval(ping); for (const ws of wss.clients) ws.terminate(); wss.close() },
  }
}

export type RoomHub = ReturnType<typeof createRoomHub>

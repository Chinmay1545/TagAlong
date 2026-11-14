import express from 'express'
import type http from 'node:http'
import { WebSocketServer } from 'ws'
import { LOCAL_ACCESS, hostAllowed, keyAllowed, originAllowed, type Access } from './access'
import { TOKEN_RE, createHub, roomToken, type Hub } from './rooms'
import { serveUpgrade } from './upgrade'

export const roomSecret = (env: Record<string, string | undefined>): string =>
  env.ROOM_SECRET || env.ACCESS_KEY || 'local-dev-room-secret'

const validName = (n: unknown): n is string => typeof n === 'string' && n.trim().length >= 1 && n.trim().length <= 60

export function roomsRouter(secret: string): express.Router {
  const r = express.Router()
  r.post('/api/rooms', express.json({ limit: '1kb' }), (req, res) => {
    const name = req.body?.name
    if (!validName(name)) return void res.status(400).json({ error: 'name must be 1-60 characters' })
    res.json({ token: roomToken(secret, name), name: name.trim() })
  })
  return r
}

export function attachRooms(server: http.Server, opts: { secret: string; access?: Access; hub?: Hub }): Hub {
  const { secret, access = LOCAL_ACCESS } = opts
  const hub = opts.hub ?? createHub()
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, verifyClient: ({ origin, req }, cb) => {
    const q = new URL(req.url ?? '/', 'http://x').searchParams
    const base = originAllowed(origin, access) && hostAllowed(access, req.headers.host)
    const role = q.get('role')
    if (role === 'teacher') {
      const name = q.get('name'), room = q.get('room')
      if (!validName(name) || !room || !TOKEN_RE.test(room)) return cb(false, 400)
      return base && keyAllowed(access, req.headers.cookie) && room === roomToken(secret, name) ? cb(true) : cb(false, 401)
    }
    const rooms = (q.get('rooms') ?? '').split(',')
    if (role !== 'student' || rooms.length > 10 || !rooms.every(t => TOKEN_RE.test(t))) return cb(false, 400)
    return base ? cb(true) : cb(false, 401)
  } })
  serveUpgrade(server, '/ws/room', wss)
  wss.on('connection', (ws, req) => {
    const q = new URL(req.url ?? '/', 'http://x').searchParams
    const sock = { send: (d: string) => ws.send(d), close: () => ws.close() }
    const dead = () => hub.remove(sock)
    if (q.get('role') === 'teacher') {
      hub.addTeacher(q.get('room')!, q.get('name')!.trim(), sock)
      ws.on('message', d => hub.fromTeacher(sock, String(d)))
    } else {
      hub.addStudent(sock, q.get('rooms')!.split(','))
      ws.on('message', d => hub.fromStudent(sock, String(d)))
    }
    ws.on('close', dead)
    ws.on('error', () => { dead(); ws.terminate() })
  })
  return hub
}

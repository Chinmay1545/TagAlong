import { describe, it, expect } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import express from 'express'
import { attachRooms, roomsRouter } from '../server/roomsServer'
import { attachTranscribe } from '../server/transcribe'
import { accessFromEnv, type Access } from '../server/access'
import { roomToken } from '../server/rooms'

const secret = 'test-secret'
const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise(r => setTimeout(r, 20)) }

async function withServer(fn: (port: number) => Promise<void>, access?: Access, both = false) {
  const server = http.createServer()
  if (both) attachTranscribe(server, async function* () { /* none */ }, access)
  attachRooms(server, { secret, access })
  await new Promise<void>(r => server.listen(0, r))
  try { await fn((server.address() as AddressInfo).port) } finally { server.closeAllConnections(); server.close() }
}
const open = (url: string, headers?: Record<string, string>) => new Promise<WebSocket | undefined>(res => {
  const ws = new WebSocket(url, { headers })
  ws.on('open', () => res(ws))
  ws.on('error', () => res(undefined))
})
const listen = (ws: WebSocket) => { const m: any[] = []; ws.on('message', d => m.push(JSON.parse(String(d)))); return m }
const tUrl = (p: number, name = 'Math', room = roomToken(secret, name)) => `ws://localhost:${p}/ws/room?role=teacher&room=${room}&name=${encodeURIComponent(name)}`
const sUrl = (p: number, rooms: string) => `ws://localhost:${p}/ws/room?role=student&rooms=${rooms}`

describe('POST /api/rooms', () => {
  const post = async (name: unknown) => {
    const server = express()
    server.use(roomsRouter(secret))
    const s = http.createServer(server); await new Promise<void>(r => s.listen(0, r))
    try {
      const r = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
      return [r.status, await r.json()] as const
    } finally { s.closeAllConnections(); s.close() }
  }
  it('returns the token for a name', async () => {
    expect(await post(' Math ')).toEqual([200, { token: roomToken(secret, 'Math'), name: 'Math' }])
  })
  it('400 for empty or 61-char name', async () => {
    for (const n of ['', '   ', 'x'.repeat(61), 5]) expect((await post(n))[0]).toBe(400)
  })
})

describe('/ws/room', () => {
  it('teacher and student meet and messages flow both ways', async () => {
    await withServer(async p => {
      const room = roomToken(secret, 'Math')
      const t = (await open(tUrl(p)))!, tm = listen(t)
      const s = (await open(sUrl(p, room)))!, sm = listen(s)
      await until(() => sm.length > 0)
      s.send(JSON.stringify({ type: 'join', room }))
      await until(() => tm.some(m => m.type === 'listeners' && m.count === 1))
      t.send(JSON.stringify({ type: 'resolution', text: 'x' }))
      await until(() => sm.some(m => m.type === 'resolution'))
      s.send(JSON.stringify({ type: 'bookmark' }))
      await until(() => tm.some(m => m.type === 'bookmark'))
      expect(tm.find(m => m.type === 'bookmark').from).toBeTruthy()
      t.close(); s.close()
    })
  })
  it('rejects bad teacher token, bad name, malformed student tokens', async () => {
    await withServer(async p => {
      expect(await open(tUrl(p, 'Math', 'tokenAAAAAAAAAAAAAAAA'))).toBeUndefined()
      expect(await open(tUrl(p, ' '))).toBeUndefined()
      expect(await open(sUrl(p, 'short'))).toBeUndefined()
      expect(await open(sUrl(p, ''))).toBeUndefined()
      expect(await open(sUrl(p, Array(11).fill('tokenAAAAAAAAAAAAAAAA').join(',')))).toBeUndefined()
    })
  })
  it('student needs no key but teacher does', async () => {
    const access = accessFromEnv({ ALLOWED_HOSTS: 'localhost', ACCESS_KEY: 'k' })
    await withServer(async p => {
      const s = await open(sUrl(p, roomToken(secret, 'Math'))); expect(s).toBeDefined(); s!.close()
      expect(await open(tUrl(p))).toBeUndefined()
      const t = await open(tUrl(p), { Cookie: 'tagalong_key=k' }); expect(t).toBeDefined(); t!.close()
    }, access)
  })
  it('/ws/room and /ws/transcribe both work on one server', async () => {
    await withServer(async p => {
      const a = await open(`ws://localhost:${p}/ws/transcribe`), b = await open(sUrl(p, roomToken(secret, 'Math')))
      expect(a).toBeDefined(); expect(b).toBeDefined(); a!.close(); b!.close()
    }, undefined, true)
  })
})

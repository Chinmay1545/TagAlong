import { describe, it, expect } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import { attachTranscribe, originAllowed, transcriptEventToItems } from '../server/transcribe'

const partial = {
  TranscriptEvent: { Transcript: { Results: [{ IsPartial: true, StartTime: 1.2, EndTime: 1.6, Alternatives: [{ Transcript: 'this,', Items: [
    { Content: 'this', StartTime: 1.2, EndTime: 1.4, Type: 'pronunciation' },
    { Content: ',', Type: 'punctuation' },
  ] }] }] } },
}

describe('transcriptEventToItems', () => {
  it('maps a partial to word items, skipping punctuation', () => {
    const r = transcriptEventToItems(partial, 5)
    expect(r.items).toEqual([{ content: 'this', startTime: 1.2, endTime: 1.4, isPartial: true, arrivedAt: 5 }])
    expect(r.final).toBeUndefined()
  })
  it('yields final for a non-partial result', () => {
    const ev = structuredClone(partial)
    ev.TranscriptEvent.Transcript.Results[0].IsPartial = false
    const r = transcriptEventToItems(ev, 5)
    expect(r.final).toEqual({ text: 'this,', t0: 1.2, t1: 1.6 })
    expect(r.items[0].isPartial).toBe(false)
  })
  it('never throws on junk', () => {
    for (const j of [null, undefined, 3, 'x', {}, { TranscriptEvent: {} }, { TranscriptEvent: { Transcript: { Results: [null, {}] } } }])
      expect(transcriptEventToItems(j, 0)).toEqual({ items: [] })
  })
})

async function withServer(make: Parameters<typeof attachTranscribe>[1], fn: (ws: WebSocket, msgs: any[], closed: Promise<void>) => Promise<void>) {
  const server = http.createServer()
  attachTranscribe(server, make)
  await new Promise<void>((r) => server.listen(0, r))
  const ws = new WebSocket(`ws://localhost:${(server.address() as AddressInfo).port}/ws/transcribe`)
  const msgs: any[] = []
  ws.on('message', (d) => msgs.push(JSON.parse(String(d))))
  const closed = new Promise<void>((r) => ws.on('close', () => r()))
  await new Promise((r) => ws.on('open', r))
  try { await fn(ws, msgs, closed) } finally { ws.close(); server.closeAllConnections(); server.close() }
}
const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 20)); }

describe('attachTranscribe', () => {
  it('forwards audio and relays items', async () => {
    let got = 0
    await withServer(async function* (audio) {
      for await (const c of audio) { got += c.length; if (got >= 8) break }
      yield partial
    }, async (ws, msgs) => {
      ws.send(new Int16Array([1, 2]))
      ws.send(new Int16Array([3, 4]))
      await until(() => msgs.length > 0)
      expect(msgs[0].type).toBe('items')
      expect(msgs[0].items[0].content).toBe('this')
      expect(got).toBe(8)
    })
  })
  it('relays stream errors then closes', async () => {
    await withServer(async function* () {
      throw Object.assign(new Error('Your account is not subscribed'), { name: 'SubscriptionRequiredException' })
      yield 0
    }, async (_ws, msgs, closed) => {
      await closed
      expect(msgs[0].type).toBe('error')
      expect(msgs[0].error).toBe('transcribe not subscribed')
    })
  })
  it('errors out and closes on audio backlog instead of dropping audio', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let bytes = 0
    let done = false
    await withServer(async function* (audio) {
      await gate
      for await (const c of audio) bytes += c.length
      done = true
    }, async (ws, msgs, closed) => {
      const chunk = new Int16Array(10000) // 20000 bytes
      for (let i = 0; i < 20; i++) ws.send(chunk)
      await closed
      expect(msgs.some((m) => m.type === 'error' && m.error === 'audio backlog')).toBe(true)
      release()
      await until(() => done)
      expect(bytes).toBeLessThanOrEqual(160000)
    })
  })
  it('ends the audio iterator when the browser closes', async () => {
    let ended = false
    await withServer(async function* (audio) {
      for await (const _ of audio) { /* drain */ }
      ended = true
    }, async (ws) => {
      ws.send(new Int16Array([1]))
      await new Promise((r) => setTimeout(r, 50))
      ws.close()
      await until(() => ended)
      expect(ended).toBe(true)
    })
  })
  it('survives a server-side socket error', async () => {
    const server = http.createServer()
    attachTranscribe(server, async function* (audio) { for await (const _ of audio) { /* drain */ } })
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const ws1 = new WebSocket(`ws://localhost:${port}/ws/transcribe`)
    await new Promise((r) => ws1.on('open', r))
    ws1.on('error', () => {})
    // find the server-side socket via the WebSocketServer clients
    const { WebSocketServer } = await import('ws')
    void WebSocketServer
    const wss = (server as any).listeners('upgrade').length // upgrade handler registered
    expect(wss).toBeGreaterThan(0)
    ws1.send(Buffer.alloc(200 * 1024)) // > maxPayload: server-side ws error (1009)
    await new Promise((r) => setTimeout(r, 100))
    const ws2 = new WebSocket(`ws://localhost:${port}/ws/transcribe`)
    await new Promise((r, j) => { ws2.on('open', r); ws2.on('error', j) })
    ws2.close(); ws1.terminate(); server.closeAllConnections(); server.close()
  })
})

describe('origin check', () => {
  it.each([[undefined, true], ['http://localhost:5173', true], ['http://127.0.0.1:8787', true], ['https://evil.example', false], ['http://localhost.evil.example', false], ['null', false]])('%s -> %s', (o, ok) => expect(originAllowed(o)).toBe(ok))
  it('rejects a websocket upgrade from a foreign origin', async () => {
    const server = http.createServer()
    attachTranscribe(server, async function* () { /* none */ })
    await new Promise<void>((r) => server.listen(0, r))
    const ws = new WebSocket(`ws://localhost:${(server.address() as AddressInfo).port}/ws/transcribe`, { origin: 'https://evil.example' })
    const err = await new Promise<Error>((r) => ws.on('error', r))
    expect(String(err.message)).toMatch(/40[13]/)
    server.closeAllConnections(); server.close()
  })
})

import { startInput } from '../server/transcribe'
describe('startInput vocabulary', () => {
  const audio = (async function* () {})()
  it('passes VocabularyName only when TRANSCRIBE_VOCABULARY is set', () => {
    expect(startInput(audio, { TRANSCRIBE_VOCABULARY: 'tagalong-math' }).VocabularyName).toBe('tagalong-math')
    expect(startInput(audio, {})).not.toHaveProperty('VocabularyName')
  })
})

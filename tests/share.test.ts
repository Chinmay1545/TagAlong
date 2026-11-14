import { describe, it, expect } from 'vitest'
import type { AddressInfo } from 'node:net'
import { makeShare } from '../server/share'
import { createApp } from '../server/index'

describe('makeShare', () => {
  it('puts a text object and returns a 24h presigned url', async () => {
    const puts: any[] = []; const signed: any[] = []
    const share = makeShare('bkt', { send: async (c: any) => { puts.push(c.input); return {} } }, async (_c, cmd: any, o: any) => { signed.push({ cmd: cmd.input, o }); return 'https://signed/x' })
    expect(await share('hi')).toBe('https://signed/x')
    expect(puts[0].Bucket).toBe('bkt')
    expect(puts[0].Key).toMatch(/^notes\/[0-9a-f-]{36}\.txt$/)
    expect(puts[0].ContentType).toBe('text/plain; charset=utf-8')
    expect(signed[0].cmd.Key).toBe(puts[0].Key)
    expect(signed[0].o).toEqual({ expiresIn: 86400 })
  })
})

describe('POST /api/share-notes', () => {
  const post = async (share: any, body: unknown) => {
    const server = createApp(async () => '', undefined, undefined, { share }).listen(0)
    try {
      const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/share-notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      return { status: r.status, body: await r.json() as any }
    } finally { server.close() }
  }
  it('503 when not configured', async () => { expect((await post(undefined, { text: 'a' })).status).toBe(503) })
  it('400 on bad or oversized text', async () => {
    const s = async () => 'u'
    expect((await post(s, { text: '' })).status).toBe(400)
    expect((await post(s, {})).status).toBe(400)
    expect((await post(s, { text: 'x'.repeat(200_001) })).status).toBe(400)
  })
  it('returns url', async () => { expect(await post(async (t: string) => `u:${t}`, { text: 'hey' })).toEqual({ status: 200, body: { url: 'u:hey' } }) })
  it('generic 502 on failure', async () => {
    const r = await post(async () => { throw new Error('secret detail') }, { text: 'a' })
    expect(r.status).toBe(502); expect(JSON.stringify(r.body)).not.toContain('secret')
  })
})

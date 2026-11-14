import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { healthFrom } from '../server/health'
import { createApp } from '../server/index'

describe('healthFrom', () => {
  it('all configured via anthropic + aws region', () => {
    expect(healthFrom({ ANTHROPIC_API_KEY: 'k', AWS_REGION: 'us-east-1' }, '1.2.3'))
      .toEqual({ ok: true, board: 'anthropic', tts: true, voice: 'polly', notes: true, transcribe: 'configured', share: false, provider: { board: 'anthropic', notes: 'anthropic' }, version: '1.2.3' })
  })
  it('bedrock board when only BOARD_MODEL_ID', () => {
    const h = healthFrom({ BOARD_MODEL_ID: 'm', AWS_REGION: 'us-east-1' }, 'v')
    expect(h).toMatchObject({ ok: true, board: 'bedrock', notes: true, provider: { board: 'bedrock', notes: 'bedrock' } })
  })
  it('empty env is not ok and exposes no values', () => {
    const h = healthFrom({}, 'v')
    expect(h).toEqual({ ok: false, board: 'missing', tts: false, voice: 'browser', notes: false, transcribe: 'missing', share: false, provider: { board: 'missing', notes: 'missing' }, version: 'v' })
  })
  it('missing tts makes ok false', () => {
    expect(healthFrom({ ANTHROPIC_API_KEY: 'k' }, 'v').ok).toBe(false)
  })
})

describe('provider + share', () => {
  it('MODEL_PROVIDER=bedrock forces bedrock even with an anthropic key', () => {
    expect(healthFrom({ ANTHROPIC_API_KEY: 'k', MODEL_PROVIDER: 'bedrock', BOARD_MODEL_ID: 'm', AWS_REGION: 'r' }, 'v').provider).toEqual({ board: 'bedrock', notes: 'bedrock' })
  })
  it('NOTES_BUCKET turns share on', () => {
    expect(healthFrom({ NOTES_BUCKET: 'b' }, 'v').share).toBe(true)
  })
})

describe('server health + static', () => {
  it('serves /api/health, static files, SPA fallback; API and ws paths are not swallowed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-static-'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>spa</title>')
    writeFileSync(join(dir, 'a.txt'), 'hello')
    const server = createApp(async () => '', undefined, undefined, { staticDir: dir }).listen(0)
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const h = await (await fetch(`${base}/api/health`)).json() as any
      expect(typeof h.ok).toBe('boolean')
      expect(h.version).toBeTruthy()
      expect(await (await fetch(`${base}/a.txt`)).text()).toBe('hello')
      expect(await (await fetch(`${base}/some/route`)).text()).toContain('<title>spa</title>')
      const nope = await fetch(`${base}/api/nope`)
      expect(nope.status).toBe(404)
      expect(await nope.json()).toEqual({ error: 'not found' })
      expect((await fetch(`${base}/ws/x`)).status).toBe(404)
    } finally { server.close() }
  })
  it('no staticDir: no fallback', async () => {
    const server = createApp(async () => '').listen(0)
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)
      expect(res.status).toBe(404)
    } finally { server.close() }
  })
})

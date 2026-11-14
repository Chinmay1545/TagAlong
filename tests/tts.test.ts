import { describe, it, expect, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/index'
import { escapeXml, toSsml, pollySynth } from '../server/tts'
import { TTS_MAX_CHARS } from '../src/core/config'

const bytes = Buffer.from([1, 2, 3, 4])
const noModel = async () => ''

async function post(synth: ((t: string) => Promise<Buffer>) | undefined, body: unknown, app = createApp(noModel, synth)) {
  const server = app.listen(0)
  try {
    const { port } = server.address() as AddressInfo
    const res = await fetch(`http://127.0.0.1:${port}/api/tts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const buf = Buffer.from(await res.arrayBuffer())
    return { status: res.status, type: res.headers.get('content-type'), buf }
  } finally { server.close() }
}

describe('tts', () => {
  it('returns audio/mpeg with the synth bytes', async () => {
    const r = await post(async () => bytes, { text: 'the 2x on top' })
    expect(r.status).toBe(200)
    expect(r.type).toBe('audio/mpeg')
    expect(r.buf.equals(bytes)).toBe(true)
  })

  it('caches by trimmed text', async () => {
    const synth = vi.fn(async () => bytes)
    const app = createApp(noModel, synth)
    await post(undefined, { text: 'hello' }, app)
    await post(undefined, { text: '  hello ' }, app)
    expect(synth).toHaveBeenCalledTimes(1)
  })

  it.each([{}, { text: 5 }, { text: '' }, { text: '   ' }, { text: 'x'.repeat(TTS_MAX_CHARS + 1) }])('400 for %j', async (b) => {
    const synth = vi.fn(async () => bytes)
    const r = await post(synth, b)
    expect(r.status).toBe(400)
    expect(JSON.parse(r.buf.toString()).error).toBeTruthy()
    expect(synth).not.toHaveBeenCalled()
  })

  it('502 on synth failure, and failures are not cached', async () => {
    const synth = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(bytes)
    const app = createApp(noModel, synth)
    const a = await post(undefined, { text: 'hi' }, app)
    expect(a.status).toBe(502)
    expect(JSON.parse(a.buf.toString())).toEqual({ error: 'tts failed' })
    const b = await post(undefined, { text: 'hi' }, app)
    expect(b.status).toBe(200)
    expect(synth).toHaveBeenCalledTimes(2)
  })

  it('503 without a synth', async () => {
    const r = await post(undefined, { text: 'hi' })
    expect(r.status).toBe(503)
    expect(JSON.parse(r.buf.toString())).toEqual({ error: 'tts not configured' })
  })
})

describe('ssml', () => {
  it('escapes XML metacharacters', () => expect(escapeXml(`a&b<c>"d'`)).toBe('a&amp;b&lt;c&gt;&quot;d&apos;'))
  it('wraps in prosody', () => expect(toSsml('x < y')).toBe('<speak><prosody rate="115%">x &lt; y</prosody></speak>'))
})

describe('pollySynth', () => {
  const named = (name: string, message = 'x', status?: number) => () => Object.assign(new Error(message), { name, $metadata: { httpStatusCode: status } })
  const audio = { transformToByteArray: async () => new Uint8Array([9, 8]) }
  const fake = (fail: (i: any) => boolean = () => false, err: () => Error = () => new Error('bad voice')) => {
    const calls: any[] = []
    return { calls, client: { send: async (cmd: any) => { calls.push(cmd.input); if (fail(cmd.input)) throw err(); return { AudioStream: audio } } } }
  }

  it('generative sends plain math-spoken text', async () => {
    const f = fake()
    const buf = await pollySynth({ voiceId: 'Ruth', engine: 'generative', client: f.client })('x^2 = 4')
    expect([...buf]).toEqual([9, 8])
    expect(f.calls[0]).toMatchObject({ Text: 'x squared equals 4', TextType: 'text', Engine: 'generative', VoiceId: 'Ruth' })
  })

  it('neural sends escaped SSML prosody', async () => {
    const f = fake()
    await pollySynth({ voiceId: 'Joanna', engine: 'neural', client: f.client })('a & b')
    expect(f.calls[0]).toMatchObject({ Text: '<speak><prosody rate="115%">a &amp; b</prosody></speak>', TextType: 'ssml', Engine: 'neural' })
  })

  it('falls back once to neural Joanna and stays there', async () => {
    const f = fake(i => i.Engine === 'generative', named('ValidationException', 'Voice Ruth does not support the generative engine'))
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const synth = pollySynth({ voiceId: 'Ruth', engine: 'generative', client: f.client })
    await synth('one')
    await synth('two')
    expect(f.calls.map(c => [c.Engine, c.VoiceId])).toEqual([['generative', 'Ruth'], ['neural', 'Joanna'], ['neural', 'Joanna']])
    expect(f.calls[1].TextType).toBe('ssml')
    expect(log).toHaveBeenCalledTimes(1)
    log.mockRestore()
  })

  it('ValidationException about text length does not trigger the fallback', async () => {
    const f = fake(() => true, named('ValidationException', 'Text length exceeds the maximum', 400))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const synth = pollySynth({ voiceId: 'Ruth', engine: 'generative', client: f.client })
    await expect(synth('hi')).rejects.toThrow()
    expect(f.calls).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('throws if the neural Joanna fallback also fails', async () => {
    const f = fake(() => true)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(pollySynth({ voiceId: 'Ruth', engine: 'generative', client: f.client })('hi')).rejects.toThrow()
  })

  it('transient error rethrows without switching engine', async () => {
    let n = 0
    const f = fake(() => n++ === 0, named('ThrottlingException', 'slow down', 400))
    const synth = pollySynth({ voiceId: 'Ruth', engine: 'generative', client: f.client })
    await expect(synth('a')).rejects.toThrow('slow down')
    await synth('b')
    expect(f.calls.map(c => c.Engine)).toEqual(['generative', 'generative'])
  })

  it('EngineNotSupportedException falls back and stays on neural', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = fake(i => i.Engine === 'generative', named('EngineNotSupportedException'))
    const synth = pollySynth({ voiceId: 'Ruth', engine: 'generative', client: f.client })
    await synth('a'); await synth('b')
    expect(f.calls.map(c => c.Engine)).toEqual(['generative', 'neural', 'neural'])
  })

  it('400 with voice in message falls back; 500 with voice in message does not', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = fake(i => i.Engine === 'generative', named('Other', 'Voice not found', 400))
    await pollySynth({ voiceId: 'Zed', engine: 'generative', client: a.client })('a')
    expect(a.calls.map(c => c.Engine)).toEqual(['generative', 'neural'])
    const b = fake(() => true, named('ServiceFailureException', 'voice backend down', 500))
    await expect(pollySynth({ voiceId: 'Ruth', engine: 'generative', client: b.client })('a')).rejects.toThrow()
    expect(b.calls).toHaveLength(1)
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import { ELEVEN_DEFAULT_MODEL, ELEVEN_DEFAULT_VOICE, elevenLabsSynth } from '../server/elevenlabs'
import { firstWorking, synthFromEnv, voiceFromEnv } from '../server/voice'
import { healthFrom } from '../server/health'
import { createApp } from '../server/index'

const FAKE_KEY = 'fake-eleven-key-not-real'
const mp3 = Buffer.from([0x49, 0x44, 0x33, 9, 9, 9])
const ok = () => vi.fn(async (_url: string, _init?: RequestInit) => new Response(mp3, { status: 200, headers: { 'content-type': 'audio/mpeg' } }))
const failing = (status: number, body = '{"detail":{"status":"quota_exceeded","message":"nope"}}') => vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, { status }))

describe('elevenLabsSynth: one phrase in, MP3 bytes out', () => {
  it('posts the text to the text-to-speech endpoint for the voice, with the key in the xi-api-key header', async () => {
    const fetchFn = ok()
    const audio = await elevenLabsSynth({ apiKey: FAKE_KEY, fetchFn })('the y on top')
    expect(audio.equals(mp3)).toBe(true)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_DEFAULT_VOICE}?output_format=mp3_44100_128`)
    expect(init!.method).toBe('POST')
    const headers = new Headers(init!.headers)
    expect(headers.get('xi-api-key')).toBe(FAKE_KEY)
    expect(headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(init!.body as string)).toEqual({ text: 'the y on top', model_id: ELEVEN_DEFAULT_MODEL })
  })
  it('says math the same way the Polly voice does (2x -> 2 x, ^2 -> squared)', async () => {
    const fetchFn = ok()
    await elevenLabsSynth({ apiKey: FAKE_KEY, fetchFn })('the 2x^2 on top')
    expect(JSON.parse(fetchFn.mock.calls[0][1]!.body as string).text).toBe('the 2 x squared on top')
  })
  it('the voice, the model and the speed can be set', async () => {
    const fetchFn = ok()
    await elevenLabsSynth({ apiKey: FAKE_KEY, voiceId: 'VoiceABC123', modelId: 'eleven_flash_v2_5', speed: 1.1, fetchFn })('hello')
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toContain('/v1/text-to-speech/VoiceABC123?')
    expect(JSON.parse(init!.body as string)).toEqual({ text: 'hello', model_id: 'eleven_flash_v2_5', voice_settings: { speed: 1.1 } })
  })
  it('a voice id with odd characters cannot change the address', async () => {
    const fetchFn = ok()
    await elevenLabsSynth({ apiKey: FAKE_KEY, voiceId: '../v1/voices?x=1', fetchFn })('hello')
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.elevenlabs.io/v1/text-to-speech/..%2Fv1%2Fvoices%3Fx%3D1?output_format=mp3_44100_128')
  })
  it.each([401, 422, 429, 500])('status %i throws an error that names the status and never the key', async status => {
    const err = await elevenLabsSynth({ apiKey: FAKE_KEY, fetchFn: failing(status) })('hello').catch(e => e as Error)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain(String(status))
    expect((err as Error).message).not.toContain(FAKE_KEY)
  })
  it('an empty reply is an error, not silence', async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array(0), { status: 200 }))
    await expect(elevenLabsSynth({ apiKey: FAKE_KEY, fetchFn })('hello')).rejects.toThrow(/no audio/)
  })
  it('a network failure is passed on', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('socket hang up') })
    await expect(elevenLabsSynth({ apiKey: FAKE_KEY, fetchFn })('hello')).rejects.toThrow('socket hang up')
  })
})

describe('firstWorking: try each voice in order', () => {
  const a = Buffer.from('a'), b = Buffer.from('b')
  it('uses the first voice when it works, and says which one spoke', async () => {
    const second = vi.fn(async () => b)
    const synth = firstWorking([['elevenlabs', async () => a], ['polly', second]])
    expect((await synth('x')).equals(a)).toBe(true)
    expect(synth.last()).toBe('elevenlabs')
    expect(second).not.toHaveBeenCalled()
  })
  it('falls back to the next voice when the first fails, for that phrase only', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let fail = true
    const synth = firstWorking([['elevenlabs', async () => { if (fail) throw new Error('quota'); return a }], ['polly', async () => b]])
    expect((await synth('x')).equals(b)).toBe(true)
    expect(synth.last()).toBe('polly')
    fail = false
    expect((await synth('y')).equals(a)).toBe(true) // the first voice is tried again next time
    expect(synth.last()).toBe('elevenlabs')
  })
  it('when every voice fails, it throws the last error (the page then uses the browser voice)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const synth = firstWorking([['elevenlabs', async () => { throw new Error('one') }], ['polly', async () => { throw new Error('two') }]])
    await expect(synth('x')).rejects.toThrow('two')
  })
  it('the warning on fallback never prints a key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const eleven = elevenLabsSynth({ apiKey: FAKE_KEY, fetchFn: failing(401) })
    await firstWorking([['elevenlabs', eleven], ['polly', async () => b]])('x')
    expect(warn.mock.calls.flat().join(' ')).not.toContain(FAKE_KEY)
  })
})

describe('which voice the server uses', () => {
  it.each([
    [{ ELEVENLABS_API_KEY: 'k', AWS_REGION: 'us-east-1' }, 'elevenlabs'],
    [{ ELEVENLABS_API_KEY: 'k' }, 'elevenlabs'],
    [{ AWS_REGION: 'us-east-1' }, 'polly'],
    [{}, 'browser'],
    [{ ELEVENLABS_API_KEY: '   ' }, 'browser'],
  ] as const)('%j -> %s', (env, want) => {
    expect(voiceFromEnv(env)).toBe(want)
  })
  it('no voice service configured: no synth at all', () => {
    expect(synthFromEnv({})).toBeUndefined()
  })
  it('with an ElevenLabs key the synth calls ElevenLabs with the voice, model and speed from the settings', async () => {
    const fetchFn = ok()
    const synth = synthFromEnv({ ELEVENLABS_API_KEY: FAKE_KEY, ELEVENLABS_VOICE_ID: 'V1', ELEVENLABS_MODEL_ID: 'M1', ELEVENLABS_SPEED: '1.15' }, { fetchFn })!
    await synth('hello')
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toContain('/text-to-speech/V1?')
    expect(JSON.parse(init!.body as string)).toEqual({ text: 'hello', model_id: 'M1', voice_settings: { speed: 1.15 } })
    expect(synth.last()).toBe('elevenlabs')
  })
  it('a speed that is not a sensible number is ignored', async () => {
    const fetchFn = ok()
    await synthFromEnv({ ELEVENLABS_API_KEY: FAKE_KEY, ELEVENLABS_SPEED: 'fast' }, { fetchFn })!('hello')
    expect(JSON.parse(fetchFn.mock.calls[0][1]!.body as string).voice_settings).toBeUndefined()
  })
  it('ElevenLabs failing falls back to Polly when AWS is set up', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const polly = vi.fn(async () => Buffer.from('polly'))
    const synth = synthFromEnv({ ELEVENLABS_API_KEY: FAKE_KEY, AWS_REGION: 'us-east-1' }, { fetchFn: failing(429), polly })!
    expect((await synth('hello')).toString()).toBe('polly')
    expect(synth.last()).toBe('polly')
  })
  it('only AWS set up: Polly, and ElevenLabs is never called', async () => {
    const fetchFn = ok()
    const polly = vi.fn(async () => Buffer.from('polly'))
    const synth = synthFromEnv({ AWS_REGION: 'us-east-1' }, { fetchFn, polly })!
    expect((await synth('hello')).toString()).toBe('polly')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('health check: says which voice is set up', () => {
  it('reports elevenlabs, polly or browser, and never a key', () => {
    expect(healthFrom({ ELEVENLABS_API_KEY: FAKE_KEY }, 'v').voice).toBe('elevenlabs')
    expect(healthFrom({ AWS_REGION: 'us-east-1' }, 'v').voice).toBe('polly')
    expect(healthFrom({}, 'v').voice).toBe('browser')
    expect(JSON.stringify(healthFrom({ ELEVENLABS_API_KEY: FAKE_KEY, ANTHROPIC_API_KEY: 'k' }, 'v'))).not.toContain(FAKE_KEY)
  })
  it('an ElevenLabs key alone counts as voice being ready', () => {
    const h = healthFrom({ ANTHROPIC_API_KEY: 'k', ELEVENLABS_API_KEY: FAKE_KEY }, 'v')
    expect(h.tts).toBe(true)
    expect(h.ok).toBe(true)
    expect(h.transcribe).toBe('missing') // speech-to-text still needs AWS
  })
})

describe('/api/tts: the reply says which voice really spoke', () => {
  async function post(synth: Parameters<typeof createApp>[1], text: string) {
    const server = createApp(async () => '', synth).listen(0)
    try {
      const { port } = server.address() as AddressInfo
      const res = await fetch(`http://127.0.0.1:${port}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
      return { status: res.status, voice: res.headers.get('x-tts-voice'), buf: Buffer.from(await res.arrayBuffer()) }
    } finally { server.close() }
  }
  it('x-tts-voice names the voice, also for a cached phrase', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let fail = false
    const synth = firstWorking([['elevenlabs', async () => { if (fail) throw new Error('quota'); return Buffer.from('e') }], ['polly', async () => Buffer.from('p')]])
    const app = createApp(async () => '', synth)
    const server = app.listen(0)
    try {
      const { port } = server.address() as AddressInfo
      const say = async (text: string) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
        return res.headers.get('x-tts-voice')
      }
      expect(await say('one')).toBe('elevenlabs')
      fail = true
      expect(await say('two')).toBe('polly')
      expect(await say('one')).toBe('elevenlabs') // from the cache: still the voice that made it
    } finally { server.close() }
  })
  it('a plain synth with no name sends no x-tts-voice header', async () => {
    const r = await post(async () => Buffer.from('x'), 'hello')
    expect(r.status).toBe(200)
    expect(r.voice).toBeNull()
  })
})

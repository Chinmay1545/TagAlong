import express from 'express'
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import { speakMath } from '../src/core/speakMath'
import { TTS_MAX_CHARS } from '../src/core/config'

export type Synth = (text: string) => Promise<Buffer>

const CACHE_MAX = 200

export function ttsRouter(synth: Synth): express.Router {
  const router = express.Router()
  const cache = new Map<string, { audio: Buffer; voice?: string }>() // ponytail: FIFO-capped in-memory; swap for LRU if hit rate matters
  router.post('/api/tts', express.json({ limit: '4kb' }), async (req, res) => {
    const raw = req.body?.text
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (!text || text.length > TTS_MAX_CHARS) {
      res.status(400).json({ error: `text must be a non-empty string of at most ${TTS_MAX_CHARS} characters` })
      return
    }
    try {
      let hit = cache.get(text)
      if (!hit) {
        const audio = await synth(text)
        hit = { audio, voice: (synth as Partial<{ last(): string }>).last?.() } // which voice really spoke, if the synth says
        cache.set(text, hit)
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
      }
      if (hit.voice) res.setHeader('x-tts-voice', hit.voice) // visible in the browser's network tab
      res.type('audio/mpeg').send(hit.audio)
    } catch (e) {
      console.error('tts failed:', e instanceof Error ? e.message : String(e)) // detail stays server-side
      res.status(502).json({ error: 'tts failed' })
    }
  })
  return router
}

export const escapeXml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
export const toSsml = (text: string) => `<speak><prosody rate="115%">${escapeXml(text)}</prosody></speak>`

type PollyLike = { send: (cmd: SynthesizeSpeechCommand) => Promise<{ AudioStream?: { transformToByteArray(): Promise<Uint8Array> } }> }
type PollyOpts = { voiceId?: string; engine?: string; client?: PollyLike }

const UNUSABLE = ['EngineNotSupportedException', 'LanguageNotSupportedException']
const unusable = (e: unknown) => {
  const x = e as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } }
  const st = x?.$metadata?.httpStatusCode ?? 0
  if (UNUSABLE.includes(x?.name ?? '')) return true
  // ValidationException also covers bad text (length, SSML): only engine/voice complaints justify the sticky fallback
  return (x?.name === 'ValidationException' || (st >= 400 && st < 500 && x?.name !== 'ThrottlingException')) && /engine|voice/i.test(x?.message ?? '')
}

let shared: PollyClient | undefined
export function pollySynth(opts: PollyOpts = {}): Synth {
  let voiceId = opts.voiceId ?? (process.env.POLLY_VOICE || 'Ruth')
  let engine = opts.engine ?? (process.env.POLLY_ENGINE || 'generative')
  const request = async (text: string) => {
    const client = opts.client ?? (shared ??= new PollyClient({ region: process.env.AWS_REGION }))
    const spoken = speakMath(text)
    const ssml = engine === 'neural' // generative SSML support is limited: plain text there
    const out = await client.send(new SynthesizeSpeechCommand({
      Text: ssml ? toSsml(spoken) : spoken, TextType: ssml ? 'ssml' : 'text',
      Engine: engine as 'neural', VoiceId: voiceId as 'Joanna', OutputFormat: 'mp3',
    }))
    if (!out.AudioStream) throw new Error('polly returned no audio')
    return Buffer.from(await out.AudioStream.transformToByteArray())
  }
  return async (text) => {
    try { return await request(text) } catch (e) {
      if (!unusable(e) || (engine === 'neural' && voiceId === 'Joanna')) throw e // transient: 502, next call retries
      console.warn(`polly ${engine}/${voiceId} failed, using neural/Joanna:`, e instanceof Error ? e.message : String(e))
      engine = 'neural'; voiceId = 'Joanna' // sticky
      return request(text)
    }
  }
}

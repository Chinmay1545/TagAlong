import { speakMath } from '../src/core/speakMath'
import type { Synth } from './tts'

// ElevenLabs text to speech: one phrase in, MP3 bytes out. The key is only ever sent in the request header;
// it is never logged and never put in an error message.
export const ELEVEN_DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb' // "George", the voice used in ElevenLabs' own examples
export const ELEVEN_DEFAULT_MODEL = 'eleven_multilingual_v2' // the API's default model
const BASE = 'https://api.elevenlabs.io/v1/text-to-speech'
const FORMAT = 'mp3_44100_128' // the page decodes MP3, same as the Polly voice

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>
export type ElevenOpts = { apiKey: string; voiceId?: string; modelId?: string; speed?: number; fetchFn?: FetchFn }

export function elevenLabsSynth({ apiKey, voiceId = ELEVEN_DEFAULT_VOICE, modelId = ELEVEN_DEFAULT_MODEL, speed, fetchFn = fetch }: ElevenOpts): Synth {
  const url = `${BASE}/${encodeURIComponent(voiceId)}?output_format=${FORMAT}`
  return async text => {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text: speakMath(text), model_id: modelId, ...(speed === undefined ? {} : { voice_settings: { speed } }) }),
    })
    if (!res.ok) throw new Error(`elevenlabs answered ${res.status}`) // the status only: the reply body can echo request details
    const audio = Buffer.from(await res.arrayBuffer())
    if (!audio.length) throw new Error('elevenlabs returned no audio')
    return audio
  }
}

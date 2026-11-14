import { elevenLabsSynth } from './elevenlabs'
import { pollySynth, type Synth } from './tts'

// Which service speaks the whispers. ElevenLabs when its key is set, else Polly when AWS is set up, else
// none: the page then falls back to the browser's own voice.
export type Voice = 'elevenlabs' | 'polly' | 'browser'
type Env = Record<string, string | undefined>

// A synth that can also say which voice spoke last (ElevenLabs can fail over to Polly for one phrase).
export type NamedSynth = Synth & { last(): string }

export const voiceFromEnv = (env: Env): Voice =>
  env.ELEVENLABS_API_KEY?.trim() ? 'elevenlabs' : env.AWS_REGION ? 'polly' : 'browser'

// Tries each voice in order for every phrase. A failure costs that phrase one extra call and nothing more:
// the first voice is tried again next time, so a brief outage does not leave the demo on the fallback voice.
export function firstWorking(voices: [name: string, synth: Synth][]): NamedSynth {
  let last = voices[0]?.[0] ?? ''
  const synth = async (text: string) => {
    let error: unknown = new Error('no voice configured')
    for (const [name, speak] of voices) {
      try {
        const audio = await speak(text)
        last = name
        return audio
      } catch (e) {
        error = e
        console.warn(`voice ${name} failed:`, e instanceof Error ? e.message : String(e))
      }
    }
    throw error
  }
  return Object.assign(synth, { last: () => last })
}

type Parts = { fetchFn?: Parameters<typeof elevenLabsSynth>[0]['fetchFn']; polly?: Synth } // for tests

export function synthFromEnv(env: Env, parts: Parts = {}): NamedSynth | undefined {
  const voices: [string, Synth][] = []
  const key = env.ELEVENLABS_API_KEY?.trim()
  if (key) {
    const speed = Number(env.ELEVENLABS_SPEED)
    voices.push(['elevenlabs', elevenLabsSynth({
      apiKey: key,
      voiceId: env.ELEVENLABS_VOICE_ID?.trim() || undefined,
      modelId: env.ELEVENLABS_MODEL_ID?.trim() || undefined,
      speed: env.ELEVENLABS_SPEED && Number.isFinite(speed) && speed > 0 ? speed : undefined,
      fetchFn: parts.fetchFn,
    })])
  }
  if (env.AWS_REGION) voices.push(['polly', parts.polly ?? pollySynth()])
  return voices.length ? firstWorking(voices) : undefined
}

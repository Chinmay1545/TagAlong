import { pickProvider } from './anthropic'
import { voiceFromEnv, type Voice } from './voice'

type P = 'anthropic' | 'bedrock' | 'missing'
export type Health = { ok: boolean; board: P; tts: boolean; voice: Voice; notes: boolean; transcribe: 'configured' | 'missing'; share: boolean; provider: { board: P; notes: P }; version: string }

// Env presence only. Never returns a value from env.
export function healthFrom(env: Record<string, string | undefined>, version: string): Health {
  const anth = pickProvider(env) === 'anthropic'
  const aws = Boolean(env.AWS_REGION) // Polly, Transcribe and Bedrock all need it
  const voice = voiceFromEnv(env) // which service speaks; 'browser' means none is set up
  const tts = voice !== 'browser'
  const board: P = anth ? (env.ANTHROPIC_API_KEY?.trim() ? 'anthropic' : 'missing') : env.BOARD_MODEL_ID ? 'bedrock' : 'missing'
  const notes: P = anth ? board : aws ? 'bedrock' : 'missing'
  return { ok: board !== 'missing' && tts, board, tts, voice, notes: notes !== 'missing', transcribe: aws ? 'configured' : 'missing', share: Boolean(env.NOTES_BUCKET), provider: { board, notes }, version }
}

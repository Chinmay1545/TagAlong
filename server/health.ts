import { pickProvider } from './anthropic'

type P = 'anthropic' | 'bedrock' | 'missing'
export type Health = { ok: boolean; board: P; tts: boolean; notes: boolean; transcribe: 'configured' | 'missing'; share: boolean; provider: { board: P; notes: P }; version: string }

// Env presence only. Never returns a value from env.
export function healthFrom(env: Record<string, string | undefined>, version: string): Health {
  const anth = pickProvider(env) === 'anthropic'
  const tts = Boolean(env.AWS_REGION)
  const board: P = anth ? (env.ANTHROPIC_API_KEY?.trim() ? 'anthropic' : 'missing') : env.BOARD_MODEL_ID ? 'bedrock' : 'missing'
  const notes: P = anth ? board : tts ? 'bedrock' : 'missing'
  return { ok: board !== 'missing' && tts, board, tts, notes: notes !== 'missing', transcribe: tts ? 'configured' : 'missing', share: Boolean(env.NOTES_BUCKET), provider: { board, notes }, version }
}

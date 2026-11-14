import Anthropic from '@anthropic-ai/sdk'
import { BOARD_PROMPT } from './prompt'

// Fallback board reader on the Anthropic API, used when ANTHROPIC_API_KEY is set
// (Bedrock quota is 0 on the team account). Off the live path: the resolver never calls this.
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5'

type MessagesClient = {
  messages: { create: (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> }
}

export function pickProvider(env: Record<string, string | undefined>): 'anthropic' | 'bedrock' {
  if (env.MODEL_PROVIDER === 'bedrock' || env.MODEL_PROVIDER === 'anthropic') return env.MODEL_PROVIDER
  return env.ANTHROPIC_API_KEY?.trim() ? 'anthropic' : 'bedrock'
}

// Shared by the board reader and the notes caller: one call, readable errors, refusal/truncation checks.
async function createText(client: MessagesClient, params: Anthropic.MessageCreateParamsNonStreaming, what: string): Promise<string> {
  let res: Anthropic.Message
  try {
    res = await client.messages.create(params)
  } catch (e) {
    // Most specific first. SDK messages never include the key.
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Anthropic rejected the key (check ANTHROPIC_API_KEY in .env)')
    if (e instanceof Anthropic.RateLimitError) throw new Error('Anthropic rate limit hit, retry shortly')
    if (e instanceof Anthropic.APIConnectionError) throw new Error(`could not reach Anthropic: ${e.message}`)
    if (e instanceof Anthropic.APIError) throw new Error(`Anthropic API error ${e.status}: ${e.message}`)
    throw e
  }
  if (res.stop_reason === 'refusal') throw new Error(`model refused to ${what}`)
  if (res.stop_reason === 'max_tokens') throw new Error('model reply truncated (max_tokens)')
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  if (!text.trim()) throw new Error('model returned no text')
  return text
}

// Board reads are latency-bound. Low effort means less thinking before the first line; fast mode
// (premium price) writes the reply faster. Together they took the first box from ~5.5 s to ~1 s.
export type BoardEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type BoardTuning = { effort: BoardEffort; speed: 'fast' | 'standard' }
export const DEFAULT_BOARD_TUNING: BoardTuning = { effort: 'low', speed: 'fast' }
const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']
const FAST_MODE_MODELS = new Set(['claude-opus-5-5']) // fast mode is a per-model feature; others 400 on `speed`

export function boardTuningFromEnv(env: Record<string, string | undefined>): BoardTuning {
  const effort = env.ANTHROPIC_BOARD_EFFORT?.trim() ?? ''
  const speed = env.ANTHROPIC_BOARD_SPEED?.trim() ?? ''
  return {
    effort: EFFORTS.includes(effort) ? effort as BoardEffort : DEFAULT_BOARD_TUNING.effort,
    speed: speed === 'fast' || speed === 'standard' ? speed : DEFAULT_BOARD_TUNING.speed,
  }
}

const boardParams = (model: string, jpeg: Buffer, tuning: BoardTuning): Anthropic.MessageCreateParamsNonStreaming => ({
  model,
  max_tokens: 16000,
  output_config: { effort: tuning.effort },
  ...(tuning.speed === 'fast' && FAST_MODE_MODELS.has(model) ? { speed: 'fast' as const } : {}),
  messages: [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
      { type: 'text', text: BOARD_PROMPT },
    ],
  }],
})

// Fast mode has its own rate limit: on a 429 there, retry once at standard speed instead of failing the read.
const isFast = (p: Anthropic.MessageCreateParamsNonStreaming) => 'speed' in p
const standardSpeed = (p: Anthropic.MessageCreateParamsNonStreaming): Anthropic.MessageCreateParamsNonStreaming => {
  const { speed: _speed, ...rest } = p as Anthropic.MessageCreateParamsNonStreaming & { speed?: string }
  return rest
}

export function makeAnthropicCallModel(client: MessagesClient, model = ANTHROPIC_DEFAULT_MODEL, tuning: BoardTuning = DEFAULT_BOARD_TUNING) {
  const withFallback: MessagesClient = {
    messages: {
      create: async (p) => {
        try { return await client.messages.create(p) } catch (e) {
          if (isFast(p) && e instanceof Anthropic.RateLimitError) return client.messages.create(standardSpeed(p))
          throw e
        }
      },
    },
  }
  return (jpeg: Buffer): Promise<string> => createText(withFallback, boardParams(model, jpeg, tuning), 'read the board')
}

// Same SDK error mapping as createText, for errors thrown while streaming.
function readable(e: unknown): unknown {
  if (e instanceof Anthropic.AuthenticationError) return new Error('Anthropic rejected the key (check ANTHROPIC_API_KEY in .env)')
  if (e instanceof Anthropic.RateLimitError) return new Error('Anthropic rate limit hit, retry shortly')
  if (e instanceof Anthropic.APIConnectionError) return new Error(`could not reach Anthropic: ${e.message}`)
  if (e instanceof Anthropic.APIError) return new Error(`Anthropic API error ${e.status}: ${e.message}`)
  return e
}

type StreamClient = {
  messages: { stream: (p: Anthropic.MessageCreateParamsNonStreaming) => AsyncIterable<Anthropic.MessageStreamEvent> & { finalMessage(): Promise<{ stop_reason: string | null }> } }
}

// Streaming board reader: yields the reply text as it is generated, so terms can be drawn before the reply ends.
export function makeAnthropicStreamModel(client: StreamClient, model = ANTHROPIC_DEFAULT_MODEL, tuning: BoardTuning = DEFAULT_BOARD_TUNING) {
  return async function* (jpeg: Buffer): AsyncGenerator<string> {
    try {
      let params = boardParams(model, jpeg, tuning)
      let stream = client.messages.stream(params)
      let sent = false
      for (;;) {
        try {
          for await (const ev of stream) {
            if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') { sent = true; yield ev.delta.text }
          }
          break
        } catch (e) {
          // Retry at standard speed only if nothing was shown yet, so no term is drawn twice.
          if (sent || !isFast(params) || !(e instanceof Anthropic.RateLimitError)) throw e
          params = standardSpeed(params)
          stream = client.messages.stream(params)
        }
      }
      const final = await stream.finalMessage()
      if (final.stop_reason === 'refusal') throw new Error('model refused to read the board')
      if (final.stop_reason === 'max_tokens') throw new Error('model reply truncated (max_tokens)')
    } catch (e) { throw readable(e) }
  }
}

export function anthropicStreamModelFromEnv(env: Record<string, string | undefined>) {
  let client: Anthropic | undefined
  const model = env.ANTHROPIC_MODEL_ID?.trim() || ANTHROPIC_DEFAULT_MODEL
  const tuning = boardTuningFromEnv(env)
  return (jpeg: Buffer) => {
    client ??= new Anthropic({ timeout: 30_000, maxRetries: 1 })
    return makeAnthropicStreamModel(client as unknown as StreamClient, model, tuning)(jpeg)
  }
}

export const ANTHROPIC_NOTES_DEFAULT_MODEL = 'claude-haiku-5-5'

export function makeAnthropicCallText(client: MessagesClient, model = ANTHROPIC_NOTES_DEFAULT_MODEL) {
  return (prompt: string): Promise<string> => createText(client, {
    model,
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  }, 'write the notes')
}

export function anthropicCallTextFromEnv(env: Record<string, string | undefined>) {
  let client: Anthropic | undefined
  const model = env.ANTHROPIC_NOTES_MODEL_ID?.trim() || ANTHROPIC_NOTES_DEFAULT_MODEL
  return (prompt: string) => {
    client ??= new Anthropic({ timeout: 90_000, maxRetries: 1 })
    return makeAnthropicCallText(client, model)(prompt)
  }
}

export function anthropicCallModelFromEnv(env: Record<string, string | undefined>) {
  // Client created lazily so startup never needs a key; timeout keeps a stuck read from blocking the board loop forever.
  let client: Anthropic | undefined
  const model = env.ANTHROPIC_MODEL_ID?.trim() || ANTHROPIC_DEFAULT_MODEL
  const tuning = boardTuningFromEnv(env)
  return (jpeg: Buffer) => {
    client ??= new Anthropic({ timeout: 30_000, maxRetries: 1 })
    return makeAnthropicCallModel(client, model, tuning)(jpeg)
  }
}

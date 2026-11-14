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

export function makeAnthropicCallModel(client: MessagesClient, model = ANTHROPIC_DEFAULT_MODEL) {
  return (jpeg: Buffer): Promise<string> => createText(client, {
    model,
    max_tokens: 16000,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
        { type: 'text', text: BOARD_PROMPT },
      ],
    }],
  }, 'read the board')
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
  // Client created lazily so startup never needs a key; timeout keeps a stuck read from blocking the 3 s board loop forever.
  let client: Anthropic | undefined
  const model = env.ANTHROPIC_MODEL_ID?.trim() || ANTHROPIC_DEFAULT_MODEL
  return (jpeg: Buffer) => {
    client ??= new Anthropic({ timeout: 30_000, maxRetries: 1 })
    return makeAnthropicCallModel(client, model)(jpeg)
  }
}

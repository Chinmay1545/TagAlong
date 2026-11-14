import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime'
import { BOARD_PROMPT } from './prompt'

export const NOTES_DEFAULT_MODEL = 'us.amazon.nova-micro-v1:0'
export const BEDROCK_QUOTA_MESSAGE = 'Bedrock quota is 0 on this account — request a quota increase or use the event\'s AWS account'

type Sender = { send: (cmd: ConverseCommand) => Promise<{ output?: { message?: { content?: { text?: string }[] } } }> }

async function converse(client: Sender, modelId: string, content: any[], what: string): Promise<string> {
  let out
  try {
    out = await client.send(new ConverseCommand({ modelId, messages: [{ role: 'user', content }], inferenceConfig: { maxTokens: 1000, temperature: 0 } }))
  } catch (e) {
    if ((e as Error)?.name === 'ThrottlingException') throw new Error(`${what} is rate limited (Bedrock throttled the call; the quota may be 0)`)
    throw e
  }
  const t = out.output?.message?.content?.find((c) => typeof c.text === 'string')?.text
  if (!t) throw new Error('model returned no text')
  return t
}

export const makeBedrockCallModel = (client: Sender, modelId: string) => (jpeg: Buffer) =>
  converse(client, modelId, [{ image: { format: 'jpeg', source: { bytes: jpeg } } }, { text: BOARD_PROMPT }], 'board reader')

type StreamSender = { send: (cmd: ConverseStreamCommand) => Promise<{ stream?: AsyncIterable<{ contentBlockDelta?: { delta?: { text?: string } } }> }> }

// Streaming board reader: yields reply text as Bedrock generates it.
export const makeBedrockStreamModel = (client: StreamSender, modelId: string) => async function* (jpeg: Buffer): AsyncGenerator<string> {
  let out
  try {
    out = await client.send(new ConverseStreamCommand({ modelId, messages: [{ role: 'user', content: [{ image: { format: 'jpeg', source: { bytes: jpeg } } }, { text: BOARD_PROMPT }] }], inferenceConfig: { maxTokens: 1000, temperature: 0 } }))
  } catch (e) {
    if ((e as Error)?.name === 'ThrottlingException') throw new Error('board reader is rate limited (Bedrock throttled the call; the quota may be 0)')
    throw e
  }
  for await (const ev of out.stream ?? []) {
    const t = ev.contentBlockDelta?.delta?.text
    if (t) yield t
  }
}

export const makeBedrockCallText =(client: Sender, modelId: string) => (prompt: string) =>
  converse(client, modelId, [{ text: prompt }], 'notes writer')

// Client created lazily so startup never needs credentials.
let shared: BedrockRuntimeClient | undefined
const client = () => (shared ??= new BedrockRuntimeClient({ region: process.env.AWS_REGION }))

export function bedrockCallModelFromEnv(env: Record<string, string | undefined>) {
  return (jpeg: Buffer) => {
    if (!env.BOARD_MODEL_ID) throw new Error('BOARD_MODEL_ID is not set (add it to .env)')
    return makeBedrockCallModel(client(), env.BOARD_MODEL_ID)(jpeg)
  }
}
export function bedrockStreamModelFromEnv(env: Record<string, string | undefined>) {
  return (jpeg: Buffer) => {
    if (!env.BOARD_MODEL_ID) throw new Error('BOARD_MODEL_ID is not set (add it to .env)')
    return makeBedrockStreamModel(client() as unknown as StreamSender, env.BOARD_MODEL_ID)(jpeg)
  }
}
export function bedrockCallTextFromEnv(env: Record<string, string | undefined>) {
  const id = env.NOTES_MODEL_ID?.trim() || NOTES_DEFAULT_MODEL
  return (prompt: string) => makeBedrockCallText(client(), id)(prompt)
}

import { describe, it, expect } from 'vitest'
import { makeBedrockCallModel, makeBedrockCallText, NOTES_DEFAULT_MODEL, BEDROCK_QUOTA_MESSAGE } from '../server/bedrock'
import { BOARD_PROMPT } from '../server/prompt'

const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9])
const fake = (reply: unknown): { calls: any[]; client: any } => {
  const calls: any[] = []
  return { calls, client: { send: async (cmd: any) => { calls.push(cmd.input); if (reply instanceof Error) throw reply; return reply } } }
}
const text = (t: string) => ({ output: { message: { content: [{ text: t }] } } })

describe('bedrock board reader', () => {
  it('sends the jpeg then the board prompt', async () => {
    const { client, calls } = fake(text('{"terms":[]}'))
    expect(await makeBedrockCallModel(client, 'board-m')(jpeg)).toBe('{"terms":[]}')
    expect(calls[0].modelId).toBe('board-m')
    const c = calls[0].messages[0].content
    expect(c[0].image.format).toBe('jpeg')
    expect(c[0].image.source.bytes).toEqual(jpeg)
    expect(c[1].text).toBe(BOARD_PROMPT)
  })
  it('maps throttling to a readable rate-limit error', async () => {
    const e = Object.assign(new Error('Too many tokens'), { name: 'ThrottlingException' })
    await expect(makeBedrockCallModel(fake(e).client, 'm')(jpeg)).rejects.toThrow(/board reader is rate limited/)
  })
  it('errors when the one-shot reply was cut off at max tokens', async () => {
    const out = { ...text('x|100|200|50|5'), stopReason: 'max_tokens' }
    await expect(makeBedrockCallModel(fake(out).client, 'm')(jpeg)).rejects.toThrow(/truncated/)
  })
  it('errors on empty reply', async () => {
    await expect(makeBedrockCallModel(fake({ output: {} }).client, 'm')(jpeg)).rejects.toThrow(/no text/)
  })
})

describe('bedrock notes', () => {
  it('text converse with prompt; default model is nova micro', async () => {
    expect(NOTES_DEFAULT_MODEL).toBe('us.amazon.nova-micro-v1:0')
    const { client, calls } = fake(text('{"rewrite":[]}'))
    await makeBedrockCallText(client, NOTES_DEFAULT_MODEL)('hello')
    expect(calls[0].modelId).toBe(NOTES_DEFAULT_MODEL)
    expect(calls[0].messages[0].content).toEqual([{ text: 'hello' }])
  })
  it('exports the quota message', () => {
    expect(BEDROCK_QUOTA_MESSAGE).toBe('Bedrock quota is 0 on this account — request a quota increase or use the event\'s AWS account')
  })
})

import { describe, it, expect } from 'vitest'
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/index'
import { SCENE_PROMPT, cleanAnswer, NO_ANSWER } from '../server/describe'
import { makeAnthropicDescribe } from '../server/anthropic'
import { makeBedrockDescribe, DESCRIBE_DEFAULT_MODEL } from '../server/bedrock'

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])

async function post(describeFn: ((j: Buffer) => Promise<string>) | undefined, body: Buffer) {
  const server = createApp(async () => '', undefined, undefined, { describe: describeFn }).listen(0)
  try {
    const { port } = server.address() as AddressInfo
    const res = await fetch(`http://127.0.0.1:${port}/api/describe`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array(body) })
    return { status: res.status, json: await res.json() as any }
  } finally { server.close() }
}

describe('cleanAnswer: what the student hears', () => {
  it('trims and strips markdown and wrapping quotes', () => {
    expect(cleanAnswer('  **"Students are packing up."**  ')).toBe('Students are packing up.')
  })
  it('joins lines into one spoken answer', () => {
    expect(cleanAnswer('- The teacher is erasing the board.\n- Students are standing up.')).toBe('The teacher is erasing the board. Students are standing up.')
  })
  it('keeps at most two sentences', () => {
    expect(cleanAnswer('One. Two. Three.')).toBe('One. Two.')
  })
  it('an empty reply becomes a plain "could not tell"', () => {
    expect(cleanAnswer('  \n ')).toBe(NO_ANSWER)
  })
})

describe('SCENE_PROMPT', () => {
  it('asks for short, spatial, private answers', () => {
    expect(SCENE_PROMPT).toMatch(/blind student/)
    expect(SCENE_PROMPT).toMatch(/two short sentences/i)
    expect(SCENE_PROMPT).toMatch(/never identify/i)
  })
})

describe('POST /api/describe', () => {
  it('sends the frame to the model and returns the cleaned answer', async () => {
    let got: Buffer | undefined
    const r = await post(async j => { got = j; return '**Students are leaving.**' }, jpeg)
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ text: 'Students are leaving.' })
    expect(got).toEqual(jpeg)
  })
  it('400 on an empty body', async () => {
    expect((await post(async () => 'x', Buffer.alloc(0))).status).toBe(400)
  })
  it('502 with a generic error when the model fails', async () => {
    const r = await post(async () => { throw new Error('secret detail') }, jpeg)
    expect(r.status).toBe(502)
    expect(r.json).toEqual({ error: 'describe failed' })
  })
  it('503 when no describer is configured', async () => {
    expect((await post(undefined, jpeg)).status).toBe(503)
  })
})

describe('describe model calls', () => {
  it('anthropic: one image plus the scene prompt, Haiku by default', async () => {
    let params: any
    const client = { messages: { create: async (p: any) => { params = p; return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'A quiet room.' }] } as any } } }
    expect(await makeAnthropicDescribe(client)(jpeg)).toBe('A quiet room.')
    expect(params.model).toBe('claude-haiku-5-5')
    const content = params.messages[0].content
    expect(content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } })
    expect(content[1]).toEqual({ type: 'text', text: SCENE_PROMPT })
  })
  it('bedrock: one image plus the scene prompt, a vision model by default', async () => {
    let cmd: any
    const client = { send: async (c: any) => { cmd = c; return { output: { message: { content: [{ text: 'A quiet room.' }] } } } } }
    expect(await makeBedrockDescribe(client)(jpeg)).toBe('A quiet room.')
    expect(DESCRIBE_DEFAULT_MODEL).toBe('us.amazon.nova-lite-v1:0')
    expect(cmd.input.modelId).toBe(DESCRIBE_DEFAULT_MODEL)
    expect(cmd.input.messages[0].content).toEqual([{ image: { format: 'jpeg', source: { bytes: jpeg } } }, { text: SCENE_PROMPT }])
  })
})

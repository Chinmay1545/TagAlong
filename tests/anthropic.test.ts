import { describe, it, expect } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { makeAnthropicCallModel, pickProvider, ANTHROPIC_DEFAULT_MODEL } from '../server/anthropic'
import { BOARD_PROMPT } from '../server/prompt'
import { createApp } from '../server/index'

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
const ok = '{"terms":[{"latex":"2x","phrase":"the 2x on top","box":{"x":0.2,"y":0.2,"w":0.1,"h":0.1}}]}'

function msg(content: unknown[], stop_reason = 'end_turn') {
  return { id: 'm', type: 'message', role: 'assistant', model: 'x', content, stop_reason, stop_sequence: null, usage: {} } as unknown as Anthropic.Message
}
function fakeClient(reply: Anthropic.Message | Error) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = []
  const client = {
    messages: {
      create: async (p: Anthropic.MessageCreateParamsNonStreaming) => {
        calls.push(p)
        if (reply instanceof Error) throw reply
        return reply
      },
    },
  }
  return { client, calls }
}

describe('anthropic board reader', () => {
  it('sends the jpeg as base64 image before the exact board prompt', async () => {
    const { client, calls } = fakeClient(msg([{ type: 'text', text: ok }]))
    await makeAnthropicCallModel(client)(jpeg)
    expect(calls).toHaveLength(1)
    const p = calls[0]
    expect(p.model).toBe(ANTHROPIC_DEFAULT_MODEL)
    expect(p.max_tokens).toBeGreaterThanOrEqual(4000)
    expect(p).not.toHaveProperty('temperature')           // sampling params 400 on current models
    expect(p).not.toHaveProperty('thinking')               // disabled thinking 400s on Opus 5.5
    expect(p.messages).toHaveLength(1)
    const content = p.messages[0].content as Anthropic.ContentBlockParam[]
    expect(p.messages[0].role).toBe('user')
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } })
    expect(content[1]).toEqual({ type: 'text', text: BOARD_PROMPT })
  })

  it('uses the model override when given', async () => {
    const { client, calls } = fakeClient(msg([{ type: 'text', text: ok }]))
    await makeAnthropicCallModel(client, 'claude-haiku-5-5')(jpeg)
    expect(calls[0].model).toBe('claude-haiku-5-5')
  })

  it('returns the text, skipping thinking blocks and joining split text blocks', async () => {
    const { client } = fakeClient(msg([
      { type: 'thinking', thinking: '', signature: 's' },
      { type: 'text', text: '{"terms":[' },
      { type: 'text', text: ']}' },
    ]))
    expect(await makeAnthropicCallModel(client)(jpeg)).toBe('{"terms":[]}')
  })

  it('throws a readable error on refusal', async () => {
    const { client } = fakeClient(msg([], 'refusal'))
    await expect(makeAnthropicCallModel(client)(jpeg)).rejects.toThrow(/refused/i)
  })

  it('throws when the reply was truncated by max_tokens', async () => {
    const { client } = fakeClient(msg([{ type: 'text', text: '{"terms":[{"lat' }], 'max_tokens'))
    await expect(makeAnthropicCallModel(client)(jpeg)).rejects.toThrow(/truncated/i)
  })

  it('throws when the reply has no text', async () => {
    const { client } = fakeClient(msg([{ type: 'thinking', thinking: '', signature: 's' }]))
    await expect(makeAnthropicCallModel(client)(jpeg)).rejects.toThrow(/no text/i)
  })

  it('maps auth, rate limit and other API errors to readable messages without the key', async () => {
    const key = 'sk-ant-secret-should-never-appear'
    const cases: [number, RegExp][] = [
      [401, /ANTHROPIC_API_KEY/],
      [429, /rate limit/i],
      [529, /Anthropic API error 529/],
    ]
    for (const [status, re] of cases) {
      const err = Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message: 'boom' } }, 'boom', new Headers())
      const { client } = fakeClient(err)
      const p = makeAnthropicCallModel(client)(jpeg)
      await expect(p).rejects.toThrow(re)
      await p.catch((e: Error) => expect(e.message).not.toContain(key))
    }
  })

  it('maps connection failures to a readable message', async () => {
    const { client } = fakeClient(new Anthropic.APIConnectionError({ message: 'socket hang up' }))
    await expect(makeAnthropicCallModel(client)(jpeg)).rejects.toThrow(/could not reach Anthropic/i)
  })
})

describe('pickProvider', () => {
  it('prefers Anthropic when ANTHROPIC_API_KEY is set, else Bedrock', () => {
    expect(pickProvider({ ANTHROPIC_API_KEY: 'k' })).toBe('anthropic')
    expect(pickProvider({ ANTHROPIC_API_KEY: '  ' })).toBe('bedrock')
    expect(pickProvider({ ANTHROPIC_API_KEY: '' })).toBe('bedrock')
    expect(pickProvider({})).toBe('bedrock')
  })
})

describe('endpoint with the Anthropic reader', () => {
  it('returns parsed terms from a realistic fenced reply', async () => {
    const fixture = JSON.parse(readFileSync('public/fixtures/board-fraction.json', 'utf8'))
    const reply = '```json\n' + JSON.stringify({ terms: fixture.terms.map(({ id: _id, ...t }: { id: number }) => t) }) + '\n```'
    const { client } = fakeClient(msg([{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: reply }]))
    const server = createApp(makeAnthropicCallModel(client)).listen(0)
    try {
      const port = (server.address() as { port: number }).port
      const r = await fetch(`http://localhost:${port}/api/read-board`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg })
      expect(r.status).toBe(200)
      const body = await r.json()
      expect(body.terms).toEqual(fixture.terms)
    } finally {
      server.close()
    }
  })

  it('returns 502 with the readable error when the reader fails', async () => {
    const { client } = fakeClient(msg([], 'refusal'))
    const server = createApp(makeAnthropicCallModel(client)).listen(0)
    try {
      const port = (server.address() as { port: number }).port
      const r = await fetch(`http://localhost:${port}/api/read-board`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg })
      expect(r.status).toBe(502)
      expect((await r.json()).error).toBe("board read failed")
    } finally {
      server.close()
    }
  })
})

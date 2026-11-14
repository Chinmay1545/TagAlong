import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { createTermStream } from '../server/boardStream'
import { parseBoardResponse } from '../server/parseBoard'
import { makeAnthropicStreamModel } from '../server/anthropic'
import { makeBedrockStreamModel } from '../server/bedrock'
import { BOARD_PROMPT } from '../server/prompt'
import { createApp } from '../server/index'

const fixture = JSON.parse(readFileSync('public/fixtures/board-fraction.json', 'utf8'))
const reply = '```json\n' + JSON.stringify({ terms: fixture.terms.map(({ id: _id, ...t }: { id: number }) => t) }, null, 1) + '\n```'
const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9])

// Feed `text` in pieces of `size` characters; collect what each push emits.
function feed(text: string, size: number) {
  const s = createTermStream()
  const emitted: { at: number; latex: string }[] = []
  for (let i = 0; i < text.length; i += size) for (const t of s.push(text.slice(i, i + size))) emitted.push({ at: i + size, latex: t.latex })
  const rest = s.end()
  return { emitted, rest, all: [...emitted.map(e => e.latex), ...rest.map(t => t.latex)] }
}

describe('createTermStream (JSON reply)', () => {
  it('emits each term as soon as its object closes, whatever the chunk size', () => {
    for (const size of [1, 3, 7, 50, reply.length]) {
      const { all } = feed(reply, size)
      expect(all).toEqual(['2x', '(x + 3)', '2x'])
    }
  })
  it('emits the first term before the reply is complete', () => {
    const { emitted } = feed(reply, 5)
    expect(emitted[0].latex).toBe('2x')
    expect(emitted[0].at).toBeLessThan(reply.length / 2)
  })
  it('streamed terms equal the one-shot parser output (ids, phrases, boxes)', () => {
    const s = createTermStream()
    const got = [...s.push(reply.slice(0, 100)), ...s.push(reply.slice(100)), ...s.end()]
    expect(got).toEqual(parseBoardResponse(reply))
    expect(got).toEqual(fixture.terms)
  })
  it('braces inside strings do not confuse it', () => {
    const text = '{"terms":[{"latex":"\\\\frac{a}{b}","phrase":"the a over b \\"}\\"","box":{"x":0.1,"y":0.1,"w":0.1,"h":0.1}}]}'
    const s = createTermStream()
    const got = [...s.push(text), ...s.end()]
    expect(got).toHaveLength(1)
    expect(got[0].latex).toBe('\\frac{a}{b}')
  })
  it('skips invalid terms without breaking numbering', () => {
    const text = '{"terms":[{"latex":"a","phrase":"p","box":{"x":0.1,"y":0.1,"w":0.1,"h":0.1}},{"latex":"bad"},{"latex":"c","phrase":"q","box":{"x":0.5,"y":0.1,"w":0.1,"h":0.1}}]}'
    const s = createTermStream()
    expect([...s.push(text), ...s.end()].map(t => [t.id, t.latex])).toEqual([[1, 'a'], [2, 'c']])
  })
  it('garbage or an empty board yields nothing', () => {
    for (const text of ['', 'not json', '{"terms":[]}', '{broken']) {
      const s = createTermStream()
      expect([...s.push(text), ...s.end()]).toEqual([])
    }
  })
})

describe('createTermStream (compact line reply)', () => {
  const lines = '2x|237|211|95|150\n\\frac{a}{b}|439|211|231|153\n2x|439|560|96|149'
  it('emits each line once it is complete; the last line on end()', () => {
    const s = createTermStream()
    expect(s.push('2x|237|211|9')).toEqual([])
    expect(s.push('5|150\n\\frac{a}{b}|439').map(t => t.latex)).toEqual(['2x'])
    expect(s.push(lines.slice(lines.indexOf('|439|211')))).toHaveLength(1)
    const rest = s.end()
    expect(rest.map(t => [t.id, t.latex])).toEqual([[3, '2x']])
  })
  it('matches the one-shot parser for any chunk size', () => {
    for (const size of [1, 4, 13, lines.length]) {
      const s = createTermStream()
      const got = []
      for (let i = 0; i < lines.length; i += size) got.push(...s.push(lines.slice(i, i + size)))
      got.push(...s.end())
      expect(got).toEqual(parseBoardResponse(lines))
    }
  })
})

// Fake streaming model: yields `parts` with an await between them.
const streamOf = (parts: string[], failAfter?: number) => async function* () {
  for (let i = 0; i < parts.length; i++) {
    if (failAfter !== undefined && i === failAfter) throw new Error('model blew up: secret detail')
    await new Promise(r => setTimeout(r, 5))
    yield parts[i]
  }
}

async function postStream(app: ReturnType<typeof createApp>, accept?: string) {
  const server = app.listen(0)
  try {
    const { port } = server.address() as AddressInfo
    const res = await fetch(`http://127.0.0.1:${port}/api/read-board`, {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg', ...(accept ? { Accept: accept } : {}) }, body: new Uint8Array(jpeg),
    })
    return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() }
  } finally { server.close() }
}

const chunks = (s: string, n: number) => Array.from({ length: Math.ceil(s.length / n) }, (_, i) => s.slice(i * n, i * n + n))

describe('POST /api/read-board streaming (NDJSON)', () => {
  it('streams one term per line, then done', async () => {
    const app = createApp(async () => { throw new Error('unused') }, undefined, undefined, { streamModel: streamOf(chunks(reply, 40)) })
    const r = await postStream(app, 'application/x-ndjson, application/json')
    expect(r.status).toBe(200)
    expect(r.type).toContain('application/x-ndjson')
    const lines = r.text.trim().split('\n').map(l => JSON.parse(l))
    expect(lines.slice(0, 3)).toEqual(fixture.terms.map((term: unknown) => ({ type: 'term', term })))
    expect(lines[3]).toMatchObject({ type: 'done', count: 3 })
    expect(typeof lines[3].ms).toBe('number')
  })
  it('a model error after some terms ends with a generic error line', async () => {
    const parts = chunks(reply, 40)
    const app = createApp(async () => '', undefined, undefined, { streamModel: streamOf(parts, parts.length - 2) })
    const r = await postStream(app, 'application/x-ndjson')
    const lines = r.text.trim().split('\n').map(l => JSON.parse(l))
    expect(lines.at(-1)).toEqual({ type: 'error', error: 'board read failed' })
    expect(lines.some(l => l.type === 'done')).toBe(false)
    expect(r.text).not.toContain('secret detail')
  })
  it('without a stream model, streaming falls back to the one-shot call', async () => {
    const app = createApp(async () => reply)
    const lines = (await postStream(app, 'application/x-ndjson')).text.trim().split('\n').map(l => JSON.parse(l))
    expect(lines.map(l => l.type)).toEqual(['term', 'term', 'term', 'done'])
  })
  it('a plain JSON request still gets the old reply, even with a stream model', async () => {
    const app = createApp(async () => reply, undefined, undefined, { streamModel: streamOf(chunks(reply, 40)) })
    const r = await postStream(app)
    expect(r.type).toContain('application/json')
    expect(JSON.parse(r.text).terms).toEqual(fixture.terms)
  })
})

describe('provider stream adapters', () => {
  it('anthropic: yields text deltas from messages.stream and checks the stop reason', async () => {
    const calls: any[] = []
    const events = [
      { type: 'message_start' },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '{"terms":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '[]}' } },
    ]
    const client = { messages: { stream: (p: any) => { calls.push(p); return { async *[Symbol.asyncIterator]() { yield* events }, finalMessage: async () => ({ stop_reason: 'end_turn' }) } } } }
    const out: string[] = []
    for await (const t of makeAnthropicStreamModel(client as any, 'm')(jpeg)) out.push(t)
    expect(out).toEqual(['{"terms":', '[]}'])
    expect(calls[0].model).toBe('m')
    expect(calls[0].messages[0].content[1]).toEqual({ type: 'text', text: BOARD_PROMPT })
  })
  it('anthropic: a refusal ends the stream with an error', async () => {
    const client = { messages: { stream: () => ({ async *[Symbol.asyncIterator]() {}, finalMessage: async () => ({ stop_reason: 'refusal' }) }) } }
    const it = makeAnthropicStreamModel(client as any, 'm')(jpeg)
    await expect((async () => { for await (const _ of it) { /* drain */ } })()).rejects.toThrow(/refused/)
  })
  it('bedrock: yields contentBlockDelta text from ConverseStream', async () => {
    const calls: any[] = []
    const client = { send: async (cmd: any) => { calls.push(cmd.input); return { stream: (async function* () { yield { messageStart: {} }; yield { contentBlockDelta: { delta: { text: 'a' } } }; yield { contentBlockDelta: { delta: { text: 'b' } } } })() } } }
    const out: string[] = []
    for await (const t of makeBedrockStreamModel(client, 'board-m')(jpeg)) out.push(t)
    expect(out).toEqual(['a', 'b'])
    expect(calls[0].modelId).toBe('board-m')
    expect(calls[0].messages[0].content[1].text).toBe(BOARD_PROMPT)
  })
})

import { describe, it, expect } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { makeAnthropicCallModel, makeAnthropicStreamModel, boardTuningFromEnv, ANTHROPIC_DEFAULT_MODEL } from '../server/anthropic'

// Board reads are latency-bound: low effort (less thinking before the first line) and fast mode
// (faster output) took the first box from ~5.5 s to ~1 s on the library whiteboard photos.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
const reply = { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: '2x|1|2|3|4' }], stop_reason: 'end_turn', stop_sequence: null, usage: {} } as unknown as Anthropic.Message
const rateLimited = () => Anthropic.APIError.generate(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', new Headers())

function oneShot(results: (Anthropic.Message | Error)[]) {
  const calls: Record<string, unknown>[] = []
  const client = { messages: { create: async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(p as unknown as Record<string, unknown>)
    const r = results.shift()!
    if (r instanceof Error) throw r
    return r
  } } }
  return { client, calls }
}

function streaming(results: ('ok' | Error)[]) {
  const calls: Record<string, unknown>[] = []
  const client = { messages: { stream: (p: unknown) => {
    calls.push(p as Record<string, unknown>)
    const r = results.shift()!
    return {
      async *[Symbol.asyncIterator]() {
        if (r instanceof Error) throw r
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '2x|1|2|3|4\n' } }
      },
      finalMessage: async () => ({ stop_reason: 'end_turn' }),
    }
  } } }
  return { client, calls }
}

async function drain(it: AsyncIterable<string>) { let s = ''; for await (const t of it) s += t; return s }

describe('board read speed settings', () => {
  it('reads the board at low effort in fast mode by default', async () => {
    const { client, calls } = oneShot([reply])
    await makeAnthropicCallModel(client)(jpeg)
    expect(calls[0].output_config).toEqual({ effort: 'low' })
    expect(calls[0].speed).toBe('fast')
  })

  it('streams the board at low effort in fast mode by default', async () => {
    const { client, calls } = streaming(['ok'])
    await drain(makeAnthropicStreamModel(client as never)(jpeg))
    expect(calls[0].output_config).toEqual({ effort: 'low' })
    expect(calls[0].speed).toBe('fast')
  })

  it('takes effort and speed from the environment', () => {
    expect(boardTuningFromEnv({})).toEqual({ effort: 'low', speed: 'fast' })
    expect(boardTuningFromEnv({ ANTHROPIC_BOARD_EFFORT: 'medium', ANTHROPIC_BOARD_SPEED: 'standard' })).toEqual({ effort: 'medium', speed: 'standard' })
    expect(boardTuningFromEnv({ ANTHROPIC_BOARD_EFFORT: 'turbo', ANTHROPIC_BOARD_SPEED: 'warp' })).toEqual({ effort: 'low', speed: 'fast' })
  })

  it('leaves speed out when standard speed is chosen', async () => {
    const { client, calls } = oneShot([reply])
    await makeAnthropicCallModel(client, ANTHROPIC_DEFAULT_MODEL, { effort: 'medium', speed: 'standard' })(jpeg)
    expect(calls[0].output_config).toEqual({ effort: 'medium' })
    expect(calls[0]).not.toHaveProperty('speed')
  })

  it('leaves speed out for models without fast mode', async () => {
    const { client, calls } = oneShot([reply])
    await makeAnthropicCallModel(client, 'claude-sonnet-5-5')(jpeg)
    expect(calls[0]).not.toHaveProperty('speed')
    expect(calls[0].output_config).toEqual({ effort: 'low' })
  })

  it('retries once at standard speed when fast mode is rate limited', async () => {
    const { client, calls } = oneShot([rateLimited(), reply])
    expect(await makeAnthropicCallModel(client)(jpeg)).toBe('2x|1|2|3|4')
    expect(calls).toHaveLength(2)
    expect(calls[0].speed).toBe('fast')
    expect(calls[1]).not.toHaveProperty('speed')
  })

  it('retries a stream once at standard speed when fast mode is rate limited before any text', async () => {
    const { client, calls } = streaming([rateLimited(), 'ok'])
    expect(await drain(makeAnthropicStreamModel(client as never)(jpeg))).toBe('2x|1|2|3|4\n')
    expect(calls).toHaveLength(2)
    expect(calls[1]).not.toHaveProperty('speed')
  })

  it('does not retry when standard speed is rate limited', async () => {
    const { client, calls } = oneShot([rateLimited(), reply])
    await expect(makeAnthropicCallModel(client, ANTHROPIC_DEFAULT_MODEL, { effort: 'low', speed: 'standard' })(jpeg)).rejects.toThrow(/rate limit/i)
    expect(calls).toHaveLength(1)
  })
})

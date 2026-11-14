// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

let fetchTts: ((t: string) => Promise<ArrayBuffer>) | null = null
vi.mock('../src/audio/whisper', () => ({
  createWhisperPlayer: (o: { fetchTts: (t: string) => Promise<ArrayBuffer> }) => {
    fetchTts = o.fetchTts
    return { unlock: () => {}, play: () => ({ startedAt: 0 }), prepare: async () => {} }
  },
}))
import { PhoneHome } from '../src/phone/PhoneHome'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('the shared player asks the server voice with the joined class room and token', async () => {
  const store = { getItem: () => JSON.stringify([{ room: 'math201', token: 'tm', label: 'Math 201' }, { room: 'bio110', token: 'tb', label: 'Biology 110' }]) }
  const api = vi.fn(async () => ({ ok: true, json: async () => ({ live: ['bio110'] }) }) as Response)
  render(<PhoneHome deps={{ storage: store, fetch: api as never, earcons: { unlock() {}, play() {} }, unlockVoice() {}, keepAwake: () => () => {}, room: { connect: () => ({ close() {} }), keepAwake: () => () => {}, location: { protocol: 'https:', host: 'h' } } }} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^start listening$/i })) })
  const tts = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }) as Response)
  vi.stubGlobal('fetch', tts)
  await fetchTts!('hello')
  expect((tts.mock.calls as unknown[][])[0][1]).toMatchObject({ headers: { 'x-room': 'bio110', 'x-room-token': 'tb' } })
})

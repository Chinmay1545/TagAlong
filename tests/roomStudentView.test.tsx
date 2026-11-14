// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RoomStudentView, roomTts } from '../src/ui/RoomStudentView'
import type { RoomState } from '../src/live/roomClient'
import type { Resolution, Term } from '../src/core/types'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function setup(opts: { prepare?: (t: Term[]) => Promise<void>; voiceWaitMs?: number } = {}) {
  let on: { onMessage(m: unknown): void; onState?(s: RoomState): void } | null = null
  const urls: string[] = []
  const player = { unlock: vi.fn(), play: vi.fn((_r: Resolution) => ({ startedAt: 0 })), prepare: vi.fn(opts.prepare ?? (async (_t: Term[]) => {})) }
  const awake = vi.fn(() => () => {})
  render(<RoomStudentView room="math201" token="tok" deps={{
    connect: (url, handlers) => { urls.push(url); on = handlers; return { send: () => {}, close: () => {} } },
    player, keepAwake: awake, location: { protocol: 'https:', host: 'app.example' }, voiceWaitMs: opts.voiceWaitMs ?? 1000,
  }} />)
  const said = () => document.querySelector('[aria-live]')!.textContent!.replace(/\u200b/g, '')
  // A whisper waits for the server voice (a promise) before it plays: let that settle.
  const recv = (m: unknown) => act(async () => { on!.onMessage(m); await sleep(5) })
  const state = (s: RoomState) => act(() => on!.onState?.(s))
  const start = () => act(() => { fireEvent.click(screen.getByRole('button', { name: /start listening/i })) })
  return { urls, player, awake, said, recv, state, start }
}

describe('student phone (classroom relay)', () => {
  it('waits for one tap before connecting (phones block sound until a tap)', () => {
    const t = setup()
    expect(t.urls).toEqual([])
    t.start()
    expect(t.player.unlock).toHaveBeenCalled()
    expect(t.awake).toHaveBeenCalled()
    expect(t.urls).toEqual(['wss://app.example/ws/room?role=student&room=math201&t=tok'])
  })

  it('tells the screen reader whether the class is live', async () => {
    const t = setup()
    t.start()
    await t.recv({ type: 'status', live: false })
    expect(t.said()).toMatch(/waiting for math201/i)
    await t.recv({ type: 'status', live: true })
    expect(t.said()).toMatch(/connected to math201/i)
  })

  it('plays each whisper on this phone, panned by where the term is on the board', async () => {
    const t = setup()
    t.start()
    await t.recv({ type: 'whisper', word: 'this', items: [{ phrase: 'the x on the left', x: 0.15 }] })
    const r = t.player.play.mock.calls[0][0]
    expect(r.word.word).toBe('this')
    expect(r.terms.map(x => x.phrase)).toEqual(['the x on the left'])
    expect(r.terms[0].box.x + r.terms[0].box.w / 2).toBeCloseTo(0.15)
    expect(screen.getByText('the x on the left')).toBeTruthy()
  })

  it('gets the board ready ahead of time, and reads it out on request', async () => {
    const t = setup()
    t.start()
    await t.recv({ type: 'board', phrases: ['the x on the left', 'the 5 on the left'] })
    expect(t.player.prepare.mock.calls[0][0].map(x => x.phrase)).toEqual(['the x on the left', 'the 5 on the left'])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /what's on the board/i })); await sleep(5) })
    expect(t.player.play.mock.calls.at(-1)![0].terms.map(x => x.phrase)).toEqual(['the x on the left', 'the 5 on the left'])
  })

  it('says the board is empty instead of playing nothing', async () => {
    const t = setup()
    t.start()
    await t.recv({ type: 'board', phrases: [] })
    fireEvent.click(screen.getByRole('button', { name: /what's on the board/i }))
    expect(t.said()).toMatch(/board is empty/i)
    expect(t.player.play).not.toHaveBeenCalled()
  })

  it('Repeat plays the last whisper again', async () => {
    const t = setup()
    t.start()
    await t.recv({ type: 'whisper', word: 'that', items: [{ phrase: 'the 6 on the right', x: 0.8 }] })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /repeat/i })); await sleep(5) })
    expect(t.player.play).toHaveBeenCalledTimes(2)
    expect(t.player.play.mock.calls[1][0].terms[0].phrase).toBe('the 6 on the right')
  })

  it('announces a dropped connection and when it is back', () => {
    const t = setup()
    t.start()
    t.state('open')
    t.state('reconnecting')
    expect(t.said()).toMatch(/reconnecting/i)
    t.state('open')
    expect(t.said()).toMatch(/back/i)
  })

  it('reads out a notice (class ending)', async () => {
    const t = setup()
    t.start()
    await t.recv({ type: 'notice', text: 'Class is ending. Homework is problem 3.' })
    expect(t.said()).toBe('Class is ending. Homework is problem 3.')
  })

  it('has no buttons that talk back to the teacher (one way only)', () => {
    const t = setup()
    t.start()
    expect(screen.queryByRole('button', { name: /mark/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /what's happening/i })).toBeNull()
  })
})

describe('roomTts', () => {
  it('asks the server for the voice with the room and its token, not the access key', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }))
    vi.stubGlobal('fetch', fetchMock)
    await roomTts('math201', 'tok')('the x on the left')
    expect(fetchMock).toHaveBeenCalledWith('/api/tts', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-room': 'math201', 'x-room-token': 'tok' },
      body: JSON.stringify({ text: 'the x on the left' }),
    }))
  })
  it('fails on a refused phrase so the player falls back to the phone\'s own voice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })))
    await expect(roomTts('math201', 'tok')('anything')).rejects.toThrow(/403/)
  })
})

describe('student phone: one voice per whisper, ElevenLabs first', () => {
  it('waits for the server voice instead of speaking with the phone voice first', async () => {
    let ready!: () => void
    const t = setup({ prepare: () => new Promise<void>(r => { ready = r }) })
    t.start()
    await t.recv({ type: 'whisper', word: 'this', items: [{ phrase: 'the x on the left', x: 0.15 }] })
    expect(t.player.play).not.toHaveBeenCalled() // nothing yet: no phone voice racing ahead
    await act(async () => { ready(); await sleep(5) })
    expect(t.player.play).toHaveBeenCalledTimes(1)
  })

  it('if the server voice is too slow, plays once (phone voice as backup) and not again when it arrives', async () => {
    let ready!: () => void
    const t = setup({ prepare: () => new Promise<void>(r => { ready = r }), voiceWaitMs: 30 })
    t.start()
    await t.recv({ type: 'whisper', word: 'this', items: [{ phrase: 'the x on the left', x: 0.15 }] })
    await act(() => sleep(50))
    expect(t.player.play).toHaveBeenCalledTimes(1)
    await act(async () => { ready(); await sleep(5) })
    expect(t.player.play).toHaveBeenCalledTimes(1)
  })

  it('keeps whispers in order even if a later phrase is ready first', async () => {
    const waits: Record<string, () => void> = {}
    const t = setup({ prepare: ts => new Promise<void>(r => { waits[ts[0].phrase] = r }) })
    t.start()
    await t.recv({ type: 'whisper', word: 'this', items: [{ phrase: 'first', x: 0.2 }] })
    await t.recv({ type: 'whisper', word: 'that', items: [{ phrase: 'second', x: 0.8 }] })
    await act(async () => { waits.second?.(); await sleep(5) })
    expect(t.player.play).not.toHaveBeenCalled()
    await act(async () => { waits.first(); await sleep(5); waits.second?.(); await sleep(5) })
    expect(t.player.play.mock.calls.map(c => c[0].terms[0].phrase)).toEqual(['first', 'second'])
  })
})

describe('connection earcons', () => {
  function withEarcons(extra: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
    let on: { onMessage(m: unknown): void; onState?(s: RoomState): void } | null = null
    const player = { unlock: vi.fn(), play: vi.fn((_r: Resolution) => ({ startedAt: 0 })), prepare: vi.fn(async (_t: Term[]) => {}) }
    const earcons = { unlock: vi.fn(), play: vi.fn() }
    render(<RoomStudentView room="math201" token="tok" {...props} deps={{
      connect: (_u, h) => { on = h; return { send: () => {}, close: () => {} } },
      player, keepAwake: () => () => {}, location: { protocol: 'https:', host: 'app.example' }, voiceWaitMs: 1000, earcons, ...extra,
    }} />)
    const recv = (m: unknown) => act(async () => { on!.onMessage(m); await sleep(5) })
    const state = (s: RoomState) => act(() => on!.onState?.(s))
    const start = () => act(() => { fireEvent.click(screen.getByRole('button', { name: /start listening/i })) })
    return { earcons, recv, state, start }
  }
  const kinds = (e: { play: ReturnType<typeof vi.fn> }) => e.play.mock.calls.map(c => c[0])

  it('unlocks inside the Start press, and plays nothing yet', () => {
    const t = withEarcons()
    expect(t.earcons.unlock).not.toHaveBeenCalled()
    t.start()
    expect(t.earcons.unlock).toHaveBeenCalledTimes(1)
    expect(kinds(t.earcons)).toEqual([])
  })
  it('unlocks the phone voice inside the Start press, before anything is whispered', () => {
    const unlockVoice = vi.fn()
    const t = withEarcons({ unlockVoice })
    expect(unlockVoice).not.toHaveBeenCalled()
    t.start()
    expect(unlockVoice).toHaveBeenCalledTimes(1)
  })
  it('joined: one tone when the class is live on arrival', async () => {
    const t = withEarcons(); t.start()
    await t.recv({ type: 'status', live: true })
    await t.recv({ type: 'status', live: true })
    expect(kinds(t.earcons)).toEqual(['join'])
  })
  it('class started: its own tone when it goes live after waiting', async () => {
    const t = withEarcons(); t.start()
    await t.recv({ type: 'status', live: false })
    expect(kinds(t.earcons)).toEqual([])
    await t.recv({ type: 'status', live: true })
    expect(kinds(t.earcons)).toEqual(['start'])
  })
  it('dropped and back, and no second join when the status is resent after back', async () => {
    const t = withEarcons(); t.start()
    await t.state('open')
    await t.recv({ type: 'status', live: true })
    await t.state('reconnecting')
    await t.state('open')
    await t.recv({ type: 'status', live: true })
    expect(kinds(t.earcons)).toEqual(['join', 'drop', 'back'])
  })
  it('one drop tone per outage, however many retries', async () => {
    const t = withEarcons(); t.start()
    await t.state('open')
    await t.state('reconnecting'); await t.state('reconnecting'); await t.state('reconnecting')
    expect(kinds(t.earcons)).toEqual(['drop'])
  })
  it('never on a whisper, a board, a notice, or a repeat', async () => {
    const t = withEarcons(); t.start()
    await t.recv({ type: 'whisper', word: 'this', items: [{ phrase: 'x', x: 0.5 }] })
    await t.recv({ type: 'board', phrases: ['x'] })
    await t.recv({ type: 'notice', text: 'hello' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /repeat/i })); await sleep(5) })
    expect(kinds(t.earcons)).toEqual([])
  })
  it('when the phone home already announced the start, the first live status is silent', async () => {
    const t = withEarcons({}, { autoStart: true, startedText: 'Math 201 started.' })
    await t.recv({ type: 'status', live: true })
    expect(kinds(t.earcons)).toEqual([])
  })
})

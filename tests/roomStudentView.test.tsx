// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RoomStudentView, roomTts } from '../src/ui/RoomStudentView'
import type { RoomState } from '../src/live/roomClient'
import type { Resolution, Term } from '../src/core/types'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function setup() {
  let on: { onMessage(m: unknown): void; onState?(s: RoomState): void } | null = null
  const urls: string[] = []
  const player = { unlock: vi.fn(), play: vi.fn((_r: Resolution) => ({ startedAt: 0 })), prepare: vi.fn(async (_t: Term[]) => {}) }
  const awake = vi.fn(() => () => {})
  render(<RoomStudentView room="math201" token="tok" deps={{
    connect: (url, handlers) => { urls.push(url); on = handlers; return { send: () => {}, close: () => {} } },
    player, keepAwake: awake, location: { protocol: 'https:', host: 'app.example' },
  }} />)
  const said = () => document.querySelector('[aria-live]')!.textContent!.replace(/​/g, '')
  const recv = (m: unknown) => act(() => on!.onMessage(m))
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

  it('tells the screen reader whether the class is live', () => {
    const t = setup()
    t.start()
    t.recv({ type: 'status', live: false })
    expect(t.said()).toMatch(/waiting for math201/i)
    t.recv({ type: 'status', live: true })
    expect(t.said()).toMatch(/connected to math201/i)
  })

  it('plays each whisper on this phone, panned by where the term is on the board', () => {
    const t = setup()
    t.start()
    t.recv({ type: 'whisper', word: 'this', items: [{ phrase: 'the x on the left', x: 0.15 }] })
    const r = t.player.play.mock.calls[0][0]
    expect(r.word.word).toBe('this')
    expect(r.terms.map(x => x.phrase)).toEqual(['the x on the left'])
    expect(r.terms[0].box.x + r.terms[0].box.w / 2).toBeCloseTo(0.15)
    expect(screen.getByText('the x on the left')).toBeTruthy()
  })

  it('gets the board ready ahead of time, and reads it out on request', () => {
    const t = setup()
    t.start()
    t.recv({ type: 'board', phrases: ['the x on the left', 'the 5 on the left'] })
    expect(t.player.prepare.mock.calls[0][0].map(x => x.phrase)).toEqual(['the x on the left', 'the 5 on the left'])
    fireEvent.click(screen.getByRole('button', { name: /what's on the board/i }))
    expect(t.player.play.mock.calls.at(-1)![0].terms.map(x => x.phrase)).toEqual(['the x on the left', 'the 5 on the left'])
  })

  it('says the board is empty instead of playing nothing', () => {
    const t = setup()
    t.start()
    t.recv({ type: 'board', phrases: [] })
    fireEvent.click(screen.getByRole('button', { name: /what's on the board/i }))
    expect(t.said()).toMatch(/board is empty/i)
    expect(t.player.play).not.toHaveBeenCalled()
  })

  it('Repeat plays the last whisper again', () => {
    const t = setup()
    t.start()
    t.recv({ type: 'whisper', word: 'that', items: [{ phrase: 'the 6 on the right', x: 0.8 }] })
    fireEvent.click(screen.getByRole('button', { name: /repeat/i }))
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

  it('reads out a notice (class ending)', () => {
    const t = setup()
    t.start()
    t.recv({ type: 'notice', text: 'Class is ending. Homework is problem 3.' })
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

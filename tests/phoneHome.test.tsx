// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PhoneHome } from '../src/phone/PhoneHome'
import { saveClass, type SavedClass } from '../src/phone/classes'
import type { RoomState } from '../src/live/roomClient'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { cleanup(); vi.useRealTimers() })

const mem = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}
const cls = (room: string, label: string): SavedClass => ({ room, token: 't-' + room, label })

function setup(saved: SavedClass[], statuses: Array<string[] | 'fail' | 'hang'>) {
  const storage = mem()
  for (const c of [...saved].reverse()) saveClass(storage, c)
  const bodies: unknown[] = []
  let i = 0
  const fetch = vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body))
    const s = statuses[Math.min(i++, statuses.length - 1)]
    if (s === 'fail') throw new Error('offline')
    if (s === 'hang') return new Promise<Response>(() => {})
    return { ok: true, json: async () => ({ live: s }) } as Response
  })
  const urls: string[] = []
  let on: { onMessage(m: unknown): void } | null = null
  const release = vi.fn()
  const keepAwake = vi.fn(() => release)
  const earcons = { unlock: vi.fn(), play: vi.fn() }
  const unlockVoice = vi.fn()
  const player = { unlock: vi.fn(), play: vi.fn(() => ({ startedAt: 0 })), prepare: vi.fn(async () => {}) }
  render(<PhoneHome deps={{
    storage, fetch: fetch as never, pollMs: 5000, player, earcons, unlockVoice, keepAwake,
    room: {
      connect: (url: string, h: { onMessage(m: unknown): void }) => { urls.push(url); on = h; return { close: () => {} } },
      keepAwake: () => () => {}, location: { protocol: 'https:', host: 'app.example' },
    },
  }} />)
  const said = () => document.querySelector('[aria-live]')!.textContent!.replace(/​/g, '')
  const press = (name: RegExp) => act(async () => { fireEvent.click(screen.getByRole('button', { name })) })
  const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  const recv = (m: unknown) => act(async () => { on!.onMessage(m) })
  return { fetch, bodies, urls, player, earcons, unlockVoice, keepAwake, release, recv, said, press, wait }
}

describe('phone home (?classes)', () => {
  it('with no saved class, says what to do once', () => {
    setup([], [])
    expect(screen.getByText('Open the class link from your disability office once.')).toBeTruthy()
  })

  it('with one saved class, goes straight to its listening screen', () => {
    const t = setup([cls('math201', 'Math 201')], [])
    expect(screen.getByRole('button', { name: /start listening to math 201/i })).toBeTruthy()
    expect(t.fetch).not.toHaveBeenCalled()
  })

  it('with several, shows one Start listening button and checks nothing before it is pressed', () => {
    const t = setup([cls('math201', 'Math 201'), cls('bio110', 'Biology 110')], [['math201']])
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Start listening'])
    expect(t.fetch).not.toHaveBeenCalled()
  })

  it('unlocks the player on the press, asks about every saved class, and joins the one that is live', async () => {
    const t = setup([cls('math201', 'Math 201'), cls('bio110', 'Biology 110')], [['bio110']])
    await t.press(/^start listening$/i)
    expect(t.player.unlock).toHaveBeenCalled()
    expect(t.bodies[0]).toEqual({ rooms: [{ room: 'math201', token: 't-math201' }, { room: 'bio110', token: 't-bio110' }] })
    expect(t.urls).toEqual(['wss://app.example/ws/room?role=student&room=bio110&t=t-bio110'])
    expect(t.said()).toBe('Biology 110 started.')
    expect(screen.queryByRole('button', { name: /^start listening/i })).toBeNull()
  })

  it('with none live, announces the wait, polls every 5 s, and joins when one starts', async () => {
    const t = setup([cls('math201', 'Math 201'), cls('bio110', 'Biology 110')], [[], [], ['math201']])
    await t.press(/^start listening$/i)
    expect(t.said()).toBe('Waiting. Your classes: Math 201, Biology 110.')
    expect(t.urls).toEqual([])
    await t.wait(5000)
    expect(t.fetch).toHaveBeenCalledTimes(2)
    expect(t.said()).toBe('Waiting. Your classes: Math 201, Biology 110.')
    await t.wait(5000)
    expect(t.urls).toEqual(['wss://app.example/ws/room?role=student&room=math201&t=t-math201'])
    expect(t.said()).toBe('Math 201 started.')
    await t.wait(20000)
    expect(t.fetch).toHaveBeenCalledTimes(3)
  })

  it('unlocks the tones on the press and plays the start tone once when a class starts', async () => {
    const t = setup([cls('math201', 'Math 201'), cls('bio110', 'Biology 110')], [[], ['bio110']])
    await t.press(/^start listening$/i)
    expect(t.earcons.unlock).toHaveBeenCalled()
    expect(t.unlockVoice).toHaveBeenCalledTimes(1)
    expect(t.earcons.play).not.toHaveBeenCalled()
    await t.wait(5000)
    expect(t.earcons.play.mock.calls).toEqual([['start']])
  })

  it('keeps waiting quietly through network errors', async () => {
    const t = setup([cls('math201', 'Math 201'), cls('bio110', 'Biology 110')], ['fail', 'fail', ['bio110']])
    await t.press(/^start listening$/i)
    expect(t.said()).toBe('Waiting. Your classes: Math 201, Biology 110.')
    await t.wait(5000)
    expect(t.said()).toBe('Waiting. Your classes: Math 201, Biology 110.')
    await t.wait(5000)
    expect(t.said()).toBe('Biology 110 started.')
  })

  it('with two or more live, says Choose a class and offers one button each', async () => {
    const t = setup([cls('math201', 'Math 201'), cls('bio110', 'Biology 110'), cls('art100', 'Art 100')], [['math201', 'bio110']])
    await t.press(/^start listening$/i)
    expect(t.said()).toBe('Choose a class.')
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Join Math 201', 'Join Biology 110'])
    await t.wait(15000)
    expect(t.fetch).toHaveBeenCalledTimes(1)
    await t.press(/join biology 110/i)
    expect(t.urls).toEqual(['wss://app.example/ws/room?role=student&room=bio110&t=t-bio110'])
  })

  it('stops polling when it goes away', async () => {
    const t = setup([cls('math201', 'Math 201'), cls('bio110', 'Biology 110')], [[]])
    await t.press(/^start listening$/i)
    cleanup()
    await t.wait(20000)
    expect(t.fetch).toHaveBeenCalledTimes(1)
  })

  it('holds the screen awake while waiting and lets go on unmount', async () => {
    const t = setup([cls('math201', 'Math 201'), cls('bio110', 'Biology 110')], [[]])
    expect(t.keepAwake).not.toHaveBeenCalled()
    await t.press(/^start listening$/i)
    expect(t.keepAwake).toHaveBeenCalledTimes(1)
    expect(t.release).not.toHaveBeenCalled()
    cleanup()
    expect(t.release).toHaveBeenCalledTimes(1)
  })

  it('lets go of its own wake lock when it joins (the class screen takes its own)', async () => {
    const t = setup([cls('math201', 'Math 201'), cls('bio110', 'Biology 110')], [['math201']])
    await t.press(/^start listening$/i)
    expect(t.release).toHaveBeenCalledTimes(1)
  })

  it('a second press does nothing: one check, one loop', async () => {
    const t = setup([cls('math201', 'Math 201'), cls('bio110', 'Biology 110')], ['hang'])
    const b = screen.getByRole('button', { name: /^start listening$/i })
    await act(async () => { fireEvent.click(b); fireEvent.click(b) })
    expect(t.fetch).toHaveBeenCalledTimes(1)
    expect(t.keepAwake).toHaveBeenCalledTimes(1)
    await t.wait(8000)
    await t.wait(5000)
    expect(t.fetch).toHaveBeenCalledTimes(2)
  })

  it('a check that never answers counts as not live, and the next poll still happens', async () => {
    const t = setup([cls('math201', 'Math 201'), cls('bio110', 'Biology 110')], ['hang', ['bio110']])
    await t.press(/^start listening$/i)
    expect(t.said()).toBe('')
    await t.wait(8000)
    expect(t.said()).toBe('Waiting. Your classes: Math 201, Biology 110.')
    await t.wait(5000)
    expect(t.fetch).toHaveBeenCalledTimes(2)
    expect(t.said()).toBe('Biology 110 started.')
  })

  it('the started announcement is still there after the class screen reports live', async () => {
    const t = setup([cls('math201', 'Math 201'), cls('bio110', 'Biology 110')], [['bio110']])
    await t.press(/^start listening$/i)
    expect(t.said()).toBe('Biology 110 started.')
    expect(document.querySelectorAll('[aria-live]').length).toBeLessThanOrEqual(2)
    await t.recv({ type: 'status', live: true })
    expect(t.said()).toBe('Biology 110 started.')
    expect(screen.getByRole('main').textContent).toMatch(/biology 110/i)
  })

  it('autoStart does not unlock a second time', async () => {
    const t = setup([cls('math201', 'Math 201'), cls('bio110', 'Biology 110')], [['bio110']])
    await t.press(/^start listening$/i)
    expect(t.player.unlock).toHaveBeenCalledTimes(1)
    expect(t.earcons.unlock).toHaveBeenCalledTimes(1)
    expect(t.unlockVoice).toHaveBeenCalledTimes(1)
  })

  it('choose: shows Choose a class. and moves focus to the first Join button', async () => {
    const t = setup([cls('math201', 'Math 201'), cls('bio110', 'Biology 110')], [['math201', 'bio110']])
    await t.press(/^start listening$/i)
    expect(screen.getByRole('heading', { name: 'Choose a class.' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Join Math 201' }))
  })

  it('the visible waiting text is hidden from the screen reader (the live region speaks it)', async () => {
    await setup([cls('math201', 'Math 201'), cls('bio110', 'Biology 110')], [[]]).press(/^start listening$/i)
    expect(document.querySelector('.phone-waiting')!.getAttribute('aria-hidden')).toBe('true')
  })
})

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

function setup(saved: SavedClass[], statuses: Array<string[] | 'fail'>) {
  const storage = mem()
  for (const c of [...saved].reverse()) saveClass(storage, c)
  const bodies: unknown[] = []
  let i = 0
  const fetch = vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body))
    const s = statuses[Math.min(i++, statuses.length - 1)]
    if (s === 'fail') throw new Error('offline')
    return { ok: true, json: async () => ({ live: s }) } as Response
  })
  const urls: string[] = []
  const player = { unlock: vi.fn(), play: vi.fn(() => ({ startedAt: 0 })), prepare: vi.fn(async () => {}) }
  render(<PhoneHome deps={{
    storage, fetch: fetch as never, pollMs: 5000, player,
    room: {
      connect: (url: string) => { urls.push(url); return { close: () => {} } },
      keepAwake: () => () => {}, location: { protocol: 'https:', host: 'app.example' },
    },
  }} />)
  const said = () => document.querySelector('[aria-live]')!.textContent!.replace(/​/g, '')
  const press = (name: RegExp) => act(async () => { fireEvent.click(screen.getByRole('button', { name })) })
  const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  return { fetch, bodies, urls, player, said, press, wait }
}

describe('phone home (?classes)', () => {
  it('with no saved class, says what to do once', () => {
    setup([], [])
    expect(screen.getByText('Open the class link from your disability office once.')).toBeTruthy()
  })

  it('with one saved class, goes straight to its listening screen', () => {
    const t = setup([cls('math201', 'Math 201')], [])
    expect(screen.getByRole('button', { name: /start listening to math201/i })).toBeTruthy()
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
})

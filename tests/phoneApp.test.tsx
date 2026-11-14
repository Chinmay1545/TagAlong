// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PhoneApp } from '../src/phone/PhoneApp'
import { routeFor } from '../src/phone/route'

const TOKEN = 'abcdefghij0123456789'
const OTHER = 'zyxwvutsrq9876543210'
const TIP = 'Tip: a three-finger triple-tap turns on Screen Curtain to save battery. Listening keeps running.'

let opts: any, sent: any[], close: ReturnType<typeof vi.fn>, release: ReturnType<typeof vi.fn>
let synth: any
let earcons: any
let connect: ReturnType<typeof vi.fn>
let data: Map<string, string>
let storage: Storage

const deps = () => ({ connect: connect as any, storage, synth, earcons, awake: () => release as any })
const live = () => document.querySelector('[aria-live]')!
const said = () => live().textContent!.replace(/​/g, '')
const msg = (m: any) => act(() => { opts.onMessage(m) })
const status = (s: string) => act(() => { opts.onStatus(s) })
const rooms = (l: string[], names: Record<string, string> = {}) => msg({ type: 'rooms', live: l, names })
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const mount = (voice?: string, name = 'Math 201') => {
  if (voice) data.set('tagalong:voice', voice)
  render(<PhoneApp token={TOKEN} name={name} deps={deps()} />)
}

beforeEach(() => {
  sent = []
  close = vi.fn()
  release = vi.fn()
  synth = { speak: vi.fn(), cancel: vi.fn() } as any
  earcons = { unlock: vi.fn(), play: vi.fn() }
  connect = vi.fn((o: any) => { opts = o; return { send: (m: any) => { sent.push(m); return true }, close, status: () => 'open' } })
  data = new Map()
  storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as Storage
  vi.stubGlobal('SpeechSynthesisUtterance', class { rate = 1; constructor(public text: string) {} })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('phone app', () => {
  it('first visit offers the two voice choices', () => {
    mount()
    expect(screen.getByRole('button', { name: 'I use VoiceOver or TalkBack' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Read whispers aloud for me' })).toBeTruthy()
    expect(live()).toBeTruthy()
  })

  it('return visit shows one Start listening button without the word tap', () => {
    mount('screenreader')
    const b = screen.getByRole('button', { name: 'Start listening to Math 201' })
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(b.textContent!.toLowerCase()).not.toContain('tap')
  })

  it('start connects as student with all saved rooms and removes the start button', () => {
    data.set('tagalong:classes', JSON.stringify([{ token: OTHER, name: 'Bio' }]))
    mount('screenreader')
    press('Start listening to Math 201')
    const url = new URL(connect.mock.calls[0][0].url)
    expect(url.searchParams.get('role')).toBe('student')
    expect(url.searchParams.get('rooms')).toBe(`${TOKEN},${OTHER}`)
    expect(screen.queryByRole('button', { name: /Start listening/ })).toBeNull()
    expect(earcons.unlock).toHaveBeenCalled()
    expect(data.get('tagalong:voice')).toBe('screenreader')
  })

  it('joins the live class and says Connected', () => {
    mount('screenreader')
    press('Start listening to Math 201')
    rooms([TOKEN], { [TOKEN]: 'Calculus' })
    expect(sent).toEqual([{ type: 'join', room: TOKEN }, { type: 'hello' }])
    expect(said()).toContain('Connected to Calculus.')
    expect(earcons.play).toHaveBeenCalledWith('join')
  })

  it('waits, then joins when the class starts', () => {
    mount('screenreader')
    press('Start listening to Math 201')
    rooms([])
    expect(said()).toBe('Waiting for Math 201 to start.')
    expect(sent).toEqual([])
    rooms([TOKEN])
    expect(said()).toBe('Math 201 started.')
    expect(earcons.play).toHaveBeenCalledWith('start')
    expect(sent[0]).toEqual({ type: 'join', room: TOKEN })
  })

  it('two live classes offer a choice', () => {
    data.set('tagalong:classes', JSON.stringify([{ token: OTHER, name: 'Bio' }, { token: 'q'.repeat(20), name: 'Chem' }]))
    mount('screenreader')
    press('Start listening to Math 201')
    rooms([OTHER, 'q'.repeat(20)])
    expect(screen.getByRole('button', { name: 'Join Chem' })).toBeTruthy()
    press('Join Bio')
    expect(sent[0]).toEqual({ type: 'join', room: OTHER })
    expect(said()).toContain('Connected to Bio.')
    expect(screen.queryByRole('button', { name: 'Join Bio' })).toBeNull()
  })

  it('class ended goes back to waiting', () => {
    mount('screenreader')
    press('Start listening to Math 201')
    rooms([TOKEN])
    rooms([])
    expect(said()).toBe('Class ended. Waiting for Math 201 to start.')
  })

  it('reconnect is announced and re-joins', () => {
    mount('screenreader')
    press('Start listening to Math 201')
    rooms([TOKEN])
    sent.length = 0
    status('reconnecting')
    expect(said()).toBe('Reconnecting.')
    expect(earcons.play).toHaveBeenCalledWith('drop')
    status('open')
    expect(said()).toBe('Back.')
    expect(earcons.play).toHaveBeenCalledWith('back')
    rooms([TOKEN])
    expect(sent).toEqual([{ type: 'join', room: TOKEN }, { type: 'hello' }])
  })

  it('speak mode speaks whispers, screenreader mode only fills the live region', () => {
    mount('speak')
    press('Start listening to Math 201')
    msg({ type: 'resolution', word: 'x', phrase: 'the integral', latencyMs: 5, muted: false })
    expect(synth.speak.mock.calls.some((c: any[]) => c[0].text === 'the integral')).toBe(true)
    expect(live().getAttribute('aria-live')).toBe('off')
    cleanup()
    synth.speak.mockClear()
    mount('screenreader')
    press('Start listening to Math 201')
    msg({ type: 'resolution', word: 'x', phrase: null, latencyMs: 5, muted: false })
    expect(synth.speak).not.toHaveBeenCalled()
    expect(live().getAttribute('aria-live')).toBe('assertive')
    expect(said()).toBe('nothing in reach')
    msg({ type: 'resolution', word: 'x', phrase: 'a', latencyMs: 5, muted: true })
    expect(said()).toBe('Without app: nothing whispered.')
    msg({ type: 'board', phrases: ['a', 'b'] })
    expect(said()).toBe('a, b')
    msg({ type: 'board', phrases: [] })
    expect(said()).toBe('board is empty')
    msg({ type: 'marked', count: 1, removed: true })
    expect(said()).toBe('Mark removed. 1 moment to go over later.')
    msg({ type: 'final', said: 'x', meant: 'ex' })
    expect(said()).toBe('Mark removed. 1 moment to go over later.')
    expect(screen.getByText('Meant: ex')).toBeTruthy()
  })

  it('repeat last re-announces', () => {
    mount('screenreader')
    press('Start listening to Math 201')
    press('Repeat last')
    expect(said()).toBe('Nothing to repeat yet.')
    msg({ type: 'assist', text: 'Dr. Rao is at the board' })
    rooms([TOKEN])
    const before = live().textContent
    press('Repeat last')
    expect(said()).toBe('Dr. Rao is at the board')
    expect(live().textContent).not.toBe(before)
  })

  it('what is happening asks and says Looking', () => {
    mount('screenreader')
    press('Start listening to Math 201')
    press("What's happening?")
    expect(sent).toContainEqual({ type: 'ask' })
    expect(said()).toBe('Looking.')
  })

  it('undo mark within 5 seconds', () => {
    vi.useFakeTimers()
    mount('screenreader')
    press('Start listening to Math 201')
    press("Mark: I didn't get this")
    expect(sent).toContainEqual({ type: 'bookmark' })
    press('Undo mark')
    expect(sent).toContainEqual({ type: 'unmark' })
    expect(screen.getByRole('button', { name: "Mark: I didn't get this" })).toBeTruthy()
    press("Mark: I didn't get this")
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.getByRole('button', { name: "Mark: I didn't get this" })).toBeTruthy()
  })

  it('stop needs a second press', () => {
    mount('screenreader')
    press('Start listening to Math 201')
    press('Stop listening')
    expect(close).not.toHaveBeenCalled()
    press('Press again to stop')
    expect(close).toHaveBeenCalled()
    expect(release).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Start listening to Math 201' })).toBeTruthy()
    expect(said()).toBe('Stopped.')
  })

  it('screen curtain tip only once in screenreader mode', () => {
    mount('screenreader')
    press('Start listening to Math 201')
    rooms([TOKEN])
    expect(said()).toBe(`Connected to Math 201. ${TIP}`)
    cleanup()
    mount('screenreader')
    press('Start listening to Math 201')
    rooms([TOKEN])
    expect(said()).toBe('Connected to Math 201.')
  })

  it('shows relay round trip in the footer', () => {
    mount('screenreader')
    press('Start listening to Math 201')
    act(() => opts.onRtt(42))
    expect(screen.getByText('relay 42 ms')).toBeTruthy()
  })
})

const MARK = "Mark: I didn't get this"
const raw = () => live().textContent!

describe('phone app: pinned behaviours', () => {
  it('an identical announcement twice still changes the live region text', () => {
    mount('screenreader')
    press('Start listening to Math 201')
    msg({ type: 'assist', text: 'Look left' })
    const a = raw()
    msg({ type: 'assist', text: 'Look left' })
    expect(raw()).not.toBe(a)
    expect(said()).toBe('Look left')
    const b = raw()
    press('Repeat last')
    expect(raw()).not.toBe(b)
    expect(said()).toBe('Look left')
  })

  it('open without a prior drop announces nothing', () => {
    mount('screenreader')
    press('Start listening to Math 201')
    status('open')
    expect(said()).toBe('')
    expect(earcons.play).not.toHaveBeenCalledWith('back')
  })

  it('after a reconnect, rooms without the joined token says Class ended', () => {
    mount('screenreader')
    press('Start listening to Math 201')
    rooms([TOKEN])
    status('reconnecting')
    status('open')
    rooms([])
    expect(said()).toBe('Class ended. Waiting for Math 201 to start.')
  })

  it('unmount closes the relay, releases the wake lock and leaves no timers', () => {
    vi.useFakeTimers()
    mount('screenreader')
    press('Start listening to Math 201')
    press(MARK)
    press('Stop listening')
    cleanup()
    expect(close).toHaveBeenCalled()
    expect(release).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the stop prompt times out after 4 seconds', () => {
    vi.useFakeTimers()
    mount('screenreader')
    press('Start listening to Math 201')
    press('Stop listening')
    act(() => { vi.advanceTimersByTime(3999) })
    expect(screen.getByRole('button', { name: 'Press again to stop' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('button', { name: 'Stop listening' })).toBeTruthy()
  })

  it('undo lasts exactly 5 seconds and a second Mark restarts the window', () => {
    vi.useFakeTimers()
    mount('screenreader')
    press('Start listening to Math 201')
    press(MARK)
    act(() => { vi.advanceTimersByTime(4999) })
    expect(screen.getByRole('button', { name: 'Undo mark' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('button', { name: MARK })).toBeTruthy()
    // restart: mark, undo at 3s, mark again; the first timer must not cut the second window short
    press(MARK)
    act(() => { vi.advanceTimersByTime(3000) })
    press('Undo mark')
    press(MARK)
    act(() => { vi.advanceTimersByTime(2500) })
    expect(screen.getByRole('button', { name: 'Undo mark' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(2500) })
    expect(screen.getByRole('button', { name: MARK })).toBeTruthy()
  })

  it('stop during a drop, start again: first open does not say Back', () => {
    mount('screenreader')
    press('Start listening to Math 201')
    rooms([TOKEN])
    status('reconnecting')
    press('Stop listening')
    press('Press again to stop')
    press('Start listening to Math 201')
    earcons.play.mockClear()
    status('open')
    expect(said()).not.toBe('Back.')
    expect(earcons.play).not.toHaveBeenCalledWith('back')
  })

  it('stop while waiting, start again, join says Connected not started', () => {
    mount('screenreader')
    press('Start listening to Math 201')
    rooms([])
    press('Stop listening')
    press('Press again to stop')
    press('Start listening to Math 201')
    rooms([TOKEN])
    expect(said()).toContain('Connected to Math 201.')
  })

  it('Class ended is kept when another saved class is live and joined at once', () => {
    data.set('tagalong:classes', JSON.stringify([{ token: OTHER, name: 'Bio' }]))
    mount('screenreader')
    press('Start listening to Math 201')
    rooms([TOKEN])
    rooms([OTHER])
    expect(said()).toBe('Class ended. Connected to Bio.')
  })

  it('a board message without phrases does not throw', () => {
    mount('screenreader')
    press('Start listening to Math 201')
    msg({ type: 'board' })
    expect(said()).toBe('board is empty')
  })

  it('stop in speak mode cancels in-flight speech', () => {
    mount('speak')
    press('Start listening to Math 201')
    synth.cancel.mockClear()
    press('Stop listening')
    press('Press again to stop')
    expect(synth.cancel).toHaveBeenCalledTimes(2) // explicit cancel, then say() cancels before Stopped.
    const last = synth.speak.mock.calls.at(-1)![0]
    expect(last.text).toBe('Stopped.')
  })
})

describe('routing', () => {
  it('/c/<token>?n=Math%20201 is the phone app', () => {
    expect(routeFor(`/c/${TOKEN}`, '?n=Math%20201')).toEqual({ kind: 'phone', token: TOKEN, name: 'Math 201' })
    expect(routeFor(`/c/${TOKEN}`, '')).toEqual({ kind: 'phone', token: TOKEN, name: 'your class' })
  })
  it('student and judge, and bad tokens fall to judge', () => {
    expect(routeFor('/', '?student')).toEqual({ kind: 'student' })
    expect(routeFor('/', '')).toEqual({ kind: 'judge' })
    expect(routeFor('/c/short', '')).toEqual({ kind: 'judge' })
    expect(routeFor(`/c/${TOKEN}!`, '')).toEqual({ kind: 'judge' })
  })
})

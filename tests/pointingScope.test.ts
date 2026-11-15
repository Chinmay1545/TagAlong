import { afterEach, describe, expect, it, vi } from 'vitest'
import { TipBuffer } from '../src/core/tipBuffer'
import { createLive } from '../src/live/live'
import { readPointer } from '../src/core/resolver'
import { groupKind, scopeFrom } from '../src/core/scope'
import { SCOPE_SPAN_MS, SCOPE_WAIT_MS } from '../src/core/config'
import type { Resolution, Term } from '../src/core/types'
import type { WordItem } from '../src/speech/words'
import { inOrder, move, rest } from './helpers/board'

// Demo board: top row "2x" (A) and "x plus 3" (B), bottom "2x" (C), then the groups.
const t = (id: number, phrase: string, x: number, y: number, w: number, h: number): Term => ({ id, latex: phrase, phrase, box: { x, y, w, h } })
const A = t(1, '2x, in the top', 0.2, 0.2, 0.1, 0.1)
const B = t(2, 'x plus 3, in the top', 0.4, 0.2, 0.2, 0.1)
const C = t(3, '2x, in the bottom', 0.3, 0.6, 0.1, 0.1)
const TOP = t(4, 'the top: 2x times x plus 3', 0.2, 0.2, 0.4, 0.1)
const BOT = t(5, 'the bottom: 2x', 0.3, 0.6, 0.1, 0.1)
const FRAC = t(6, 'the fraction: 2x times x plus 3, over 2x', 0.2, 0.2, 0.4, 0.5)
const TERMS = [A, B, C, TOP, BOT, FRAC]
const word = (w: string, at: number) => ({ word: w, t: at, isPointer: true })
const read = (x: number, y: number, after: string[] = [], terms = TERMS) => {
  const tips = new TipBuffer()
  rest('finger', x, y, 0, 1000).forEach(p => tips.push(p))
  return readPointer(word('this', 500), terms, tips, undefined, after).resolution.terms.map(r => r.id)
}

describe('scope words', () => {
  it('groupKind parses the contract', () => {
    expect(groupKind('the left side: 3x plus 5')).toBe('left side')
    expect(groupKind('2x, in the top')).toBeNull()
  })
  it('only the next 3 words count', () => {
    expect(scopeFrom(['is', 'the', 'top'])).toBe('top')
    expect(scopeFrom(['is', 'my', 'dear', 'top'])).toBeNull()
  })
  it('no scope: smallest box wins; the gap in the top is the top group; the bar is the fraction', () => {
    expect(read(0.25, 0.25)).toEqual([1])
    expect(read(0.35, 0.25)).toEqual([4])
    expect(read(0.4, 0.45)).toEqual([6])
  })
  it('"this top" on a term in the top: the top group; "bottom" with no bottom group around: keeps the term', () => {
    expect(read(0.25, 0.25, ['top'])).toEqual([4])
    expect(read(0.25, 0.25, ['bottom'], [A, B, TOP])).toEqual([1])
  })
  it('finger on the bar saying top / bottom picks that fraction part', () => {
    expect(read(0.4, 0.45, ['top'])).toEqual([4])
    expect(read(0.35, 0.45, ['denominator'])).toEqual([5])
  })
  it('whole / fraction pick the largest / the fraction', () => {
    expect(read(0.25, 0.25, ['whole', 'thing'])).toEqual([6])
    expect(read(0.25, 0.25, ['whole', 'top', 'part'])).toEqual([4])
    expect(read(0.25, 0.25, ['whole'])).toEqual([1])
    for (const weak of ['all', 'everything', 'expression']) expect(read(0.25, 0.25, ['is', weak])).toEqual([1])
    expect(read(0.25, 0.25, ['fraction'])).toEqual([6])
  })
})

describe('ties are silent', () => {
  it('inside A next to B: A. Between A and B near the middle: silent. Near A only: A', () => {
    expect(read(0.29, 0.25, [], [A, B])).toEqual([1])
    expect(read(0.35, 0.25, [], [A, B])).toEqual([])
    expect(read(0.32, 0.25, [], [A, B])).toEqual([1])
  })
})

describe('sweep for this', () => {
  it('no rest, crossed two terms, but no scope word: silent (the gate holds)', () => {
    const tips = new TipBuffer()
    inOrder(move('finger', { x: 0.25, y: 0.25 }, { x: 0.5, y: 0.25 }, 100, 700, 50)).forEach(p => tips.push(p))
    expect(readPointer(word('this', 400), TERMS, tips).sweep).toBeUndefined()
  })
  it('sweep across the top + "top part": the top group', () => {
    const tips = new TipBuffer()
    inOrder(move('finger', { x: 0.25, y: 0.25 }, { x: 0.5, y: 0.25 }, 100, 700, 50)).forEach(p => tips.push(p))
    expect(readPointer(word('this', 400), TERMS, tips, undefined, ['top', 'part']).sweep).toBe(TOP)
  })
  it('terms only near the path (not under it) do not count', () => {
    const tips = new TipBuffer()
    inOrder(move('finger', { x: 0.31, y: 0.25 }, { x: 0.39, y: 0.25 }, 100, 700, 50)).forEach(p => tips.push(p))
    expect(readPointer(word('this', 400), TERMS, tips, undefined, ['top']).sweep).toBeUndefined()
  })
  it('crossing one term: silent', () => {
    const tips = new TipBuffer()
    move('finger', { x: 0.2, y: 0.25 }, { x: 0.3, y: 0.25 }, 100, 700, 50).forEach(p => tips.push(p))
    expect(readPointer(word('this', 400), TERMS, tips).sweep).toBeUndefined()
  })
})

describe('these / those over a board with groups', () => {
  it('a sweep from the top 2x to the bottom 2x names the two terms, never a group', () => {
    const tips = new TipBuffer()
    inOrder(move('finger', { x: 0.25, y: 0.25 }, { x: 0.35, y: 0.65 }, 100, 700, 25)).forEach(p => tips.push(p))
    const r = readPointer(word('these', 400), TERMS, tips).resolution
    expect(r.terms.map(x => x.phrase)).toEqual(['2x, in the top', '2x, in the bottom'])
  })
})

describe('waiting for scope words (Transcribe)', () => {
  function setup(points = rest('finger', 0.25, 0.25, 0, 3000)) {
    let clock = 1000
    const tips = new TipBuffer()
    points.forEach(p => tips.push(p))
    const timers: { fn: () => void; ms: number }[] = []
    const play = vi.fn((_r: Resolution) => ({ startedAt: clock + 10 }))
    const live = createLive({ getTerms: () => TERMS, tips, player: { play, setEnabled: () => {} }, now: () => clock, later: (fn, ms) => { timers.push({ fn, ms }) } })
    const got: number[][] = []
    live.onResolution(r => got.push(r.terms.map(x => x.id)))
    const item = (content: string, startTime: number): WordItem => ({ content, startTime, endTime: startTime + 0.2, isPartial: true, arrivedAt: clock })
    const fire = () => { clock += SCOPE_WAIT_MS; timers.splice(0).forEach(x => x.fn()) }
    return { live, got, timers, item, fire }
  }
  it('"this" alone: the term after SCOPE_WAIT_MS', () => {
    const s = setup()
    s.live.handleItems([s.item('this', 1.0)], 0)
    expect(s.got).toEqual([])
    expect(s.timers[0].ms).toBe(SCOPE_WAIT_MS)
    s.fire()
    expect(s.got).toEqual([[1]])
  })
  it('"this whole top part" in two batches: the top group', () => {
    const s = setup()
    s.live.handleItems([s.item('this', 1.0)], 0)
    s.live.handleItems([s.item('this', 1.0), s.item('top', 1.3), s.item('part', 1.5)], 0)
    s.fire()
    expect(s.got).toEqual([[4]])
  })
  it('only the new items sent: still found', () => {
    const s = setup()
    s.live.handleItems([s.item('this', 1.0)], 0)
    s.live.handleItems([s.item('top', 1.3)], 0)
    s.fire()
    expect(s.got).toEqual([[4]])
  })
  it('the second sentence comes later than SCOPE_SPAN_MS: plain term', () => {
    const s = setup()
    s.live.handleItems([s.item('this', 1.0), s.item('top', 1 + (SCOPE_SPAN_MS + 100) / 1000)], 0)
    s.fire()
    expect(s.got).toEqual([[1]])
  })
  it('"this is all about", "that, all of you": plain term', () => {
    const s = setup()
    s.live.handleItems([s.item('this', 1.0), s.item('is', 1.1), s.item('all', 1.2), s.item('about', 1.3)], 0)
    s.fire()
    expect(s.got).toEqual([[1]])
  })
  it('"this whole" then "thing" later: the largest group; "this whole" then "top" later: the top', () => {
    const a = setup()
    a.live.handleItems([a.item('this', 1.0), a.item('whole', 1.2)], 0)
    expect(a.timers).toHaveLength(1)
    a.live.handleItems([a.item('this', 1.0), a.item('whole', 1.2), a.item('thing', 1.4)], 0)
    a.fire()
    expect(a.got).toEqual([[6]])
    const b = setup()
    b.live.handleItems([b.item('this', 1.0), b.item('whole', 1.2)], 0)
    b.live.handleItems([b.item('top', 1.4)], 0)
    b.fire()
    expect(b.got).toEqual([[4]])
  })
  it('waits SCOPE_WAIT_MS from the word\'s arrival, however long ago it was said', () => {
    const s = setup()
    s.live.handleItems([s.item('this', 0.85)], 0) // said 150 ms before it arrived
    expect(s.timers[0].ms).toBe(SCOPE_WAIT_MS)
  })
  it('"this is my favorite" with no rest: silent', () => {
    const s = setup(move('finger', { x: 0.9, y: 0.9 }, { x: 0.95, y: 0.9 }, 0, 3000, 50))
    s.live.handleItems([s.item('this', 1.0)], 0)
    s.live.handleItems([s.item('this', 1.0), s.item('is', 1.2), s.item('my', 1.3), s.item('favorite', 1.5)], 0)
    s.fire()
    expect(s.got).toEqual([[]])
  })
})

// Real Transcribe partials arrive 300-800 ms after the speech: the wait counts from the arrival, ends when
// the next item arrives, and never lasts longer than SCOPE_WAIT_MS.
describe('scope wait counted from arrival (fake timers)', () => {
  function run() {
    vi.useFakeTimers()
    const base = performance.now()
    const tips = new TipBuffer(60_000)
    rest('finger', 0.25, 0.25, 0, 5000).forEach(p => tips.push({ ...p, t: p.t + base }))
    const live = createLive({ getTerms: () => TERMS, tips, player: { play: () => ({ startedAt: performance.now() }), setEnabled: () => {} } })
    const got: { ids: number[]; at: number }[] = []
    live.onResolution(r => got.push({ ids: r.terms.map(x => x.id), at: Math.round(performance.now() - base) }))
    const item = (content: string, startTime: number): WordItem => ({ content, startTime, isPartial: true, arrivedAt: performance.now() })
    return { base, live, got, item }
  }
  afterEach(() => { vi.useRealTimers() })

  it('"this" arrives 600 ms after it was said, "top" 150 ms later: the top group, at once', () => {
    const { base, live, got, item } = run()
    vi.advanceTimersByTime(1100)
    const first = item('this', 0.5)
    live.handleItems([first], base)
    expect(got).toEqual([])
    vi.advanceTimersByTime(150)
    live.handleItems([first, item('top', 0.7)], base)
    expect(got).toEqual([{ ids: [4], at: 1250 }])
  })
  it('"this" then "is" 100 ms later: the plain term at about 100 ms, not 300', () => {
    const { base, live, got, item } = run()
    vi.advanceTimersByTime(1100)
    const first = item('this', 0.5)
    live.handleItems([first], base)
    vi.advanceTimersByTime(100)
    live.handleItems([first, item('is', 0.6)], base)
    expect(got).toEqual([{ ids: [1], at: 1200 }])
    vi.advanceTimersByTime(500)
    expect(got).toHaveLength(1)
  })
  it('"this" with nothing after it: resolved 300 ms after it arrived', () => {
    const { base, live, got, item } = run()
    vi.advanceTimersByTime(1100)
    live.handleItems([item('this', 0.5)], base)
    vi.advanceTimersByTime(299)
    expect(got).toEqual([])
    vi.advanceTimersByTime(1)
    expect(got).toEqual([{ ids: [1], at: 1400 }])
  })
  it('"this" then only "whole": still waits, until "thing" (or the cap)', () => {
    const { base, live, got, item } = run()
    vi.advanceTimersByTime(1100)
    const first = item('this', 0.5)
    live.handleItems([first], base)
    vi.advanceTimersByTime(100)
    const whole = item('whole', 0.6)
    live.handleItems([first, whole], base)
    expect(got).toEqual([])
    vi.advanceTimersByTime(100)
    live.handleItems([first, whole, item('thing', 0.7)], base)
    expect(got).toEqual([{ ids: [6], at: 1300 }])
  })
})

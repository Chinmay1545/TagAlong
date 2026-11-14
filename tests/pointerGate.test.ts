import { describe, expect, it, vi } from 'vitest'
import { TipBuffer } from '../src/core/tipBuffer'
import { dwellPoint, readPointer, resolvePointer } from '../src/core/resolver'
import { createLive } from '../src/live/live'
import { DWELL_MS, DWELL_RADIUS } from '../src/core/config'
import type { Box, Resolution, Term } from '../src/core/types'
import type { AnyPoint, PointerKind } from '../src/vision/pointer'
import type { WordItem } from '../src/speech/words'

// Only whisper when something actually points (2.5). "This", "that" and "here" need the pointer to rest
// in one place for about DWELL_MS around the word. "These" and "those" keep their sweep.
const A: Term = { id: 1, latex: '2x', phrase: 'the 2x on top', box: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } }
const B: Term = { id: 2, latex: '3y', phrase: 'the 3y below', box: { x: 0.6, y: 0.2, w: 0.1, h: 0.1 } }

const fill = (points: AnyPoint[]) => {
  const buf = new TipBuffer()
  points.forEach(p => buf.push(p))
  return buf
}
const word = (w: string, t = 1000) => ({ word: w, t, isPointer: true })
// The pointer rests at (x, y) from t0 to t1, one point every 33 ms.
const rest = (x: number, y: number, t0 = 600, t1 = 1400, kind: PointerKind = 'finger'): AnyPoint[] =>
  Array.from({ length: Math.floor((t1 - t0) / 33) + 1 }, (_, i) => ({ kind, x, y, confidence: 1, t: t0 + i * 33 }))
// The pointer moves in a straight line from (x0, y) to (x1, y) between t0 and t1.
const sweep = (x0: number, x1: number, y: number, t0 = 500, t1 = 1500, kind: PointerKind = 'finger'): AnyPoint[] =>
  Array.from({ length: 31 }, (_, i) => ({ kind, x: x0 + ((x1 - x0) * i) / 30, y, confidence: 1, t: t0 + ((t1 - t0) * i) / 30 }))

describe('the gate: this / that / here', () => {
  it('no pointer in view: silent', () => {
    expect(resolvePointer(word('that'), [A, B], new TipBuffer()).terms).toEqual([])
  })
  it('a hand passing over a term without stopping: silent', () => {
    // crosses the whole board in one second and is right on A when the word is said
    const pass = sweep(-0.25, 0.75, 0.25)
    for (const w of ['this', 'that', 'here']) expect(resolvePointer(word(w), [A, B], fill(pass)).terms).toEqual([])
  })
  it('a pointer resting on a term: whisper', () => {
    for (const w of ['this', 'that', 'here']) expect(resolvePointer(word(w), [A, B], fill(rest(0.25, 0.25))).terms).toEqual([A])
  })
  it('a short rest counts once it lasts DWELL_MS, not before', () => {
    const stopFor = (ms: number) => [...sweep(-0.3, 0.25, 0.25, 500, 900), ...rest(0.25, 0.25, 933, 933 + ms), ...sweep(0.35, 0.9, 0.25, 933 + ms + 33, 1500)]
    expect(resolvePointer(word('this'), [A, B], fill(stopFor(DWELL_MS + 40))).terms).toEqual([A])
    expect(resolvePointer(word('this'), [A, B], fill(stopFor(DWELL_MS - 110))).terms).toEqual([])
  })
  it('a jittery laser on one term: whisper', () => {
    // A hand-held laser shakes. It is aimed just left of B (in reach), and the two quietest frames in a row
    // are a shake to the far left (out of reach). The smoothed point is still on B.
    const xs = [0.552, 0.538, 0.561, 0.524, 0.524, 0.565, 0.543, 0.559]
    const laser = Array.from({ length: 24 }, (_, i) => ({ kind: 'laser' as const, x: xs[i % xs.length], y: 0.25 + (i % 3 - 1) * 0.008, confidence: 0.9, t: 600 + i * 33 }))
    expect(resolvePointer(word('this'), [A, B], fill(laser)).terms).toEqual([B])
  })
  it('a laser that drops out for a few frames still counts as resting', () => {
    const laser = rest(0.65, 0.25, 600, 1400, 'laser').filter((_, i) => i % 4 !== 0)
    expect(resolvePointer(word('that'), [A, B], fill(laser)).terms).toEqual([B])
  })
  it('a rest that ended just before the word still counts; one from two seconds ago does not', () => {
    const justBefore = [...rest(0.25, 0.25, 600, 900), ...sweep(0.3, 0.9, 0.6, 933, 1100)]
    expect(resolvePointer(word('this'), [A, B], fill(justBefore)).terms).toEqual([A])
    const buf = new TipBuffer(10000)
    rest(0.25, 0.25, 0, 300).forEach(p => buf.push(p))
    sweep(0.3, 0.9, 0.6, 2000, 2500).forEach(p => buf.push(p))
    expect(resolvePointer(word('this', 2400), [A, B], buf).terms).toEqual([])
  })
  it('with two rests in the window, the one nearest the word wins', () => {
    const two = [...rest(0.25, 0.25, 500, 760), ...sweep(0.3, 0.6, 0.25, 790, 850), ...rest(0.65, 0.25, 880, 1300)]
    expect(resolvePointer(word('this'), [A, B], fill(two)).terms).toEqual([B])
  })
})

describe('the gate leaves these / those alone', () => {
  it('a sweep across two terms with "these": both terms', () => {
    expect(resolvePointer(word('these'), [A, B], fill(sweep(0.2, 0.7, 0.25))).terms).toEqual([A, B])
    expect(resolvePointer(word('those'), [A, B], fill(sweep(0.2, 0.7, 0.25, 500, 1500, 'laser'))).terms).toEqual([A, B])
  })
})

describe('dwellPoint', () => {
  it('returns the middle of the rest, smoothing the jitter', () => {
    const pts = rest(0.5, 0.5).map((p, i) => ({ ...p, x: 0.5 + (i % 2 ? 0.01 : -0.01) }))
    const d = dwellPoint(pts, 1000)!
    expect(d.x).toBeCloseTo(0.5, 2)
    expect(d.y).toBeCloseTo(0.5, 5)
  })
  it('is null for a moving pointer, an empty track and a single point', () => {
    expect(dwellPoint(sweep(0, 1, 0.5), 1000)).toBeNull()
    expect(dwellPoint([], 1000)).toBeNull()
    expect(dwellPoint([{ t: 1000, x: 0.5, y: 0.5 }], 1000)).toBeNull()
  })
  it('a point further than DWELL_RADIUS from the rest breaks it', () => {
    const pts = rest(0.5, 0.5, 900, 1100)
    pts[3] = { ...pts[3], x: 0.5 + DWELL_RADIUS * 3 }
    expect(dwellPoint(pts, 1000)).toBeNull()
  })
})

describe('readPointer says why it found nothing', () => {
  it('not pointing vs pointing at empty space vs a hit', () => {
    expect(readPointer(word('this'), [A, B], fill(sweep(-0.25, 0.75, 0.25))).miss).toBe('not-pointing')
    expect(readPointer(word('this'), [A, B], new TipBuffer()).miss).toBe('not-pointing')
    const empty = readPointer(word('this'), [A, B], fill(rest(0.45, 0.8)))
    expect(empty.miss).toBe('empty-space')
    expect(empty.aim!.x).toBeCloseTo(0.45)
    expect(empty.resolution.terms).toEqual([])
    const hit = readPointer(word('this'), [A, B], fill(rest(0.25, 0.25)))
    expect(hit.miss).toBeNull()
    expect(hit.resolution.terms).toEqual([A])
  })
})

describe('live: a word the gate rejects is silent and never held', () => {
  const NEW: Term = { id: 3, latex: 'y', phrase: 'the y on the bottom right', box: { x: 0.6, y: 0.6, w: 0.1, h: 0.1 } }
  const changed: Box = { x: 0.55, y: 0.55, w: 0.2, h: 0.2 } // new ink, not read yet
  const say = (w: string, t: number): WordItem[] => [{ content: w, isPartial: false, arrivedAt: t, segment: -t }]
  function setup(points: AnyPoint[]) {
    let clock = 1000
    let terms: Term[] = [A]
    const play = vi.fn((_r: Resolution) => ({ startedAt: clock + 10 }))
    const live = createLive({ getTerms: () => terms, tips: fill(points), player: { play, setEnabled: () => {} }, now: () => clock, getPendingRegion: () => changed, later: fn => fn() }) // later: the short recheck wait is over at once
    const got: Resolution[] = []
    live.onResolution(r => got.push(r))
    return { live, play, got, advance: (ms: number) => { clock += ms }, setTerms: (t: Term[]) => { terms = t } }
  }

  it('a hand moving through the new ink while "that" is said: silent (after the short recheck), and no late whisper', () => {
    const s = setup(sweep(0.15, 1.15, 0.65)) // on the new ink at t=1000, but never stops
    s.live.handleItems(say('that', 1000), null)
    expect(s.got.map(r => r.terms)).toEqual([[]])
    s.advance(2500)
    s.setTerms([A, NEW]) // the box arrives
    s.live.checkHeld()
    expect(s.got).toHaveLength(1)
    expect(s.play).not.toHaveBeenCalled()
  })

  it('a pointer resting on the new ink is still held and whispered when the box arrives', () => {
    const s = setup(rest(0.65, 0.65))
    s.live.handleItems(say('this', 1000), null)
    expect(s.got).toHaveLength(0)
    s.advance(2500)
    s.setTerms([A, NEW])
    s.live.checkHeld()
    expect(s.got.map(r => r.terms)).toEqual([[NEW]])
  })

  it('a jittery laser resting on the new ink is held at its smoothed point', () => {
    const laser = rest(0.65, 0.65, 600, 1400, 'laser').map((p, i) => ({ ...p, x: 0.65 + (i % 2 ? 0.012 : -0.012) }))
    const s = setup(laser)
    s.live.handleItems(say('here', 1000), null)
    expect(s.got).toHaveLength(0)
    s.setTerms([A, NEW])
    s.live.checkHeld()
    expect(s.got.map(r => r.terms)).toEqual([[NEW]])
  })
})

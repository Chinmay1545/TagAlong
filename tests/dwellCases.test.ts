import { describe, expect, it } from 'vitest'
import { dwellPoint, readPointer, termsAlongPath } from '../src/core/resolver'
import { TipBuffer } from '../src/core/tipBuffer'
import { DWELL_MS, DWELL_RADIUS, TIP_WINDOW_MS } from '../src/core/config'
import type { AnyPoint } from '../src/vision/pointer'
import { BOARD_TERMS, G, N3, T1, T3, X, centre, inOrder, move, rest, rng } from './helpers/board'

// dwellPoint answers: "was the pointer resting somewhere around the word, and where?"
const T = 1000 // the moment the word is said
const still = (t0: number, t1: number, x = 0.5, y = 0.5, step = 33) => rest('finger', x, y, t0, t1, 0, step)

describe('dwellPoint: how long is a rest', () => {
  it('a rest of exactly DWELL_MS counts; one millisecond less does not', () => {
    expect(dwellPoint([{ t: 900, x: 0.5, y: 0.5 }, { t: 950, x: 0.5, y: 0.5 }, { t: 1000, x: 0.5, y: 0.5 }, { t: 1050, x: 0.5, y: 0.5 }, { t: 900 + DWELL_MS, x: 0.5, y: 0.5 }], T)).toEqual({ x: 0.5, y: 0.5 })
    expect(dwellPoint([{ t: 900, x: 0.5, y: 0.5 }, { t: 950, x: 0.5, y: 0.5 }, { t: 1000, x: 0.5, y: 0.5 }, { t: 1050, x: 0.5, y: 0.5 }, { t: 899 + DWELL_MS, x: 0.5, y: 0.5 }], T)).toBeNull()
  })
  it.each([[10, 100], [15, 66], [30, 33], [60, 16], [120, 8]])('works at %i frames a second', (_fps, step) => {
    const d = dwellPoint(still(600, 1400, 0.3, 0.7, step), T)!
    expect(d.x).toBeCloseTo(0.3)
    expect(d.y).toBeCloseTo(0.7)
  })
  it('a slow tracker (5 frames a second) still sees a rest: two points far enough apart in time', () => {
    expect(dwellPoint(still(800, 1000, 0.5, 0.5, 200), T)).toEqual({ x: 0.5, y: 0.5 })
  })
  it('frames that arrive unevenly are fine', () => {
    const ts = [700, 712, 760, 761, 840, 905, 906, 990, 1100, 1101, 1230]
    expect(dwellPoint(ts.map(t => ({ t, x: 0.4, y: 0.4 })), T)).toEqual({ x: expect.closeTo(0.4), y: expect.closeTo(0.4) })
  })
  it('two points at the same instant are not a rest', () => {
    expect(dwellPoint([{ t: 1000, x: 0.5, y: 0.5 }, { t: 1000, x: 0.5, y: 0.5 }], T)).toBeNull()
  })
  it('a long rest gives its middle exactly', () => {
    expect(dwellPoint(still(500, 1500, 0.123, 0.456), T)!.x).toBeCloseTo(0.123, 10)
  })
})

describe('dwellPoint: how still is a rest', () => {
  it('shaking well inside DWELL_RADIUS is a rest, at the middle of the shake', () => {
    const pts = still(600, 1400).map((p, i) => ({ ...p, x: 0.5 + (i % 2 ? 0.012 : -0.012), y: 0.5 + (i % 3 - 1) * 0.01 }))
    const d = dwellPoint(pts, T)!
    expect(d.x).toBeCloseTo(0.5, 2)
    expect(d.y).toBeCloseTo(0.5, 2)
  })
  it('a small circle (a hand-held laser) is a rest at the centre of the circle', () => {
    const pts = still(600, 1400).map((p, i) => ({ ...p, x: 0.6 + 0.015 * Math.cos(i * 0.9), y: 0.3 + 0.015 * Math.sin(i * 0.9) }))
    const d = dwellPoint(pts, T)!
    expect(Math.hypot(d.x - 0.6, d.y - 0.3)).toBeLessThan(0.006)
  })
  it('jumping back and forth further than DWELL_RADIUS is not a rest', () => {
    const pts = still(600, 1400).map((p, i) => ({ ...p, x: 0.5 + (i % 2 ? DWELL_RADIUS : -DWELL_RADIUS) }))
    expect(dwellPoint(pts, T)).toBeNull()
  })
  it('one wild frame in the middle (a tracking glitch) splits the rest in two; each half must be long enough', () => {
    const long = still(600, 1400)
    long[12] = { ...long[12], x: 0.9, y: 0.1 }
    expect(dwellPoint(long, T)).not.toBeNull() // both halves last over DWELL_MS
    const short = still(900, 1100)
    short[3] = { ...short[3], x: 0.9, y: 0.1 }
    expect(dwellPoint(short, T)).toBeNull()
  })
  it.each([[0.02, true], [0.05, true], [0.4, false], [1, false], [3, false]])('moving at %f of the board per second: resting = %s', (speed, resting) => {
    const pts = move('finger', { x: 0.5 - speed / 2, y: 0.5 }, { x: 0.5 + speed / 2, y: 0.5 }, 500, 1500)
    expect(dwellPoint(pts, T) !== null).toBe(resting)
  })
  it('a slow drift counts as resting, aimed near where the pointer was at the word', () => {
    const d = dwellPoint(move('finger', { x: 0.475, y: 0.5 }, { x: 0.525, y: 0.5 }, 500, 1500), T)!
    expect(d.x).toBeCloseTo(0.5, 2)
  })
  it('coming in fast and then resting: the aim is the resting place, not dragged back along the way in', () => {
    const d = dwellPoint(inOrder(move('finger', { x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }, 500, 790), still(800, 1500)), T)!
    expect(Math.abs(d.x - 0.5)).toBeLessThan(0.01)
  })
  it('resting and then leaving fast: the aim is still the resting place', () => {
    const d = dwellPoint(inOrder(still(500, 1100), move('finger', { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 }, 1110, 1400)), T)!
    expect(Math.abs(d.x - 0.5)).toBeLessThan(0.01)
  })
})

describe('dwellPoint: which rest, and when', () => {
  it('only looks TIP_WINDOW_MS either side of the word', () => {
    expect(dwellPoint(still(T - TIP_WINDOW_MS - 300, T - TIP_WINDOW_MS - 20), T)).toBeNull()
    expect(dwellPoint(still(T + TIP_WINDOW_MS + 20, T + TIP_WINDOW_MS + 300), T)).toBeNull()
  })
  it('a rest that is only partly inside the window counts for the part inside', () => {
    expect(dwellPoint(still(T - TIP_WINDOW_MS - 400, T - TIP_WINDOW_MS + 150), T)).toBeNull() // 150 ms inside
    expect(dwellPoint(still(T - TIP_WINDOW_MS - 400, T - TIP_WINDOW_MS + 300), T)).not.toBeNull() // 300 ms inside
  })
  it('a rest that starts just after the word counts (the finger arrives a moment late)', () => {
    expect(dwellPoint(still(T + 100, T + 400, 0.2, 0.2), T)).toEqual({ x: expect.closeTo(0.2), y: expect.closeTo(0.2) })
  })
  it('a rest that ended just before the word counts (the finger leaves a moment early)', () => {
    expect(dwellPoint(still(T - 450, T - 150, 0.2, 0.2), T)).not.toBeNull()
  })
  it('a rest during the word beats a longer rest before it', () => {
    const d = dwellPoint(inOrder(still(500, 850, 0.2, 0.2), move('finger', { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, 860, 940), still(950, 1200, 0.8, 0.8)), T)!
    expect(d.x).toBeCloseTo(0.8, 2)
  })
  it('of a rest before and a rest after, the nearer in time wins', () => {
    const before = still(560, 800, 0.2, 0.2), after = still(1100, 1340, 0.8, 0.8) // 200 ms before, 100 ms after
    expect(dwellPoint(inOrder(before, move('finger', { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, 833, 1067), after), T)!.x).toBeCloseTo(0.8, 2)
    const early = still(660, 900, 0.2, 0.2), late = still(1200, 1440, 0.8, 0.8) // 100 ms before, 200 ms after
    expect(dwellPoint(inOrder(early, move('finger', { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, 933, 1167), late), T)!.x).toBeCloseTo(0.2, 2)
  })
  it('equally near in time: the longer rest wins', () => {
    const before = still(650, 900, 0.2, 0.2) // ends 100 ms before, lasts 250
    const after = still(1100, 1496, 0.8, 0.8) // starts 100 ms after, lasts 396
    expect(dwellPoint(inOrder(before, move('finger', { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, 933, 1067), after), T)!.x).toBeCloseTo(0.8, 2)
  })
  it('the window, the rest time and the radius can all be set', () => {
    const pts = still(900, 1000)
    expect(dwellPoint(pts, T)).toBeNull()
    expect(dwellPoint(pts, T, TIP_WINDOW_MS, 90)).not.toBeNull()
    expect(dwellPoint(still(0, 400), T, 1000)).not.toBeNull()
    const wobble = still(600, 1400).map((p, i) => ({ ...p, x: 0.5 + (i % 2 ? 0.05 : -0.05) }))
    expect(dwellPoint(wobble, T, TIP_WINDOW_MS, DWELL_MS, 0.2)).not.toBeNull()
  })
})

describe('dwellPoint: rules that must hold for any track (300 random tracks)', () => {
  const rand = rng(77)
  // Random tracks: stretches of resting (with jitter) and stretches of moving, like a real hand.
  const tracks = Array.from({ length: 300 }, () => {
    const pts: AnyPoint[] = []
    let x = rand(), y = rand(), t = 400
    while (t < 1600) {
      const len = 60 + rand() * 500
      if (rand() < 0.5) {
        const j = rand() * 0.02
        for (const end = t + len; t < end; t += 33) pts.push({ t, x: x + (rand() * 2 - 1) * j, y: y + (rand() * 2 - 1) * j })
      } else {
        const nx = rand(), ny = rand()
        const n = Math.ceil(len / 33)
        for (let i = 1; i <= n; i++, t += 33) pts.push({ t, x: x + ((nx - x) * i) / n, y: y + ((ny - y) * i) / n })
        x = nx; y = ny
      }
    }
    return pts
  })
  it('the tracks include both resting and not resting', () => {
    const resting = tracks.filter(tr => dwellPoint(tr, T)).length
    expect(resting).toBeGreaterThan(60)
    expect(resting).toBeLessThan(290)
  })
  it('the aim is always where the pointer really was: inside the area its points cover', () => {
    for (const tr of tracks) {
      const d = dwellPoint(tr, T)
      if (!d) continue
      const inWin = tr.filter(p => Math.abs(p.t - T) <= TIP_WINDOW_MS)
      expect(d.x).toBeGreaterThanOrEqual(Math.min(...inWin.map(p => p.x)) - 1e-9)
      expect(d.x).toBeLessThanOrEqual(Math.max(...inWin.map(p => p.x)) + 1e-9)
      expect(d.y).toBeGreaterThanOrEqual(Math.min(...inWin.map(p => p.y)) - 1e-9)
      expect(d.y).toBeLessThanOrEqual(Math.max(...inWin.map(p => p.y)) + 1e-9)
    }
  })
  it('a rest always has real points close to its aim, lasting at least DWELL_MS', () => {
    for (const tr of tracks) {
      const d = dwellPoint(tr, T)
      if (!d) continue
      const close = tr.filter(p => Math.abs(p.t - T) <= TIP_WINDOW_MS && Math.hypot(p.x - d.x, p.y - d.y) <= DWELL_RADIUS * 2)
      expect(close.at(-1)!.t - close[0].t).toBeGreaterThanOrEqual(DWELL_MS)
    }
  })
  it('moving the whole track moves the aim by the same amount', () => {
    for (const tr of tracks.slice(0, 150)) {
      const a = dwellPoint(tr, T), b = dwellPoint(tr.map(p => ({ ...p, x: p.x + 0.25, y: p.y - 0.5 })), T)
      if (!a) { expect(b).toBeNull(); continue }
      expect(b!.x).toBeCloseTo(a.x + 0.25, 9)
      expect(b!.y).toBeCloseTo(a.y - 0.5, 9)
    }
  })
  it('the clock does not matter: the same track an hour later gives the same aim', () => {
    for (const tr of tracks.slice(0, 150)) {
      expect(dwellPoint(tr.map(p => ({ ...p, t: p.t + 3_600_000 })), T + 3_600_000)).toEqual(dwellPoint(tr, T))
    }
  })
  it('points outside the window never change the answer', () => {
    for (const tr of tracks.slice(0, 150)) {
      const extra = [...still(-2000, 300, 0.5, 0.5), ...tr, ...still(1700, 4000, 0.5, 0.5)]
      expect(dwellPoint(extra, T)).toEqual(dwellPoint(tr, T))
    }
  })
})

describe('these / those: the sweep', () => {
  const fill = (pts: AnyPoint[]) => { const b = new TipBuffer(10000); pts.forEach(p => b.push(p)); return b }
  const sweepWord = (w = 'these') => ({ word: w, t: T, isPointer: true })
  const ids = (pts: AnyPoint[], w?: string, terms = [T1, G, T3]) => readPointer(sweepWord(w), terms, fill(pts)).resolution.terms.map(t => t.id)

  it('left to right across the top row: both terms, in the order touched', () => {
    expect(ids(move('finger', { x: 0.2, y: 0.285 }, { x: 0.7, y: 0.285 }, 500, 1500))).toEqual([1, 2])
  })
  it('right to left: the other order', () => {
    expect(ids(move('finger', { x: 0.7, y: 0.285 }, { x: 0.2, y: 0.285 }, 500, 1500))).toEqual([2, 1])
  })
  it('down a column: the top term then the bottom term', () => {
    expect(ids(move('finger', { x: 0.49, y: 0.2 }, { x: 0.49, y: 0.75 }, 500, 1500))).toEqual([2, 3])
  })
  it('back and forth over the same two terms names each once', () => {
    const there = move('finger', { x: 0.2, y: 0.285 }, { x: 0.7, y: 0.285 }, 300, 900)
    const back = move('finger', { x: 0.7, y: 0.285 }, { x: 0.2, y: 0.285 }, 933, 1500)
    expect(ids(inOrder(there, back))).toEqual([1, 2])
  })
  it('a sweep over all three terms', () => {
    const top = move('finger', { x: 0.2, y: 0.285 }, { x: 0.6, y: 0.285 }, 300, 900)
    const down = move('finger', { x: 0.6, y: 0.285 }, { x: 0.49, y: 0.7 }, 933, 1500)
    expect(ids(inOrder(top, down))).toEqual([1, 2, 3])
  })
  it('a sweep through the empty gap between the rows names nothing', () => {
    expect(ids(move('finger', { x: 0.1, y: 0.48 }, { x: 0.9, y: 0.48 }, 500, 1500))).toEqual([])
  })
  it('only the second before and after the word counts', () => {
    const early = move('finger', { x: 0.2, y: 0.285 }, { x: 0.33, y: 0.285 }, -400, -100) // on the 2x, but long before
    const now = rest('finger', 0.49, 0.675, 600, 1400)
    expect(ids(inOrder(early, now))).toEqual([3])
  })
  it('"those" works the same as "these"', () => {
    expect(ids(move('laser', { x: 0.2, y: 0.285 }, { x: 0.7, y: 0.285 }, 500, 1500), 'those')).toEqual([1, 2])
  })
  it('a pointer resting on one term with "these" names that one term', () => {
    expect(ids(rest('finger', 0.29, 0.285, 500, 1500))).toEqual([1])
  })
  it('says why nothing was found: no pointer at all, or a pointer that touched nothing', () => {
    expect(readPointer(sweepWord(), BOARD_TERMS, new TipBuffer()).miss).toBe('not-pointing')
    expect(readPointer(sweepWord(), BOARD_TERMS, fill(move('finger', { x: 0.1, y: 0.9 }, { x: 0.9, y: 0.9 }, 500, 1500))).miss).toBe('empty-space')
  })
  it('termsAlongPath ignores points outside the time range it is given', () => {
    const path = move('finger', { x: 0.2, y: 0.285 }, { x: 0.7, y: 0.285 }, 0, 1000)
    expect(termsAlongPath([T1, G], path, 0, 1000).map(t => t.id)).toEqual([1, 2])
    expect(termsAlongPath([T1, G], path, 0, 250).map(t => t.id)).toEqual([1])
    expect(termsAlongPath([T1, G], path, 700, 1000).map(t => t.id)).toEqual([2])
    expect(termsAlongPath([T1, G], path, 2000, 3000)).toEqual([])
  })
  it('the helpers agree with the board: every leaf term is found at its centre', () => {
    for (const t of [T1, T3, X, N3]) expect(termsAlongPath(BOARD_TERMS, [{ t: 0, ...centre(t) }], 0, 0)).toEqual([t])
  })
})

import { describe, expect, it } from 'vitest'
import { boxDistance, termAt } from '../src/core/resolver'
import { MAX_DIST, NEST_SNAP } from '../src/core/config'
import type { Box, Term } from '../src/core/types'
import { BOARD_TERMS, G, N3, T1, T3, X, rng } from './helpers/board'

// termAt answers the core question: "which term is this point on?"
const name = (t: Term | null) => (t ? t.phrase : null)
const mk = (id: number, x: number, y: number, w: number, h: number): Term => ({ id, latex: `t${id}`, phrase: `t${id}`, box: { x, y, w, h } })

describe('termAt on a realistic board', () => {
  it.each([
    ['centre of the top-left 2x', 0.29, 0.285, T1],
    ['centre of the bottom 2x', 0.49, 0.675, T3],
    ['on the x inside the group', 0.49, 0.285, X],
    ['on the 3 inside the group', 0.62, 0.285, N3],
    ['top-left corner of the x', 0.47, 0.24, X],
    ['bottom-right corner of the 3', 0.64, 0.33, N3],
    ['right edge of the x (still on it)', 0.51, 0.285, X],
    ['on the plus sign, between x and 3', 0.555, 0.285, G],
    ['on the opening bracket', 0.445, 0.285, G],
    ['on the closing bracket', 0.665, 0.285, G],
    ['inside the group, above the x', 0.49, 0.22, G],
    ['left edge of the group', 0.44, 0.285, G],
    ['just left of the top-left 2x', 0.2, 0.285, T1],
    ['just above the top-left 2x', 0.29, 0.17, T1],
    ['just right of the group', 0.7, 0.285, G],
    ['just under the group', 0.49, 0.4, G],
    ['just above the bottom 2x', 0.49, 0.56, T3],
    ['just under the bottom 2x', 0.49, 0.79, T3],
    ['off the corner of the bottom 2x, in reach', 0.57, 0.78, T3],
  ])('%s', (_what, x, y, want) => {
    expect(name(termAt(BOARD_TERMS, x, y))).toBe(want.phrase)
  })

  it.each([
    ['far left of everything', 0.05, 0.285],
    ['too far left of the 2x', 0.17, 0.285],
    ['half way between the two rows', 0.49, 0.48],
    ['empty bottom-left of the board', 0.1, 0.9],
    ['empty top-right of the board', 0.9, 0.05],
    ['off the corner of the bottom 2x, out of reach', 0.59, 0.8],
    ['right of the bottom 2x, out of reach', 0.61, 0.675],
  ])('%s: nothing', (_what, x, y) => {
    expect(termAt(BOARD_TERMS, x, y)).toBeNull()
  })

  it('exactly between two terms: the older one (lowest id), whatever the order', () => {
    expect(name(termAt(BOARD_TERMS, 0.39, 0.285))).toBe(T1.phrase)
    expect(name(termAt([...BOARD_TERMS].reverse(), 0.39, 0.285))).toBe(T1.phrase)
  })
  it('a little nearer to one of two terms: that one', () => {
    expect(name(termAt(BOARD_TERMS, 0.385, 0.285))).toBe(T1.phrase)
    expect(name(termAt(BOARD_TERMS, 0.395, 0.285))).toBe(G.phrase)
  })
  it('every term is found at its own centre unless a smaller term sits there', () => {
    for (const t of [T1, T3, X, N3]) expect(termAt(BOARD_TERMS, t.box.x + t.box.w / 2, t.box.y + t.box.h / 2)).toBe(t)
  })
  it('without the inner boxes, anywhere in the group is the group', () => {
    for (const [x, y] of [[0.49, 0.285], [0.62, 0.285], [0.555, 0.285]]) expect(termAt([T1, G, T3], x, y)).toBe(G)
  })
})

describe('termAt: boxes that overlap', () => {
  const base = mk(1, 0.25, 0.25, 0.125, 0.25) // x 0.25..0.375, y 0.25..0.5
  const exponent = mk(2, 0.3125, 0.1875, 0.125, 0.125) // overlaps the base's top-right corner
  it('in the overlap of a base and its exponent: the smaller box (the exponent)', () => {
    expect(termAt([base, exponent], 0.34, 0.28)).toBe(exponent)
    expect(termAt([exponent, base], 0.34, 0.28)).toBe(exponent)
  })
  it('on the base only: the base. On the exponent only: the exponent', () => {
    expect(termAt([base, exponent], 0.28, 0.4)).toBe(base)
    expect(termAt([base, exponent], 0.42, 0.2)).toBe(exponent)
  })
  it('four levels of nesting: always the innermost box that holds the point', () => {
    const l1 = mk(1, 0.1, 0.1, 0.8, 0.8), l2 = mk(2, 0.2, 0.2, 0.6, 0.6), l3 = mk(3, 0.3, 0.3, 0.4, 0.4), l4 = mk(4, 0.4, 0.4, 0.2, 0.2)
    const all = [l1, l2, l3, l4]
    expect(termAt(all, 0.5, 0.5)).toBe(l4)
    expect(termAt(all, 0.35, 0.5)).toBe(l3)
    expect(termAt(all, 0.25, 0.5)).toBe(l2)
    expect(termAt(all, 0.15, 0.5)).toBe(l1)
    expect(termAt(all, 0.05, 0.5)).toBe(l1) // outside, 0.05 away
    expect(termAt(all, 0.02, 0.5)).toBeNull()
  })
  it('a wide flat box and a tall thin box crossing: the one with the smaller area', () => {
    const wide = mk(1, 0.2, 0.45, 0.6, 0.1) // area 0.06
    const tall = mk(2, 0.45, 0.2, 0.1, 0.5) // area 0.05
    expect(termAt([wide, tall], 0.5, 0.5)).toBe(tall)
    expect(termAt([wide, tall], 0.3, 0.5)).toBe(wide)
  })
  it('the same box twice (a double read): the lowest id', () => {
    expect(termAt([mk(9, 0.4, 0.4, 0.1, 0.1), mk(3, 0.4, 0.4, 0.1, 0.1), mk(5, 0.4, 0.4, 0.1, 0.1)], 0.45, 0.45)!.id).toBe(3)
  })
  it('a point-sized box inside a big one wins when the pointer is exactly on it', () => {
    const big = mk(1, 0.25, 0.25, 0.5, 0.5), dot = mk(2, 0.5, 0.5, 0, 0)
    expect(termAt([big, dot], 0.5, 0.5)).toBe(dot)
    expect(termAt([big, dot], 0.4, 0.4)).toBe(big)
  })
})

// A fingertip is only tracked to about a hundredth of the picture. Inside a bracket group, a pointer that
// is a hair outside an inner term still means that term, not the whole group.
describe('termAt: a near miss on a term inside a group', () => {
  const group = mk(1, 0.25, 0.25, 0.5, 0.25) // x 0.25..0.75, y 0.25..0.5
  const a = mk(2, 0.3125, 0.3125, 0.0625, 0.125) // x 0.3125..0.375
  const b = mk(3, 0.5, 0.3125, 0.0625, 0.125) // x 0.5..0.5625
  const all = [group, a, b]
  it('within NEST_SNAP of an inner term: that term', () => {
    expect(termAt(all, 0.3125 - NEST_SNAP + 0.002, 0.375)).toBe(a) // just left of a
    expect(termAt(all, 0.375 + NEST_SNAP - 0.002, 0.375)).toBe(a) // just right of a
    expect(termAt(all, 0.34, 0.3125 - NEST_SNAP + 0.002)).toBe(a) // just above a
    expect(termAt(all, 0.5 - 0.01, 0.4375 + 0.008)).toBe(b) // off b's corner
  })
  it('further than NEST_SNAP from every inner term: the group', () => {
    expect(termAt(all, 0.3125 - NEST_SNAP - 0.002, 0.375)).toBe(group)
    expect(termAt(all, 0.4375, 0.375)).toBe(group) // the gap between a and b
    expect(termAt(all, 0.7, 0.375)).toBe(group)
    expect(termAt(all, 0.34, 0.47)).toBe(group) // well under a
  })
  it('between two inner terms that are both very close: the nearer one', () => {
    const c = mk(4, 0.395, 0.3125, 0.0625, 0.125) // starts 0.02 right of a
    expect(termAt([group, a, c], 0.375 + 0.006, 0.375)).toBe(a)
    expect(termAt([group, a, c], 0.395 - 0.006, 0.375)).toBe(c)
  })
  it('only snaps to terms inside the group: a small separate neighbour does not steal the pointer', () => {
    const big = mk(1, 0.25, 0.25, 0.25, 0.25) // x 0.25..0.5
    const neighbour = mk(2, 0.505, 0.3, 0.03, 0.05) // a small separate term just to its right
    expect(termAt([big, neighbour], 0.497, 0.32)).toBe(big)
    expect(termAt([neighbour, big], 0.497, 0.32)).toBe(big)
  })
  it('does not snap from outside the group: there the nearest box wins as before', () => {
    const edge = mk(2, 0.26, 0.3125, 0.0625, 0.125) // an inner term near the group's left edge
    expect(termAt([group, edge], 0.245, 0.375)).toBe(group) // outside both; the group is nearer
  })
  it('never snaps further than the reach that was asked for', () => {
    expect(termAt(all, 0.3125 - 0.01, 0.375, 0)).toBe(group)
    expect(termAt(all, 0.3125 - 0.01, 0.375, 0.005)).toBe(group)
    expect(termAt(all, 0.3125 - 0.004, 0.375, 0.005)).toBe(a)
  })
  it('works through two levels: the near miss picks the innermost close term', () => {
    const outer = mk(1, 0.1, 0.1, 0.8, 0.8), mid = mk(2, 0.25, 0.25, 0.5, 0.25), inner = mk(3, 0.3125, 0.3125, 0.0625, 0.125)
    expect(termAt([outer, mid, inner], 0.3125 - 0.01, 0.375)).toBe(inner)
    expect(termAt([outer, mid, inner], 0.25 - 0.01, 0.375)).toBe(mid) // a hair outside the middle box
    expect(termAt([outer, mid, inner], 0.15, 0.7)).toBe(outer)
  })
  it('on the realistic board: a hair outside the x or the 3 is still the x or the 3', () => {
    expect(termAt(BOARD_TERMS, X.box.x - 0.008, 0.285)).toBe(X)
    expect(termAt(BOARD_TERMS, X.box.x + X.box.w + 0.008, 0.285)).toBe(X)
    expect(termAt(BOARD_TERMS, N3.box.x - 0.008, 0.285)).toBe(N3)
    expect(termAt(BOARD_TERMS, 0.49, X.box.y + X.box.h + 0.01)).toBe(X)
  })
})

describe('termAt: reach (how far outside a box still counts)', () => {
  const box = mk(1, 0.5, 0.5, 0.25, 0.25) // numbers that are exact in binary
  it('MAX_DIST is the default reach', () => {
    expect(termAt([box], 0.5 - MAX_DIST + 0.001, 0.6)).toBe(box)
    expect(termAt([box], 0.5 - MAX_DIST - 0.001, 0.6)).toBeNull()
  })
  it('exactly at the reach still counts', () => {
    expect(termAt([box], 0.4375, 0.625, 0.0625)).toBe(box)
    expect(termAt([box], 0.4375 - 1e-6, 0.625, 0.0625)).toBeNull()
  })
  it('off a corner the distance is the straight line to the corner', () => {
    expect(termAt([box], 0.47, 0.46)).toBe(box) // 0.05 away
    expect(termAt([box], 0.45, 0.45)).toBeNull() // 0.0707 away
    expect(boxDistance(box.box, 0.47, 0.46)).toBeCloseTo(0.05)
  })
  it('a reach of 0 means the pointer must be on the box', () => {
    expect(termAt([box], 0.6, 0.6, 0)).toBe(box)
    expect(termAt([box], 0.5, 0.5, 0)).toBe(box) // the corner itself
    expect(termAt([box], 0.499, 0.6, 0)).toBeNull()
  })
  it('a bigger reach can be asked for', () => {
    expect(termAt([box], 0.3, 0.6)).toBeNull()
    expect(termAt([box], 0.3, 0.6, 0.25)).toBe(box)
  })
  it('terms at the edge of the picture, and a pointer slightly outside it', () => {
    const corner = mk(1, 0, 0, 0.1, 0.1), far = mk(2, 0.9, 0.9, 0.1, 0.1)
    expect(termAt([corner, far], 0, 0)).toBe(corner)
    expect(termAt([corner, far], -0.02, -0.02)).toBe(corner)
    expect(termAt([corner, far], 1, 1)).toBe(far)
    expect(termAt([corner, far], 1.03, 0.95)).toBe(far)
    expect(termAt([corner, far], 1.2, 1.2)).toBeNull()
  })
  it('no terms: nothing', () => expect(termAt([], 0.5, 0.5)).toBeNull())
})

describe('termAt: rules that must hold on any board (500 random boards)', () => {
  const rand = rng(20240)
  const area = (b: Box) => b.w * b.h
  const boards = Array.from({ length: 500 }, () => {
    const n = 1 + Math.floor(rand() * 8)
    const ids = Array.from({ length: n }, (_, i) => i + 1).sort(() => rand() - 0.5)
    const terms = ids.map(id => mk(id, rand() * 0.8, rand() * 0.8, 0.02 + rand() * 0.3, 0.02 + rand() * 0.3))
    if (rand() < 0.5) return { terms, x: rand(), y: rand() }
    const on = terms[Math.floor(rand() * n)].box // half the time the pointer is on one of the terms
    return { terms, x: on.x + rand() * on.w, y: on.y + rand() * on.h }
  })
  it('finds a term exactly when at least one is within reach', () => {
    for (const { terms, x, y } of boards) {
      const inReach = terms.some(t => boxDistance(t.box, x, y) <= MAX_DIST)
      expect(termAt(terms, x, y) !== null).toBe(inReach)
    }
  })
  // The plain answer: the smallest box that holds the pointer, else the nearest box in reach.
  const plain = (terms: Term[], x: number, y: number) => termAt(terms, x, y, MAX_DIST, 0)
  const inside = (inner: Box, outer: Box) => boxDistance(outer, inner.x + inner.w / 2, inner.y + inner.h / 2) === 0
  it('with no near-miss snap, never picks a term when a strictly nearer one exists', () => {
    for (const { terms, x, y } of boards) {
      const got = plain(terms, x, y)
      if (!got) continue
      const best = Math.min(...terms.map(t => boxDistance(t.box, x, y)))
      expect(boxDistance(got.box, x, y)).toBeCloseTo(best, 9)
    }
  })
  it('with no near-miss snap, a pointer inside boxes gets the smallest of them', () => {
    let checked = 0
    for (const { terms, x, y } of boards) {
      const holding = terms.filter(t => boxDistance(t.box, x, y) === 0)
      if (!holding.length) continue
      checked++
      const got = plain(terms, x, y)!
      expect(boxDistance(got.box, x, y)).toBe(0)
      expect(area(got.box)).toBeCloseTo(Math.min(...holding.map(t => area(t.box))), 12)
    }
    expect(checked).toBeGreaterThan(100) // the random boards really do exercise this
  })
  it('the near-miss snap only ever swaps a box for a smaller one inside it, a hair away', () => {
    let snapped = 0
    for (const { terms, x, y } of boards) {
      const strict = plain(terms, x, y), got = termAt(terms, x, y)
      if (got === strict) continue
      snapped++
      expect(strict).not.toBeNull()
      expect(boxDistance(strict!.box, x, y)).toBe(0) // the pointer was inside the plain answer
      expect(boxDistance(got!.box, x, y)).toBeLessThanOrEqual(NEST_SNAP)
      expect(area(got!.box)).toBeLessThan(area(strict!.box))
      expect(inside(got!.box, strict!.box)).toBe(true)
    }
    expect(snapped).toBeGreaterThan(0)
  })
  it('a pointer that is in no box at all is never snapped: the nearest box wins', () => {
    for (const { terms, x, y } of boards) {
      if (terms.some(t => boxDistance(t.box, x, y) === 0)) continue
      expect(termAt(terms, x, y)).toBe(plain(terms, x, y))
    }
  })
  it('the order of the list never matters', () => {
    for (const { terms, x, y } of boards) {
      const a = termAt(terms, x, y), b = termAt([...terms].reverse(), x, y), c = termAt([...terms].sort((p, q) => p.id - q.id), x, y)
      expect(b).toBe(a)
      expect(c).toBe(a)
    }
  })
  it('a term far away from the pointer never changes the answer', () => {
    for (const { terms, x, y } of boards) {
      const farAway = mk(999, x + 2, y + 2, 0.1, 0.1)
      expect(termAt([...terms, farAway], x, y)).toBe(termAt(terms, x, y))
    }
  })
  it('moving the whole board and the pointer together gives the same term', () => {
    for (const { terms, x, y } of boards.slice(0, 200)) {
      const shifted = terms.map(t => ({ ...t, box: { ...t.box, x: t.box.x + 0.25, y: t.box.y - 0.125 } }))
      expect(termAt(shifted, x + 0.25, y - 0.125)?.id).toBe(termAt(terms, x, y)?.id)
    }
  })
})

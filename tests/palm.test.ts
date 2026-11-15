import { describe, expect, it } from 'vitest'
import { handPoint, isOpenHand, palmCentre } from '../src/vision/palm'
import { FIST, OPEN, POINT, RELAXED, hand } from './helpers/hand'

describe('isOpenHand', () => {
  it('only a hand with all four fingers out is open', () => {
    expect(isOpenHand(hand(OPEN), 1)).toBe(true)
    expect(isOpenHand(hand(POINT), 1)).toBe(false)
    expect(isOpenHand(hand(FIST), 1)).toBe(false)
    expect(isOpenHand(hand(RELAXED), 1)).toBe(false)
  })
  it('rotation and aspect do not change the answer', () => {
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const aspect of [1, 16 / 9]) {
        expect(isOpenHand(hand(OPEN, { angle, aspect }), aspect)).toBe(true)
        expect(isOpenHand(hand(POINT, { angle, aspect }), aspect)).toBe(false)
        expect(isOpenHand(hand(RELAXED, { angle, aspect }), aspect)).toBe(false)
      }
    }
  })
  it('no hand, or too few points: not open', () => {
    expect(isOpenHand(undefined, 1)).toBe(false)
    expect(isOpenHand(hand(OPEN).slice(0, 10), 1)).toBe(false)
  })
})

describe('palmCentre', () => {
  it('is the middle of the knuckles and fingertips, inside the hand', () => {
    const h = hand(OPEN, { at: { x: 0.4, y: 0.6 } })
    const c = palmCentre(h)
    const xs = h.map(p => p.x), ys = h.map(p => p.y)
    expect(c.x).toBeGreaterThan(Math.min(...xs)); expect(c.x).toBeLessThan(Math.max(...xs))
    expect(c.y).toBeGreaterThan(Math.min(...ys)); expect(c.y).toBeLessThan(Math.max(...ys))
    // knuckles at 0.1 and tips about 0.255 up from the wrist: the middle is about 0.18 up
    expect(c.y).toBeCloseTo(0.6 - 0.1775, 2)
    expect(c.x).toBeCloseTo(0.4, 2)
  })
})

describe('handPoint: what the tracker pushes for one frame', () => {
  const t = 5
  it('open hand and gesture on: a palm at the palm centre', () => {
    const h = hand(OPEN)
    expect(handPoint(h, 1, 0.9, t, true)).toEqual({ kind: 'palm', ...palmCentre(h), confidence: 0.9, t })
  })
  it('gesture off: the fingertip', () => {
    const h = hand(OPEN)
    expect(handPoint(h, 1, 0.9, t, false)).toEqual({ kind: 'finger', x: h[8].x, y: h[8].y, confidence: 0.9, t })
  })
  it('pointing hand: the fingertip', () => {
    const h = hand(POINT)
    expect(handPoint(h, 1, 1, t, true)!.kind).toBe('finger')
  })
  it('no hand: nothing', () => expect(handPoint(undefined, 1, 1, t, true)).toBeNull())
})

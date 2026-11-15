import { describe, expect, it } from 'vitest'
import { TipBuffer } from '../src/core/tipBuffer'
import { readPointer } from '../src/core/resolver'
import type { Term } from '../src/core/types'
import { activePointer, coversBoard, leading, leadingAt, pointerLabel } from '../src/vision/pointer'
import { pointersLabel, toolsFor } from '../src/vision/tools'
import { move, rest } from './helpers/board'

const t = (id: number, phrase: string, x: number, y: number, w: number, h: number): Term => ({ id, latex: phrase, phrase, box: { x, y, w, h } })
const P = t(1, '5x to the fourth', 0.1, 0.2, 0.1, 0.1)
const Q = t(2, '3x cubed', 0.3, 0.2, 0.1, 0.1)
const R = t(3, '3x squared', 0.5, 0.2, 0.1, 0.1)
const EQ1 = t(4, 'the equation: 5x to the fourth plus 3x cubed plus 3x squared', 0.08, 0.18, 0.55, 0.14)
const S = t(5, '7y', 0.1, 0.6, 0.1, 0.1)
const EQ2 = t(6, 'the equation: 7y', 0.08, 0.58, 0.14, 0.14)
const LONE = t(7, '9z', 0.8, 0.8, 0.08, 0.08)
const BR = t(8, 'the brackets: x plus 1', 0.12, 0.45, 0.1, 0.06)
const BX = t(9, 'x', 0.13, 0.46, 0.03, 0.04)
const BOARD = [P, Q, R, EQ1, S, EQ2, LONE, BR, BX]

const read = (kind: 'finger' | 'palm', x: number, y: number, after: string[] = [], track = rest(kind, x, y, 0, 1000)) => {
  const tips = new TipBuffer()
  track.forEach(p => tips.push(p))
  return readPointer({ word: 'this', t: 500, isPointer: true }, BOARD, tips, undefined, after).resolution.terms.map(r => r.id)
}

describe('the hand is one pointer', () => {
  const f = { kind: 'finger' as const, x: 0.1, y: 0.1, confidence: 1, t: 100 }
  const p = { kind: 'palm' as const, x: 0.2, y: 0.2, confidence: 1, t: 110 }
  const l = { kind: 'laser' as const, x: 0.3, y: 0.3, confidence: 1, t: 105 }
  it('palm covers the board and has a label', () => {
    expect(coversBoard('palm')).toBe(true)
    expect(pointerLabel('palm')).toBe('open hand')
  })
  it('finger and palm samples come back together, keeping their own kinds', () => {
    expect(leading([f, p])).toEqual([f, p])
    expect(leadingAt([f, p], 105)).toEqual([f, p])
    expect(activePointer([f, p], 120)).toEqual(p)
  })
  it('a tool still beats the hand', () => {
    const laser = [l, { ...l, t: 106 }, { ...l, t: 107 }]
    expect(leading([f, p, ...laser])).toEqual(laser)
    expect(leadingAt([f, p, ...laser], 105)).toEqual(laser)
  })
})

describe('an open hand on an equation', () => {
  it('"this" gives the whole equation under the hand', () => {
    expect(read('palm', 0.3, 0.25)).toEqual([4])
  })
  it('"this" with a second equation beside it: the one under the hand', () => {
    expect(read('palm', 0.15, 0.65)).toEqual([6])
  })
  it('a scope word still chooses: "this bracket" on a bracket', () => {
    expect(read('palm', 0.17, 0.48, ['bracket'])).toEqual([8])
  })
  it('a finger on 3x cubed: the single term, as before', () => {
    expect(read('finger', 0.35, 0.25)).toEqual([2])
  })
  it('a palm on a lone term with no group: that term', () => {
    expect(read('palm', 0.84, 0.84)).toEqual([7])
  })
  it('a palm moving, no rest: silent', () => {
    expect(read('palm', 0, 0, [], move('palm', { x: 0.1, y: 0.25 }, { x: 0.6, y: 0.25 }, 0, 1000))).toEqual([])
  })
  it('a palm resting on empty board: silent', () => {
    expect(read('palm', 0.5, 0.9)).toEqual([])
  })
  it('the gesture switched off (the hand stays a finger): the single term', () => {
    expect(read('finger', 0.5 + 0.05, 0.25)).toEqual([3])
  })
  it('a hand that opens during the rest: the open or finger decision uses the samples of the rest itself', () => {
    // fingertip cluster first (far away), then the palm rests on the equation for the rest of the window
    const track = [...rest('finger', 0.8, 0.8, 0, 250), ...rest('palm', 0.3, 0.25, 283, 1000)]
    expect(read('palm', 0, 0, [], track)).toEqual([4])
  })
  it('a rest that is mostly finger with a few palm frames: single term', () => {
    const track = [...rest('finger', 0.35, 0.25, 0, 850), ...rest('palm', 0.35, 0.25, 883, 1000)]
    expect(read('palm', 0, 0, [], track)).toEqual([2])
  })
})

describe('the hand switch', () => {
  it('on by default, off with ?hand=0', () => {
    expect(toolsFor('').hand).toBe(true)
    expect(toolsFor('?hand=0').hand).toBe(false)
    expect(toolsFor('?hand=1&laser=1').hand).toBe(true)
  })
  it('the status line lists it', () => {
    expect(pointersLabel({ laser: false, stick: false, hand: true }, false)).toBe('finger + open hand')
    expect(pointersLabel({ laser: false, stick: false, hand: false }, false)).toBe('finger')
  })
})

describe('?openratio calibration', () => {
  it('parses a valid value; junk and out-of-range keep the default', async () => {
    const { openRatioFor } = await import('../src/vision/tools')
    expect(openRatioFor('?openratio=1.1')).toBe(1.1)
    expect(openRatioFor('')).toBe(1.25)
    for (const v of ['abc', '', '1', '2.5', '-3']) expect(openRatioFor(`?openratio=${v}`)).toBe(1.25)
  })
  it('ratio 1.05 accepts the relaxed hand that 1.25 rejects', async () => {
    const { isOpenHand } = await import('../src/vision/palm')
    const { hand, RELAXED } = await import('./helpers/hand')
    expect(isOpenHand(hand(RELAXED), 1)).toBe(false)
    expect(isOpenHand(hand(RELAXED), 1, 1.05)).toBe(true)
  })
})

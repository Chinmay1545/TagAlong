import { describe, expect, it } from 'vitest'
import { TipBuffer } from '../src/core/tipBuffer'
import { readPointer } from '../src/core/resolver'
import type { Term } from '../src/core/types'
import { rest } from './helpers/board'

const t = (id: number, phrase: string, x: number, y: number, w: number, h: number): Term => ({ id, latex: phrase, phrase, box: { x, y, w, h } })
const P = t(1, '5x to the fourth', 0.1, 0.2, 0.1, 0.1)
const Q = t(2, '3x cubed', 0.3, 0.2, 0.1, 0.1)
const R = t(3, '3x squared', 0.5, 0.2, 0.1, 0.1)
const LEFT = t(4, 'the left side of the equation: 5x to the fourth plus 3x cubed plus 3x squared', 0.1, 0.2, 0.5, 0.1)
const EQ = t(5, 'the equation: 5x to the fourth plus 3x cubed plus 3x squared equals 0', 0.1, 0.18, 0.7, 0.2)
const BOARD = [P, Q, R, LEFT, EQ]

const A = t(11, '2x, top of the fraction', 0.2, 0.2, 0.1, 0.1)
const B = t(12, 'x plus 3, top of the fraction', 0.4, 0.2, 0.2, 0.1)
const C = t(13, '2x, bottom of the fraction', 0.3, 0.6, 0.1, 0.1)
const TOP = t(14, 'the top of the fraction: 2x times x plus 3', 0.2, 0.2, 0.4, 0.1)
const BOT = t(15, 'the bottom of the fraction: 2x', 0.3, 0.6, 0.1, 0.1)
const FRAC = t(16, 'the fraction: 2x times x plus 3, over 2x', 0.2, 0.2, 0.4, 0.5)
const FRACTION = [A, B, C, TOP, BOT, FRAC]

const read = (terms: Term[], x: number, y: number, after: string[] = []) => {
  const tips = new TipBuffer()
  rest('finger', x, y, 0, 1000).forEach(p => tips.push(p))
  return readPointer({ word: 'this', t: 500, isPointer: true }, terms, tips, undefined, after).resolution.terms.map(r => r.id)
}

describe('a plain "this" sees single terms only', () => {
  it('0.02 below a term, inside the equation box: that term', () => {
    expect(read(BOARD, 0.35, 0.32)).toEqual([2])
  })
  it('in a gap clearly nearer one term: that term', () => {
    expect(read(BOARD, 0.265, 0.25)).toEqual([2])
  })
  it('exactly between two terms: silent', () => {
    expect(read(BOARD, 0.25, 0.25)).toEqual([])
  })
  it('on the fraction bar: never a group', () => {
    expect(read(FRACTION, 0.4, 0.45)).toEqual([])
    expect(read(FRACTION, 0.35, 0.35).every(id => ![14, 15, 16].includes(id))).toBe(true)
  })
  it('same spots with a scope word: the group', () => {
    expect(read(BOARD, 0.35, 0.32, ['equation'])).toEqual([5])
    expect(read(BOARD, 0.25, 0.25, ['side'])).toEqual([4])
    expect(read(FRACTION, 0.25, 0.25, ['whole', 'top', 'part'])).toEqual([14])
    expect(read(FRACTION, 0.4, 0.45, ['fraction'])).toEqual([16])
  })
})

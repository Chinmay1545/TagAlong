import { describe, it, expect } from 'vitest'
import { overview } from '../src/live/overview'
import type { Term } from '../src/core/types'

const t = (id: number, phrase: string, x: number, y: number, w: number, h: number): Term => ({ id, latex: '', phrase, box: { x, y, w, h } })

describe('overview (top-level phrases of the board)', () => {
  const board = [
    t(1, '2x, in the top', 0.05, 0.1, 0.1, 0.1),
    t(2, 'x plus 3, in the top', 0.2, 0.1, 0.15, 0.1),
    t(3, '2x, in the bottom', 0.1, 0.35, 0.1, 0.1),
    t(4, 'the top: 2x times x plus 3', 0.05, 0.1, 0.3, 0.1),
    t(5, 'the bottom: 2x', 0.1, 0.35, 0.1, 0.1),
    t(6, 'the fraction: 2x times x plus 3, over 2x', 0.05, 0.1, 0.3, 0.35),
    t(7, '3x, on the left side', 0.5, 0.2, 0.1, 0.1),
    t(8, '20, on the right side', 0.8, 0.2, 0.1, 0.1),
    t(9, 'the equation: 3x plus 5 equals 20', 0.5, 0.2, 0.4, 0.1),
  ]
  it('keeps groups not inside another group, in reading order', () =>
    expect(overview(board)).toEqual(['the fraction: 2x times x plus 3, over 2x', 'the equation: 3x plus 5 equals 20']))
  it('keeps single terms that are in no group', () =>
    expect(overview([t(1, 'x', 0.1, 0.1, 0.05, 0.05), t(2, 'the left side: 3x plus 5', 0.5, 0.1, 0.2, 0.1), t(3, '3x, on the left side', 0.5, 0.1, 0.1, 0.1)]))
      .toEqual(['x', 'the left side: 3x plus 5']))
  it('allows a small tolerance on containment', () =>
    expect(overview([t(1, 'the top: a', 0.1, 0.1, 0.3, 0.1), t(2, 'a, in the top', 0.095, 0.1, 0.3, 0.1)])).toEqual(['the top: a']))
  it('is empty for an empty board', () => expect(overview([])).toEqual([]))
})

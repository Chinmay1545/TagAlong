import { describe, it, expect } from 'vitest'
import { mergeTerms } from '../src/core/mergeTerms'
import type { Term } from '../src/core/types'

const T = (id: number, latex: string, x: number, y: number): Term => ({ id, latex, phrase: `the ${latex}`, box: { x, y, w: 0.1, h: 0.1 } })
const shift = (t: Term, dx: number, dy: number, id = 99): Term => ({ ...t, id, box: { ...t.box, x: t.box.x + dx, y: t.box.y + dy } })

const top = T(1, '2x', 0.2, 0.2)
const plus = T(2, '(x + 3)', 0.45, 0.2)
const bottom = T(3, '2x', 0.45, 0.55)
const board = [top, plus, bottom]

describe('mergeTerms', () => {
  it('a wobbly re-read keeps every old term: same object, id and box', () => {
    const next = [shift(plus, 0.01, -0.01, 1), shift(bottom, -0.02, 0.01, 2), shift(top, 0.015, 0, 3)]
    const out = mergeTerms(board, next, { dropMissing: true })
    expect(out).toHaveLength(3)
    out.forEach((t, i) => expect(t).toBe(board[i]))
  })
  it('two terms with the same LaTeX each keep their own box', () => {
    const out = mergeTerms(board, [shift(bottom, 0, 0.01, 1), shift(top, 0, 0.01, 2)], { dropMissing: true })
    expect(out).toEqual([top, bottom])
    expect(out[0]).toBe(top)
    expect(out[1]).toBe(bottom)
  })
  it('a newly written term is added with a fresh id above the old ones', () => {
    const y = T(1, 'y', 0.7, 0.2)
    const out = mergeTerms(board, [...board.map(t => shift(t, 0, 0)), y], { dropMissing: true })
    expect(out.slice(0, 3)).toEqual(board)
    expect(out[3]).toEqual({ ...y, id: 4 })
  })
  it('same LaTeX but far away is a new term, not the old one', () => {
    const out = mergeTerms([top], [shift(top, 0.3, 0, 1)], { dropMissing: true })
    expect(out).toHaveLength(1)
    expect(out[0]).not.toBe(top)
    expect(out[0].id).toBe(2)
  })
  it('different LaTeX in the same place is a new term (it was rewritten)', () => {
    const out = mergeTerms([top], [{ ...top, latex: '3x', id: 1 }], { dropMissing: true })
    expect(out.map(t => [t.id, t.latex])).toEqual([[2, '3x']])
  })
  it('LaTeX spacing does not matter', () => {
    const out = mergeTerms([plus], [{ ...plus, latex: '(x+3)', id: 5 }], { dropMissing: true })
    expect(out[0]).toBe(plus)
  })
  it('dropMissing: false (a read still streaming) keeps old terms not seen yet', () => {
    const out = mergeTerms(board, [shift(top, 0.01, 0, 1)], { dropMissing: false })
    expect(out).toEqual(board)
    out.forEach((t, i) => expect(t).toBe(board[i]))
  })
  it('dropMissing: false hides an old term that a new term is drawn over', () => {
    const out = mergeTerms([top, plus], [{ ...top, latex: '3x', id: 1 }], { dropMissing: false })
    expect(out.map(t => t.latex)).toEqual(['(x + 3)', '3x'])
  })
  it('dropMissing: true drops old terms the new read no longer has', () => {
    expect(mergeTerms(board, [shift(plus, 0, 0, 1)], { dropMissing: true })).toEqual([plus])
    expect(mergeTerms(board, [], { dropMissing: true })).toEqual([])
  })
  it('an empty previous board gives the new terms with ids from 1', () => {
    expect(mergeTerms([], [T(7, 'a', 0.1, 0.1), T(8, 'b', 0.5, 0.1)], { dropMissing: true }).map(t => t.id)).toEqual([1, 2])
  })
})

describe('mergeTerms latex key', () => {
  it('x^{3} and x^3 are the same term', () => {
    const old = { id: 1, latex: '2x^3', phrase: 'a', box: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } }
    const out = mergeTerms([old], [{ ...old, id: 9, latex: '2x^{3}' }], { dropMissing: true })
    expect(out).toEqual([old])
    expect(out[0]).toBe(old)
  })
  it('x_{1} and x_1 are the same term', () => {
    const old = { id: 1, latex: 'x_1', phrase: 'a', box: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } }
    expect(mergeTerms([old], [{ ...old, id: 9, latex: 'x_{1}' }], { dropMissing: true })[0]).toBe(old)
  })
})

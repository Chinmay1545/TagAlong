import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { TipBuffer } from '../src/core/tipBuffer'
import { createLive } from '../src/live/live'
import { isBoardQuery, readingOrder } from '../src/live/boardQuery'
import type { Resolution, Term } from '../src/core/types'

const T = (id: number, x: number, y: number): Term => ({ id, latex: '', phrase: `p${id}`, box: { x, y: y - 0.05, w: 0.1, h: 0.1 } })

describe('isBoardQuery', () => {
  it.each(["What's on the board?", 'what is on the board', 'Can you read the board', 'Whats on the board.', "what's on the road", 'what is on the bored', 'read the bord'])('yes: %s', s => expect(isBoardQuery(s)).toBe(true))
  it.each(['on the board', 'this is on the board now', 'what is that', ''])('no: %s', s => expect(isBoardQuery(s)).toBe(false))
})

describe('readingOrder', () => {
  it('rows then columns, tolerance 0.08', () => {
    const ids = readingOrder([T(4, 0.1, 0.8), T(3, 0.6, 0.23), T(2, 0.3, 0.2), T(1, 0.1, 0.25)]).map(t => t.id)
    expect(ids).toEqual([1, 2, 3, 4])
  })
  it('fraction fixture', () => {
    const { terms } = JSON.parse(readFileSync('public/fixtures/board-fraction.json', 'utf8'))
    expect(readingOrder([terms[2], terms[1], terms[0]]).map((t: Term) => t.id)).toEqual([1, 2, 3])
  })
})

function setup(terms: Term[], enabled = true) {
  const play = vi.fn((_r: Resolution) => (enabled ? { startedAt: 500 } : null))
  const live = createLive({ getTerms: () => terms, tips: new TipBuffer(), player: { play, setEnabled: () => {} } })
  const board: [Resolution, number | null][] = []
  const res: Resolution[] = []
  live.onBoardQuery((r, l) => board.push([r, l]))
  live.onResolution(r => res.push(r))
  return { live, play, board, res }
}

describe('live board query', () => {
  it('plays all terms once in reading order', () => {
    const { live, play, board, res } = setup([T(2, 0.5, 0.2), T(1, 0.1, 0.2)])
    live.handleFinal("what's on the board", 0, 400)
    expect(play).toHaveBeenCalledTimes(1)
    expect(play.mock.calls[0][0].terms.map(t => t.id)).toEqual([1, 2])
    expect(board[0][1]).toBe(100)
    expect(res).toHaveLength(0)
  })
  it('a board with groups: only the top-level items are read, not every term and group', () => {
    const g = (id: number, phrase: string, x: number, y: number, w: number, h: number): Term => ({ id, latex: '', phrase, box: { x, y, w, h } })
    const board = [g(1, '2x, in the top', 0.2, 0.2, 0.1, 0.1), g(2, '2x, in the bottom', 0.2, 0.6, 0.1, 0.1),
      g(3, 'the top: 2x', 0.2, 0.2, 0.1, 0.1), g(4, 'the fraction: 2x, over 2x', 0.2, 0.2, 0.1, 0.5)]
    const { live, play } = setup(board)
    live.handleFinal("what's on the board", 0, 400)
    expect(play.mock.calls[0][0].terms.map(t => t.phrase)).toEqual(['the fraction: 2x, over 2x'])
  })
  it('disabled: emits null latency, no sound', () => {
    const { live, board } = setup([T(1, 0.1, 0.2)], false)
    live.handleFinal('read the board', 0, 400)
    expect(board[0][1]).toBeNull()
    expect(board[0][0].terms).toHaveLength(1)
  })
  it('empty board: emits [], no play', () => {
    const { live, play, board } = setup([])
    live.handleFinal('what is on the board', 0, 400)
    expect(play).not.toHaveBeenCalled()
    expect(board[0][0].terms).toEqual([])
  })
  it('non-query: no emission', () => {
    const { live, board } = setup([T(1, 0.1, 0.2)])
    live.handleFinal('this is on the board now', 0, 400)
    expect(board).toHaveLength(0)
  })
})

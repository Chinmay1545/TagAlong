// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { mountJudge, FIXTURE } from './helpers/judgeHarness'
import type { Resolution, Term } from '../src/core/types'

// The camera screen publishes to the classroom relay: the board (also the saved demo board) and whispers.
const published = { board: [] as Term[][], whisper: [] as Resolution[] }
vi.doMock('../src/live/classroom', () => ({
  createClassroom: () => ({
    room: () => null, open: async () => '', close: () => {}, notice: () => {},
    board: (t: Term[]) => { published.board.push(t) },
    whisper: (r: Resolution) => { published.whisper.push(r) },
    onListeners: () => () => {}, onState: () => () => {},
  }),
}))
afterEach(() => { published.board = []; published.whisper = [] })

describe('camera screen -> classroom relay', () => {
  it('demo mode publishes the saved board, so student phones can prepare its voice', async () => {
    await mountJudge('?demo=1')
    await act(() => new Promise(r => setTimeout(r, 50)))
    expect(published.board.at(-1)?.map(t => t.phrase)).toEqual(FIXTURE.map(t => t.phrase))
  })

  it('live mode publishes each board read', async () => {
    const j = await mountJudge('')
    await act(() => new Promise(r => setTimeout(r, 50)))
    act(() => j.fakes.setTerms!(FIXTURE))
    expect(published.board.at(-1)).toEqual(FIXTURE)
  })
})

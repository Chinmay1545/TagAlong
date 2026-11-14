import { describe, expect, it, vi } from 'vitest'
import { TipBuffer } from '../src/core/tipBuffer'
import { createLive } from '../src/live/live'
import { HOLD_MAX_MS } from '../src/core/config'
import type { Box, Resolution, Term } from '../src/core/types'
import type { WordItem } from '../src/speech/words'

// "Write, then say this": the teacher writes a new term, points at it and says "this" before the board
// read has drawn its box. The word is held and whispered once the box arrives.
const A: Term = { id: 1, latex: '2x', phrase: 'the 2x on top', box: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } }
const NEW: Term = { id: 2, latex: 'y', phrase: 'the y on the bottom right', box: { x: 0.6, y: 0.6, w: 0.1, h: 0.1 } }
const changed: Box = { x: 0.55, y: 0.55, w: 0.2, h: 0.2 } // where the new ink is

const say = (word: string, t: number): WordItem[] => [{ content: word, isPartial: false, arrivedAt: t, segment: -t }]

function setup(at: { x: number; y: number }, pending: Box | null = changed) {
  let clock = 1000
  let terms: Term[] = [A]
  let region: Box | null = pending
  const tips = new TipBuffer()
  for (let t = 600; t <= 1400; t += 50) tips.push({ t, x: at.x, y: at.y }) // pointer resting at `at`
  const play = vi.fn((_r: Resolution) => ({ startedAt: clock + 10 }))
  const live = createLive({ getTerms: () => terms, tips, player: { play, setEnabled: () => {} }, now: () => clock, getPendingRegion: () => region })
  const got: Resolution[] = []
  live.onResolution(r => got.push(r))
  return {
    live, play, got,
    advance: (ms: number) => { clock += ms },
    setTerms: (t: Term[]) => { terms = t },
    setRegion: (r: Box | null) => { region = r },
  }
}

describe('hold a pointer word while the board read catches up (1.5)', () => {
  it('write, then say "this": silent at first, whispered once the new box arrives', () => {
    const s = setup({ x: 0.65, y: 0.65 })
    s.live.handleItems(say('this', 1000), null)
    expect(s.got).toHaveLength(0) // held, not "silent"
    expect(s.play).not.toHaveBeenCalled()
    s.advance(2500)
    s.setTerms([A, NEW]) // the read draws the new term
    s.live.checkHeld()
    expect(s.got).toHaveLength(1)
    expect(s.got[0].terms).toEqual([NEW])
    expect(s.got[0].word.word).toBe('this')
    expect(s.play).toHaveBeenCalledTimes(1)
    s.live.checkHeld()
    expect(s.got).toHaveLength(1) // emitted once
  })

  it('gives up after HOLD_MAX_MS with one silent resolution', () => {
    const s = setup({ x: 0.65, y: 0.65 })
    s.live.handleItems(say('this', 1000), null)
    s.advance(HOLD_MAX_MS - 1)
    s.live.checkHeld()
    expect(s.got).toHaveLength(0)
    s.advance(2)
    s.live.checkHeld()
    expect(s.got).toHaveLength(1)
    expect(s.got[0].terms).toEqual([])
    s.live.checkHeld()
    expect(s.got).toHaveLength(1)
    expect(s.play).not.toHaveBeenCalled()
  })

  it('gives up at once when nothing is left to read and the box never came', () => {
    const s = setup({ x: 0.65, y: 0.65 })
    s.live.handleItems(say('that', 1000), null)
    s.setRegion(null) // read finished, board unchanged since
    s.live.checkHeld()
    expect(s.got.map(r => r.terms)).toEqual([[]])
  })

  it('pointing away from the changed area stays silent right away (no hold)', () => {
    const s = setup({ x: 0.1, y: 0.9 })
    s.live.handleItems(say('this', 1000), null)
    expect(s.got.map(r => r.terms)).toEqual([[]])
  })

  it('no pending change: unchanged behaviour (silent at once)', () => {
    const s = setup({ x: 0.65, y: 0.65 }, null)
    s.live.handleItems(say('this', 1000), null)
    expect(s.got.map(r => r.terms)).toEqual([[]])
  })

  it('pointing at a term already on the board whispers at once, even while a read is pending', () => {
    const s = setup({ x: 0.25, y: 0.25 }, { x: 0, y: 0, w: 1, h: 1 })
    s.live.handleItems(say('this', 1000), null)
    expect(s.got[0].terms).toEqual([A])
  })

  it('"these" is never held (multi-term sweep keeps its behaviour)', () => {
    const s = setup({ x: 0.65, y: 0.65 })
    s.live.handleItems(say('these', 1000), null)
    expect(s.got.map(r => r.terms)).toEqual([[]])
  })
})

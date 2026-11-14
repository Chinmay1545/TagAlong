import { describe, expect, it, vi } from 'vitest'
import { TipBuffer } from '../src/core/tipBuffer'
import { createLive } from '../src/live/live'
import type { Resolution, Term, TipSample } from '../src/core/types'
import type { WordItem } from '../src/speech/words'

const A: Term = { id: 1, latex: '2x', phrase: 'the 2x on top', box: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } }
const B: Term = { id: 2, latex: '3y', phrase: 'the 3y below', box: { x: 0.6, y: 0.2, w: 0.1, h: 0.1 } }
const steady: TipSample[] = Array.from({ length: 11 }, (_, i) => {
  const t = i * 100
  return t >= 400 && t <= 600 ? { t, x: 0.25, y: 0.25 } : { t, x: 0.05 * i, y: 0.25 }
})
const item = (content: string, startTime: number, isPartial = false): WordItem => ({ content, startTime, endTime: startTime + 0.2, isPartial, arrivedAt: 0 })

function setup(fill = true) {
  const tips = new TipBuffer()
  if (fill) steady.forEach(s => tips.push(s))
  let enabled = true
  const play = vi.fn((_r: Resolution) => (enabled ? { startedAt: 560 } : null))
  const setEnabled = vi.fn((v: boolean) => { enabled = v })
  const live = createLive({ getTerms: () => [A, B], tips, player: { play, setEnabled }, now: () => 700 })
  const got: [Resolution, number | null][] = []
  live.onResolution((r, l) => got.push([r, l]))
  return { live, play, got }
}

describe('live pipeline', () => {
  it('resolves, plays and emits with latency from audio start', () => {
    const { live, play, got } = setup()
    live.handleItems([item('this', 0.5)], 0)
    expect(play).toHaveBeenCalledTimes(1)
    expect(got).toHaveLength(1)
    expect(got[0][0].terms[0].id).toBe(1)
    expect(got[0][1]).toBe(60)
  })
  it('emits once across three partials', () => {
    const { live, got } = setup()
    for (const p of [true, true, false]) live.handleItems([item('this', 0.5, p)], 0)
    expect(got).toHaveLength(1)
  })
  it('ignores sentences without pointer words', () => {
    const { live, play, got } = setup()
    live.handleItems([item('hello', 0.1), item('world', 0.5)], 0)
    expect(got).toHaveLength(0)
    expect(play).not.toHaveBeenCalled()
  })
  it('still emits when whisper disabled, latency null', () => {
    const { live, play, got } = setup()
    live.setWhisperEnabled(false)
    live.handleItems([item('this', 0.5)], 0)
    expect(got).toHaveLength(1)
    expect(got[0][1]).toBeNull()
    expect(play).toHaveReturnedWith(null)
  })
  it('empty buffer emits empty terms without play', () => {
    const { live, play, got } = setup(false)
    live.handleItems([item('this', 0.5)], 0)
    expect(got[0][0].terms).toEqual([])
    expect(got[0][1]).toBeNull()
    expect(play).not.toHaveBeenCalled()
  })
  it('resetUtterance allows the same word again', () => {
    const { live, got } = setup()
    live.handleItems([item('this', 0.5)], 0)
    live.resetUtterance()
    live.handleItems([item('this', 0.5)], 0)
    expect(got).toHaveLength(2)
  })
  it('final segments forward and unsubscribe works', () => {
    const { live } = setup()
    const cb = vi.fn()
    const off = live.onFinalSegment(cb)
    live.handleFinal('hi', 1, 2)
    off()
    live.handleFinal('yo', 3, 4)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith('hi', 1, 2)
  })
})

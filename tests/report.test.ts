import { describe, it, expect } from 'vitest'
import { reportCard, reportText } from '../src/transcript/report'
import type { Segment } from '../src/transcript/store'
import type { Resolution } from '../src/core/types'

const term = (id: number, phrase = `t${id}`) => ({ id, latex: phrase, phrase, box: { x: 0, y: 0, w: 1, h: 1 } })
const res = (...ids: number[]): Resolution => ({ word: { word: 'this', t: 0 } as never, terms: ids.map(i => term(i)) })
const seg = (...rs: Resolution[]): Segment => ({ text: 'x', t0: 0, t1: 0, resolutions: rs })
const marks = { correct: 0, total: 0 }
const card = (segments: Segment[], latencies: number[] = [], m = marks) => reportCard({ segments, latencies, marks: m })

describe('reportCard', () => {
  it('handles empty input', () => {
    expect(card([])).toEqual({ pointerWords: 0, resolved: 0, silent: 0, resolvedPct: 0, medianLatencyMs: null, topTerms: [], correct: 0, marked: 0, tips: ['Clear pointing throughout.'] })
  })
  it('counts and rounds pct', () => {
    const c = card([seg(res(1), res(2), res())])
    expect([c.pointerWords, c.resolved, c.silent, c.resolvedPct]).toEqual([3, 2, 1, 67])
  })
  it('silent share > 25% tips; exactly 25% does not', () => {
    expect(card([seg(res(1), res(2), res(3), res())]).tips).toEqual(['Clear pointing throughout.'])
    expect(card([seg(res(1), res(2), res())]).tips).toEqual(["Touch the term or point within a hand's width when you say 'this'."])
  })
  it('same term twice in one segment tips; across segments does not', () => {
    expect(card([seg(res(1), res(1))]).tips).toEqual(["Name the second term out loud, e.g. 'this 2x'."])
    expect(card([seg(res(1)), seg(res(1))]).tips).toEqual(['Clear pointing throughout.'])
  })
  it('median latency > 1000 tips; null when none', () => {
    expect(card([seg(res(1))], [900, 1200, 1300]).tips).toEqual(['Pause briefly after \'this\'.'])
    expect(card([seg(res(1))], [1000]).tips).toEqual(['Clear pointing throughout.'])
    expect(card([seg(res(1))], [200, 400]).medianLatencyMs).toBe(300)
    expect(card([seg(res(1))]).medianLatencyMs).toBeNull()
  })
  it('max 3 tips, in rule order', () => {
    expect(card([seg(res(1), res(1), res())], [2000]).tips).toHaveLength(3)
  })
  it('topTerms ordered by count then first seen, max 3', () => {
    const c = card([seg(res(1), res(2), res(2), res(3), res(3), res(3), res(4))])
    expect(c.topTerms).toEqual([{ phrase: 't3', count: 3 }, { phrase: 't2', count: 2 }, { phrase: 't1', count: 1 }])
  })
  it('passes marks through', () => {
    const c = card([], [], { correct: 4, total: 5 })
    expect([c.correct, c.marked]).toEqual([4, 5])
  })
})

describe('reportText', () => {
  it('is plain text with a Report card heading', () => {
    const t = reportText(card([seg(res(1), res())], [420], { correct: 1, total: 1 }))
    expect(t).toMatch(/^Report card\n/)
    expect(t).toContain('Resolved: 1 of 2 pointer words (50%)')
    expect(t).toContain('Median latency: 0.42 s')
    expect(t).toContain('Marked correct: 1 of 1')
  })
})

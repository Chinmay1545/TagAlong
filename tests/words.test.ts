import { describe, it, expect } from 'vitest'
import { detectPointerWords, toPerfTime, type WordItem } from '../src/speech/words'

const it_ = (content: string, startTime?: number, arrivedAt = 500): WordItem => ({ content, startTime, isPartial: true, arrivedAt })

describe('words', () => {
  it('toPerfTime', () => expect(toPerfTime(1.25, 1000)).toBe(2250))
  it('normalizes pointer words', () => {
    const ev = detectPointerWords([it_('This', 1), it_('that,', 2), it_('THOSE.', 3), it_('thistle', 4), it_('is', 5)], new Set(), 0)
    expect(ev.map(e => e.word)).toEqual(['this', 'that', 'those'])
    expect(ev.every(e => e.isPointer)).toBe(true)
  })
  it('clock: start+audioStart vs arrivedAt', () => {
    expect(detectPointerWords([it_('this', 1.25)], new Set(), 1000)[0].t).toBe(2250)
    expect(detectPointerWords([it_('this')], new Set(), 1000)[0].t).toBe(500)
    expect(detectPointerWords([it_('this', 1)], new Set(), null)[0].t).toBe(500)
  })
  it('dedupes by start bucket', () => {
    const seen = new Set<string>()
    const n = [1, 2, 3].flatMap(() => detectPointerWords([it_('this', 1.0)], seen, 0)).length
    expect(n).toBe(1)
    expect(detectPointerWords([it_('this', 1.0), it_('this', 2.4)], seen, 0)).toHaveLength(1)
  })
  it('dedupes by occurrence index without start', () => {
    const seen = new Set<string>()
    expect(detectPointerWords([it_('this')], seen, null)).toHaveLength(1)
    expect(detectPointerWords([it_('this')], seen, null)).toHaveLength(0)
    expect(detectPointerWords([it_('this'), it_('is'), it_('this')], seen, null)).toHaveLength(1)
  })
  it('dedupes when a revised start crosses a bucket boundary', () => {
    const seen = new Set<string>()
    const n = detectPointerWords([it_('this', 1.04)], seen, 0).length + detectPointerWords([it_('this', 1.06)], seen, 0).length
    expect(n).toBe(1)
  })
  it('dedupes a word that gains a start time after arriving untimed', () => {
    const seen = new Set<string>()
    const n = detectPointerWords([it_('this')], seen, 0).length + detectPointerWords([it_('this', 1.0)], seen, 0).length
    expect(n).toBe(1)
  })
  it('empty', () => expect(detectPointerWords([], new Set(), 0)).toEqual([]))
})

describe('segment-scoped dedupe', () => {
  const w = (segment: number): WordItem => ({ content: 'this', isPartial: true, arrivedAt: 1, segment })
  it('re-sent word in one segment fires once', () => {
    const seen = new Set<string>()
    const n = [0, 1, 2].flatMap(() => detectPointerWords([w(0)], seen, null)).length
    expect(n).toBe(1)
  })
  it('same word in different segments fires twice', () => {
    const seen = new Set<string>()
    expect(detectPointerWords([w(0), w(1)], seen, null)).toHaveLength(2)
  })
  it('segment 1 sent alone after segment 0 still fires', () => {
    const seen = new Set<string>()
    detectPointerWords([w(0)], seen, null)
    expect(detectPointerWords([w(1)], seen, null)).toHaveLength(1)
  })
})

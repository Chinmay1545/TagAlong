import { describe, it, expect } from 'vitest'
import { bookmarkMsg, askMsg, markedMsg, assistMsg, noticeMsg, unmarkMsg } from '../src/live/broadcast'

describe('student <-> judge messages', () => {
  it('student asks: bookmark and what-is-happening', () => {
    expect(bookmarkMsg()).toEqual({ type: 'bookmark' })
    expect(askMsg()).toEqual({ type: 'ask' })
  })
  it('judge answers: marked count, assist answer, notice', () => {
    expect(markedMsg(2)).toEqual({ type: 'marked', count: 2 })
    expect(assistMsg('Students are packing up.')).toEqual({ type: 'assist', text: 'Students are packing up.' })
    expect(noticeMsg('Class is wrapping up.')).toEqual({ type: 'notice', text: 'Class is wrapping up.' })
  })
})

describe('unmark messages', () => {
  it('unmarkMsg and markedMsg removed flag', () => {
    expect(unmarkMsg()).toEqual({ type: 'unmark' })
    expect(markedMsg(3)).toEqual({ type: 'marked', count: 3 })
    expect(markedMsg(2, true)).toEqual({ type: 'marked', count: 2, removed: true })
  })
})

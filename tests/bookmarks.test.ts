import { describe, it, expect } from 'vitest'
import { createTranscript, toPlainText } from '../src/transcript/store'

// A bookmark is "I didn't understand this": it marks the sentence that was being spoken when the student pressed.
describe('transcript bookmarks', () => {
  it('a bookmark inside a sentence marks that sentence', () => {
    const tr = createTranscript()
    tr.addFinal('first', 0, 1000)
    tr.addFinal('second', 2000, 3000)
    tr.addBookmark(2500)
    expect(tr.segments().map(s => s.bookmarked)).toEqual([false, true])
  })
  it('a bookmark in the pause after a sentence marks the sentence just heard', () => {
    const tr = createTranscript()
    tr.addFinal('first', 0, 1000)
    tr.addFinal('second', 2000, 3000)
    tr.addBookmark(1500)
    expect(tr.segments().map(s => s.bookmarked)).toEqual([true, false])
  })
  it('a bookmark while a sentence is still being spoken lands on it once its final arrives', () => {
    const tr = createTranscript()
    tr.addFinal('first', 0, 1000)
    tr.addBookmark(2500) // second sentence started at 2000, its final is not in yet
    tr.addFinal('second', 2000, 3000)
    expect(tr.segments().map(s => s.bookmarked)).toEqual([false, true])
  })
  it('a bookmark before anything was said marks the first sentence', () => {
    const tr = createTranscript()
    tr.addBookmark(-500)
    expect(tr.segments()).toEqual([])
    tr.addFinal('first', 0, 1000)
    expect(tr.segments()[0].bookmarked).toBe(true)
  })
  it('counts bookmarks, and two presses on one sentence mark it once', () => {
    const tr = createTranscript()
    tr.addFinal('first', 0, 1000)
    expect(tr.addBookmark(500)).toBe(1)
    expect(tr.addBookmark(600)).toBe(2)
    expect(tr.segments().filter(s => s.bookmarked)).toHaveLength(1)
  })
  it('clear forgets bookmarks', () => {
    const tr = createTranscript()
    tr.addBookmark(500)
    tr.clear()
    tr.addFinal('first', 0, 1000)
    expect(tr.segments()[0].bookmarked).toBe(false)
    expect(tr.addBookmark(500)).toBe(1)
  })
  it('the plain-text export flags marked sentences', () => {
    const tr = createTranscript()
    tr.addFinal('first', 0, 1000)
    tr.addFinal('second', 2000, 3000)
    tr.addBookmark(2500)
    const text = toPlainText(tr.segments())
    expect(text).toBe('Said: first\nMeant: first\n\nMarked: did not understand\nSaid: second\nMeant: second\n')
  })
})

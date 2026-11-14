import { describe, it, expect } from 'vitest'
import { createTranscript, substitute, toPlainText } from '../src/transcript/store'
import type { Resolution, Term } from '../src/core/types'

const box = { x: 0, y: 0, w: 1, h: 1 }
const term = (id: number, phrase: string): Term => ({ id, latex: '', phrase, box })
const res = (word: string, t: number, ...phrases: string[]): Resolution => ({
  word: { word, t, isPointer: true },
  terms: phrases.map((p, i) => term(i, p)),
})

describe('substitute', () => {
  it('absorbs "one"/"ones" after a pointer word', () => {
    expect(substitute('this one gets multiplied', [res('this', 1, 'the 2x on top')])).toBe('The 2x on top gets multiplied')
    expect(substitute('cancel these ones', [res('these', 1, 'the 2x terms')])).toBe('cancel the 2x terms')
    expect(substitute('this one', [res('this', 1)])).toBe('this one')
  })
  it('replaces pointer words in order, capitalises sentence start, keeps punctuation', () => {
    const out = substitute('This cancels with that.', [res('this', 1, 'the 2x on top'), res('that', 2, 'the 2x on the bottom')])
    expect(out).toBe('The 2x on top cancels with the 2x on the bottom.')
  })
  it('silent resolution leaves the word', () => {
    expect(substitute('so this is that', [res('this', 1), res('that', 2, 'x squared')])).toBe('so this is x squared')
  })
  it('more pointer words than resolutions leaves the rest', () => {
    expect(substitute('this and that', [res('this', 1, 'a')])).toBe('A and that')
  })
  it('handles these/those and whole words only', () => {
    expect(substitute('Those, not thistle, and these', [res('those', 1, 'p'), res('these', 2, 'q')])).toBe('P, not thistle, and q')
  })
})

describe('contractions', () => {
  it('does not match pointer words inside contractions', () => {
    expect(substitute("that's this one", [res('this', 1, 'x squared')])).toBe("that's x squared")
  })
})

describe('createTranscript', () => {
  it('attaches by time and keeps later ones pending', () => {
    const tr = createTranscript()
    tr.addResolution(res('this', 100, 'a'))
    tr.addResolution(res('that', 1000, 'b'))
    tr.addFinal('this one', 50, 500)
    tr.addFinal('that one', 900, 1100)
    const s = tr.segments()
    expect(s[0].resolutions.map(r => r.word.t)).toEqual([100])
    expect(s[1].resolutions.map(r => r.word.t)).toEqual([1000])
  })
  it('slack of 250ms; beyond stays pending', () => {
    const tr = createTranscript()
    tr.addResolution(res('this', 700, 'a'))
    tr.addResolution(res('that', 751, 'b'))
    tr.addFinal('this that', 500, 500)
    expect(tr.segments()[0].resolutions).toHaveLength(1)
    tr.addFinal('that', 800, 800)
    expect(tr.segments()[1].resolutions.map(r => r.word.t)).toEqual([751])
  })
  it('clear empties segments and pending', () => {
    const tr = createTranscript()
    tr.addResolution(res('this', 1, 'a'))
    tr.addFinal('x', 0, 10)
    tr.addResolution(res('this', 5000, 'a'))
    tr.clear()
    expect(tr.segments()).toEqual([])
    tr.addFinal('y', 0, 9000)
    expect(tr.segments()[0].resolutions).toEqual([])
  })
})

describe('toPlainText', () => {
  it('formats Said/Meant blocks', () => {
    const segs = [
      { text: 'This is it.', t0: 0, t1: 1, resolutions: [res('this', 0, 'the sum')] },
      { text: 'ok', t0: 2, t1: 3, resolutions: [] },
    ]
    expect(toPlainText(segs)).toBe('Said: This is it.\nMeant: The sum is it.\n\nSaid: ok\nMeant: ok\n')
  })
})

describe('substituteParts', () => {
  it('marks substituted phrases as hits and joins back to substitute()', async () => {
    const { substituteParts, substitute } = await import('../src/transcript/store')
    const r = (phrase: string) => ({ word: { word: 'this', t: 0, isPointer: true }, terms: [{ id: 1, latex: '', phrase, box: { x: 0, y: 0, w: 0, h: 0 } }] })
    const text = 'this cancels with that one.'
    const res = [r('x squared'), r('2x')]
    const parts = substituteParts(text, res)
    expect(parts).toEqual([
      { text: 'X squared', hit: true },
      { text: ' cancels with ', hit: false },
      { text: '2x', hit: true },
      { text: '.', hit: false },
    ])
    expect(parts.map(p => p.text).join('')).toBe(substitute(text, res))
    expect(substituteParts('no pointer here', [])).toEqual([{ text: 'no pointer here', hit: false }])
  })
})

describe('late resolutions (a held "this" whispered after its sentence ended)', () => {
  it('attach to the segment the word was said in, in word order', () => {
    const tr = createTranscript()
    tr.addResolution(res('that', 300, 'b'))
    tr.addFinal('this cancels with that', 50, 500)
    expect(tr.addResolution(res('this', 100, 'a'))).toBe(true) // arrives after the final
    tr.addFinal('next sentence', 900, 1100)
    const [first, second] = tr.segments()
    expect(substitute(first.text, first.resolutions)).toBe('A cancels with b')
    expect(second.resolutions).toEqual([])
  })
  it('a resolution for a sentence not finished yet still waits for its final', () => {
    const tr = createTranscript()
    tr.addFinal('earlier', 0, 100)
    expect(tr.addResolution(res('this', 900, 'a'))).toBe(false)
    tr.addFinal('this one', 800, 1000)
    expect(tr.segments()[1].resolutions).toHaveLength(1)
  })
})

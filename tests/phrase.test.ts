import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { latexToPlain, positionWords, phraseFor, uniquePhrases } from '../src/core/phrase'
import type { Term } from '../src/core/types'

const box = (cx: number, cy: number) => ({ x: cx - 0.05, y: cy - 0.05, w: 0.1, h: 0.1 })

describe('latexToPlain', () => {
  it.each([
    ['2x', '2x'],
    ['(x + 3)', '(x + 3)'],
    ['\\frac{a}{b}', '(a)/(b)'],
    ['\\frac{x+1}{2}', '(x+1)/(2)'],
    ['\\sqrt{x}', 'sqrt(x)'],
    ['x^{2}', 'x^2'],
    ['a \\cdot b', 'a * b'],
    ['a \\times b', 'a * b'],
    ['\\left( x \\right)', '( x )'],
    ['\\alpha', 'alpha'],
    ['x_{1}', 'x sub 1'],
    ['\\frac{a^{2}}{b}', '(a^2)/(b)'],
    ['\\frac12', '(1)/(2)'],
    ['\\left\\{x\\right\\}', '(x)'],
    ['\\pm 3', 'plus or minus 3'],
    ['x \\le 2', 'x less than or equal to 2'],
    ['\\infty', 'infinity'],
    ['a \\div b', 'a divided by b'],
  ])('%s -> %s', (latex, plain) => expect(latexToPlain(latex)).toBe(plain))
})

describe('positionWords', () => {
  it.each([
    [0.2, 0.2, 'on top left'],
    [0.5, 0.2, 'on top'],
    [0.8, 0.2, 'on top right'],
    [0.2, 0.47, 'on the left'],
    [0.5, 0.47, 'in the middle'],
    [0.8, 0.47, 'on the right'],
    [0.2, 0.8, 'on the bottom left'],
    [0.5, 0.8, 'on the bottom'],
    [0.8, 0.8, 'on the bottom right'],
  ])('centre (%s, %s) -> %s', (cx, cy, words) => expect(positionWords(box(cx, cy))).toBe(words))
})

describe('phraseFor', () => {
  it('speaks the LaTeX and adds where it is', () => {
    expect(phraseFor('\\frac{a}{b}', box(0.8, 0.8))).toBe('the a over b on the bottom right')
    expect(phraseFor('x^2', box(0.5, 0.2))).toBe('the x squared on top')
  })
  it('speaks everyday LaTeX cleanly (no command names, no doubled "the")', () => {
    const on = box(0.5, 0.2)
    expect(phraseFor('\\frac{a^{2}}{b}', on)).toBe('the a squared over b on top')
    expect(phraseFor('\\sqrt{x}', on)).toBe('the square root of x on top')
    expect(phraseFor('\\sqrt[3]{x}', on)).toBe('the cube root of x on top')
    expect(phraseFor('\\sqrt[4]{y}', on)).toBe('the fourth root of y on top')
    expect(phraseFor('\\pm 3', on)).toBe('the plus or minus 3 on top')
  })
  it('matches the positions in the saved demo board', () => {
    const terms: Term[] = JSON.parse(readFileSync('public/fixtures/board-fraction.json', 'utf8')).terms
    expect(terms.map(t => positionWords(t.box))).toEqual(['on top left', 'on top', 'on the bottom'])
    expect(phraseFor(terms[1].latex, terms[1].box)).toBe('the x plus 3 on top')
  })
})

describe('uniquePhrases', () => {
  const t = (id: number, latex: string, phrase: string, cx: number, cy: number): Term => ({ id, latex, phrase, box: box(cx, cy) })

  it('tells apart a numerator and denominator that got the same phrase', () => {
    const out = uniquePhrases([t(1, '2x', 'the 2 x in the middle', 0.5, 0.42), t(2, '2x', 'the 2 x in the middle', 0.5, 0.52)])
    expect(out.map(x => x.phrase)).toEqual(['the upper 2 x in the middle', 'the lower 2 x in the middle'])
  })

  it('uses left and right when the twins sit side by side', () => {
    const out = uniquePhrases([t(1, 'x', 'the x on top', 0.6, 0.2), t(2, 'x', 'the x on top', 0.4, 0.2)])
    expect(out.map(x => x.phrase)).toEqual(['the right x on top', 'the left x on top'])
  })

  it('names three or more twins by order', () => {
    const out = uniquePhrases([0.1, 0.3, 0.5, 0.7].map((cy, i) => t(i + 1, 'y', 'the y on the left', 0.2, cy)))
    expect(out.map(x => x.phrase)).toEqual([
      'the y on the left, first from the top', 'the y on the left, second from the top',
      'the y on the left, third from the top', 'the y on the left, fourth from the top',
    ])
  })

  it('leaves unique phrases, ids, boxes and order alone, and does not mutate the input', () => {
    const input = [t(1, '2x', 'the 2 x on top', 0.5, 0.2), t(2, '3', 'the 3 on the bottom', 0.5, 0.8)]
    const copy = structuredClone(input)
    expect(uniquePhrases(input)).toEqual(copy)
    expect(input).toEqual(copy)
  })

  it('compares phrases ignoring case and spacing', () => {
    const out = uniquePhrases([t(1, '2x', 'The 2 x  in the middle', 0.5, 0.4), t(2, '2x', 'the 2 x in the middle', 0.5, 0.5)])
    expect(new Set(out.map(x => x.phrase.toLowerCase())).size).toBe(2)
  })
})

describe('uniquePhrases across board reads', () => {
  const t = (id: number, cy: number): Term => ({ id, latex: '2x', phrase: 'the 2 x in the middle', box: box(0.5, cy) })

  it('renames from the original phrase when a third twin appears above the pair', () => {
    const first = uniquePhrases([t(1, 0.45), t(2, 0.52)]) // the existing pair, as shown after the earlier read
    const second = uniquePhrases([...first, t(3, 0.4)])   // a new 2x written above both (raw phrase from the server)
    expect(second.map(x => x.phrase)).toEqual([
      'the 2 x in the middle, second from the top',
      'the 2 x in the middle, third from the top',
      'the 2 x in the middle, first from the top',
    ])
  })

  it('gives a lone survivor its plain phrase back when its twin is erased', () => {
    const pair = uniquePhrases([t(1, 0.45), t(2, 0.52)])
    expect(uniquePhrases([pair[1]]).map(x => x.phrase)).toEqual(['the 2 x in the middle'])
  })

  it('gives the same names when run again on its own output', () => {
    const once = uniquePhrases([t(1, 0.45), t(2, 0.52), t(3, 0.4)])
    expect(uniquePhrases(once).map(x => x.phrase)).toEqual(once.map(x => x.phrase))
  })
})

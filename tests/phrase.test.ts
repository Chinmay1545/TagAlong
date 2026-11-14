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
  const on = box(0.5, 0.2)
  it('a term with no tag is spoken only, never a screen position', () => {
    expect(phraseFor('x^2', on)).toBe('x squared')
    expect(phraseFor('x^2', on, 'none')).toBe('x squared')
    expect(phraseFor('x^2', on, 'banana')).toBe('x squared')
    expect(phraseFor('2x', on)).toBe('2x')
  })
  it.each([
    ['top', '2x, in the top'],
    ['bottom', '2x, in the bottom'],
    ['power', '2x, in the power'],
    ['left', '2x, on the left side'],
    ['right', '2x, on the right side'],
    ['bracket', '2x, in the brackets'],
  ])('term tag %s', (tag, out) => expect(phraseFor('2x', on, tag)).toBe(out))
  it.each([
    ['numerator', 'the top: 2x'],
    ['denominator', 'the bottom: 2x'],
    ['fraction', 'the fraction: 2x'],
    ['lhs', 'the left side: 2x'],
    ['rhs', 'the right side: 2x'],
    ['equation', 'the equation: 2x'],
    ['group', 'the brackets: 2x'],
  ])('group tag %s', (tag, out) => expect(phraseFor('2x', on, tag)).toBe(out))
  it('speaks the demo board math naturally', () => {
    const say = (l: string) => phraseFor(l, on)
    expect(say('(x + 3)')).toBe('x plus 3')
    expect(say('2x(x+3)')).toBe('2x times the quantity x plus 3')
    expect(say('2(x+3)')).toBe('2 times the quantity x plus 3')
    expect(say('\\frac{2x(x+3)}{2x}')).toBe('2x times the quantity x plus 3, over 2x')
    expect(say('3x + 5')).toBe('3x plus 5')
    expect(say('(x - 4)')).toBe('x minus 4')
    expect(say('3(x - 4) + 5')).toBe('3 times the quantity x minus 4, plus 5')
    expect(say('(x - 3)(x + 3)')).toBe('the quantity x minus 3, times the quantity x plus 3')
    expect(say('(x + 2)(x + 3)')).toBe('the quantity x plus 2, times the quantity x plus 3')
    expect(say('2x(x + 3)')).toBe('2x times the quantity x plus 3')
    expect(phraseFor('\\frac{x^2-9}{x^2+5x+6} = \\frac{(x-3)(x+3)}{(x+2)(x+3)}', on, 'equation')).toBe(
      'the equation: x squared minus 9, over x squared plus 5x plus 6, equals the quantity x minus 3, times the quantity x plus 3, over the quantity x plus 2, times the quantity x plus 3')
    expect(say('20')).toBe('20')
    expect(say('3x + 5 = 20')).toBe('3x plus 5 equals 20')
    expect(say('x^2')).toBe('x squared')
    expect(say('x = 5')).toBe('x equals 5')
  })
  it('speaks everyday LaTeX cleanly', () => {
    expect(phraseFor('\\frac{a^{2}}{b}', on)).toBe('a squared, over b')
    expect(phraseFor('\\sqrt{x}', on)).toBe('the square root of x')
    expect(phraseFor('\\sqrt[3]{x}', on)).toBe('the cube root of x')
    expect(phraseFor('\\pm 3', on)).toBe('plus or minus 3')
  })
  it('never says a screen position unless the tag is a side of the equation', () => {
    for (const tag of [undefined, 'none', 'top', 'bottom', 'power', 'bracket', 'numerator', 'denominator', 'fraction', 'equation', 'group'])
      for (const l of ['2x', '\\frac{a}{b}', 'x^2'])
        expect(phraseFor(l, box(0.1, 0.1), tag)).not.toMatch(/\b(left|right|middle)\b/)
    expect(phraseFor('5', on, 'left')).toBe('5, on the left side')
  })
  it('the saved demo board follows the contract', () => {
    const terms: Term[] = JSON.parse(readFileSync('public/fixtures/board-fraction.json', 'utf8')).terms
    expect(terms.map(t => t.phrase)).toEqual([
      '2x, in the top', 'x plus 3, in the top', '2x, in the bottom',
      'the top: 2x times the quantity x plus 3', 'the bottom: 2x', 'the fraction: 2x times the quantity x plus 3, over 2x',
    ])
    expect(phraseFor(terms[1].latex, terms[1].box, 'top')).toBe(terms[1].phrase)
    const inside = (g: Term, q: Term) => q.box.x >= g.box.x - 1e-9 && q.box.y >= g.box.y - 1e-9 && q.box.x + q.box.w <= g.box.x + g.box.w + 1e-9 && q.box.y + q.box.h <= g.box.y + g.box.h + 1e-9
    expect([0, 1].every(i => inside(terms[3], terms[i]))).toBe(true)
    expect(inside(terms[4], terms[2])).toBe(true)
    expect(terms.slice(0, 5).every(q => inside(terms[5], q))).toBe(true)
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

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { latexToPlain, positionWords, phraseFor } from '../src/core/phrase'
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

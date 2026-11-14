import { describe, it, expect } from 'vitest'
import { speakMath } from '../src/core/speakMath'

describe('speakMath', () => {
  it.each([
    ['2x', '2 x'],
    ['x^2', 'x squared'],
    ['x²', 'x squared'],
    ['x^3', 'x cubed'],
    ['x^n', 'x to the n'],
    ['a + b', 'a plus b'],
    ['a+b', 'a plus b'],
    ['5 - 3', '5 minus 3'],
    ['x = 4', 'x equals 4'],
    ['a/b', 'a over b'],
    ['a*b', 'a times b'],
    ['a × b', 'a times b'],
    ['a · b', 'a times b'],
    ['(a+b)', 'a plus b'],
    ['sqrt(x)', 'the square root of x'],
    ['√x', 'the square root of x'],
    ['2x^2 + 3x = 5', '2 x squared plus 3 x equals 5'],
    ['the 2x on top left', 'the 2 x on top left'],
    ['photosynthesis', 'photosynthesis'],
    ['well-known  term', 'well-known term'],
    ['top-left', 'top-left'],
    ['x-ray', 'x-ray'],
    ['x-1', 'x minus 1'],
    ['x-y', 'x minus y'],
    ['2-x', '2 minus x'],
    ['3x^2-5x+6', '3 x squared minus 5 x plus 6'],
    ['(x+1)(x-1)', 'x plus 1 times x minus 1'],
    ['f(x)=x²', 'f of x equals x squared'],
  ])('%s -> %s', (i, o) => expect(speakMath(i)).toBe(o))
})

describe('speakMath: factors and fractions', () => {
  it.each([
    ['2x(x+3)', '2 x times x plus 3'],
    ['2(x+3)', '2 times x plus 3'],
    ['(2x * (x+3))/(2x)', '2 x times x plus 3, over 2 x'],
  ])('%s -> %s', (i, o) => expect(speakMath(i)).toBe(o))
})

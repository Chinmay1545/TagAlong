import { describe, it, expect } from 'vitest'
import { toRawX } from '../src/vision/camera'
import { termAt } from '../src/core/resolver'
import type { Term } from '../src/core/types'

const A: Term = { id: 1, latex: 'a', phrase: 'a', box: { x: 0.2, y: 0.4, w: 0.1, h: 0.1 } }
const B: Term = { id: 2, latex: 'b', phrase: 'b', box: { x: 0.6, y: 0.4, w: 0.1, h: 0.1 } }
describe('toRawX', () => {
  it('mirrored flips', () => expect(toRawX(0.75, true)).toBeCloseTo(0.25))
  it('unmirrored passes', () => expect(toRawX(0.75, false)).toBe(0.75))
})
describe('mirror resolution', () => {
  it('raw x 0.25 resolves to left term A', () => {
    expect(termAt([A, B], 0.25, 0.45)?.id).toBe(1)
  })
  it('display x 0.75 on mirrored preview -> raw 0.25 -> A', () => {
    expect(termAt([A, B], toRawX(0.75, true), 0.45)?.id).toBe(1)
  })
})

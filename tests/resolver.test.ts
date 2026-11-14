import { describe, expect, it } from 'vitest'
import { TipBuffer } from '../src/core/tipBuffer'
import { boxDistance, resolvePointer, steadiestTip, termAt, termsAlongPath } from '../src/core/resolver'
import type { Term, TipSample } from '../src/core/types'

const A: Term = { id: 1, latex: '2x', phrase: 'the 2x on top', box: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } }
const B: Term = { id: 2, latex: '3y', phrase: 'the 3y below', box: { x: 0.6, y: 0.2, w: 0.1, h: 0.1 } }

describe('boxDistance / termAt', () => {
  it('measures distance to box', () => {
    expect(boxDistance(A.box, 0.25, 0.25)).toBe(0)
    expect(boxDistance(A.box, 0.35, 0.25)).toBeCloseTo(0.05)
  })
  it('picks nearest term within MAX_DIST', () => {
    expect(termAt([A, B], 0.25, 0.25)?.id).toBe(1)
    expect(termAt([A, B], 0.65, 0.25)?.id).toBe(2)
    expect(termAt([A, B], 0.45, 0.25)).toBeNull() // 0.15 from both, beyond MAX_DIST
    expect(termAt([A, B], 0.32, 0.25)?.id).toBe(1) // 0.02 from A
  })
  it('tie: lowest id wins, not first in array', () => {
    const C: Term = { id: 8, latex: 'c', phrase: 'c', box: { x: 0.44, y: 0.45, w: 0.03, h: 0.1 } } // ends x=0.47
    const D: Term = { id: 7, latex: 'd', phrase: 'd', box: { x: 0.53, y: 0.45, w: 0.03, h: 0.1 } } // starts x=0.53
    expect(termAt([C, D], 0.5, 0.5)?.id).toBe(7)
    expect(termAt([D, C], 0.5, 0.5)?.id).toBe(7)
  })
  it('strictly closer wins regardless of id', () => {
    const C: Term = { id: 1, latex: 'c', phrase: 'c', box: { x: 0.44, y: 0.45, w: 0.03, h: 0.1 } } // 0.03 away
    const D: Term = { id: 9, latex: 'd', phrase: 'd', box: { x: 0.52, y: 0.45, w: 0.03, h: 0.1 } } // 0.02 away
    expect(termAt([C, D], 0.5, 0.5)?.id).toBe(9)
  })
})

describe('steadiestTip', () => {
  const track: TipSample[] = Array.from({ length: 11 }, (_, i) => {
    const t = i * 100
    return t >= 400 && t <= 600 ? { t, x: 0.25, y: 0.25 } : { t, x: 0.05 * i, y: 0.25 }
  })
  it('finds the pause', () => {
    expect(steadiestTip(track, 500)).toEqual({ x: 0.25, y: 0.25 })
  })
  it('handles empty, single, and out-of-window', () => {
    expect(steadiestTip([], 500)).toBeNull()
    expect(steadiestTip([{ t: 450, x: 0.1, y: 0.1 }], 500)).toEqual({ x: 0.1, y: 0.1 })
    expect(steadiestTip(track, 5000)).toBeNull() // no samples in window
  })
})

describe('termsAlongPath', () => {
  it('collects terms in first-touch order without duplicates', () => {
    const slide: TipSample[] = Array.from({ length: 11 }, (_, i) => ({ t: i * 100, x: 0.25 + 0.04 * i, y: 0.25 }))
    expect(termsAlongPath([A, B], slide, 0, 1000).map(t => t.id)).toEqual([1, 2])
  })
})

describe('resolvePointer', () => {
  const fill = (samples: TipSample[]) => {
    const buf = new TipBuffer()
    samples.forEach(s => buf.push(s))
    return buf
  }
  const steady: TipSample[] = Array.from({ length: 11 }, (_, i) => {
    const t = i * 100
    return t >= 400 && t <= 600 ? { t, x: 0.25, y: 0.25 } : { t, x: 0.05 * i, y: 0.25 }
  })
  it('resolves a single pointer word to the steadiest-tip term', () => {
    const r = resolvePointer({ word: 'this', t: 500, isPointer: true }, [A, B], fill(steady))
    expect(r.terms[0].id).toBe(1)
  })
  it('stays silent with an empty buffer', () => {
    expect(resolvePointer({ word: 'this', t: 500, isPointer: true }, [A, B], new TipBuffer()).terms).toEqual([])
  })
  it('"these" collects terms along the path', () => {
    const slide: TipSample[] = Array.from({ length: 11 }, (_, i) => ({ t: i * 100, x: 0.25 + 0.04 * i, y: 0.25 }))
    const r = resolvePointer({ word: 'These', t: 500, isPointer: true }, [A, B], fill(slide))
    expect(r.terms.map(t => t.id)).toEqual([1, 2])
  })
  it('returns no terms when isPointer is false, even when pointing at A', () => {
    const r = resolvePointer({ word: 'this', t: 500, isPointer: false }, [A, B], fill(steady))
    expect(r.terms).toEqual([])
  })
  it('"Those." (with punctuation) takes the path branch', () => {
    const slide: TipSample[] = Array.from({ length: 11 }, (_, i) => ({ t: i * 100, x: 0.25 + 0.04 * i, y: 0.25 }))
    const r = resolvePointer({ word: 'Those.', t: 500, isPointer: true }, [A, B], fill(slide))
    expect(r.terms.map(t => t.id)).toEqual([1, 2])
  })
})

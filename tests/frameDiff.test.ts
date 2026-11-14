import { describe, it, expect } from 'vitest'
import { frameChanged, toGraySmall } from '../src/core/frameDiff'

const base = () => new Uint8Array(64 * 36).fill(100)
describe('frameChanged', () => {
  it('identical -> false', () => expect(frameChanged(base(), base())).toBe(false))
  it('+20 -> true', () => expect(frameChanged(base(), base().map(v => v + 20))).toBe(true))
  it('+5 -> false', () => expect(frameChanged(base(), base().map(v => v + 5))).toBe(false))
  it('length mismatch -> true', () => expect(frameChanged(base(), new Uint8Array(3))).toBe(true))
})
describe('toGraySmall', () => {
  it('solid colour yields 64*36 expected gray', () => {
    const w = 128, h = 72
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) rgba.set([200, 100, 50, 255], i * 4)
    const g = toGraySmall(rgba, w, h)
    expect(g.length).toBe(64 * 36)
    const exp = Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50)
    expect(Math.abs(g[0] - exp)).toBeLessThanOrEqual(1)
    expect(Math.abs(g[g.length - 1] - exp)).toBeLessThanOrEqual(1)
  })
})

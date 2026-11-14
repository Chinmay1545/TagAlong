import { describe, it, expect } from 'vitest'
import { changedRegion, frameChanged, hideCells, toGraySmall } from '../src/core/frameDiff'

const base = () => new Uint8Array(64 * 36).fill(100)
describe('frameChanged', () => {
  it('identical -> false', () => expect(frameChanged(base(), base())).toBe(false))
  it('+20 -> true', () => expect(frameChanged(base(), base().map(v => v + 20))).toBe(true))
  it('+5 -> false', () => expect(frameChanged(base(), base().map(v => v + 5))).toBe(false))
  it('length mismatch -> true', () => expect(frameChanged(base(), new Uint8Array(3))).toBe(true))
})
describe('changedRegion', () => {
  it('identical frames -> null', () => expect(changedRegion(base(), base())).toBeNull())
  it('a patch that changed -> its box in 0..1 coords', () => {
    const b = base()
    for (let y = 18; y < 27; y++) for (let x = 32; x < 48; x++) b[y * 64 + x] = 20 // new ink, lower right of centre
    expect(changedRegion(base(), b)).toEqual({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 })
  })
  it('ignores small noise below the cell threshold', () => expect(changedRegion(base(), base().map(v => v + 5))).toBeNull())
  it('length mismatch -> the whole frame', () => expect(changedRegion(base(), new Uint8Array(3))).toEqual({ x: 0, y: 0, w: 1, h: 1 }))
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

describe('hideCells (laser dot masking)', () => {
  const at = (cx: number, cy: number) => ({ x: (cx + 0.5) / 64, y: (cy + 0.5) / 36 })
  it('a hidden dot is no change at all', () => {
    const before = base()
    const now = base()
    now[20 * 64 + 40] = 255
    now[20 * 64 + 41] = 240
    expect(changedRegion(before, now)).not.toBeNull()
    expect(changedRegion(before, hideCells(now, before, [at(40, 20)]))).toBeNull()
  })
  it('only hides the cells around the point: ink elsewhere still counts', () => {
    const before = base()
    const now = base()
    now[20 * 64 + 40] = 255 // laser
    now[5 * 64 + 5] = 10 // new ink far away
    expect(changedRegion(before, hideCells(now, before, [at(40, 20)]))).toEqual({ x: 5 / 64, y: 5 / 36, w: 1 / 64, h: 1 / 36 })
  })
  it('hides one cell on each side of the point by default, and no further', () => {
    const before = base()
    const now = base().fill(200)
    hideCells(now, before, [at(40, 20)])
    expect([now[19 * 64 + 39], now[21 * 64 + 41], now[20 * 64 + 40]]).toEqual([100, 100, 100])
    expect([now[18 * 64 + 40], now[20 * 64 + 42]]).toEqual([200, 200])
  })
  it('with no earlier frame, fills from the cells around the dot', () => {
    const now = base()
    now[20 * 64 + 40] = 255
    expect(hideCells(now, null, [at(40, 20)])[20 * 64 + 40]).toBe(100)
  })
  it('handles points at the corners and outside the frame', () => {
    const before = base()
    const now = base()
    now[0] = 255
    now[35 * 64 + 63] = 255
    hideCells(now, before, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1.4, y: -0.2 }])
    expect(changedRegion(before, now)).toBeNull()
  })
  it('no points: the frame is untouched', () => {
    const now = base()
    now[7] = 3
    expect(Array.from(hideCells(now, base(), []))).toEqual(Array.from(now))
  })
})

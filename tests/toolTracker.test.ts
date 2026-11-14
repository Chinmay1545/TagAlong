import { afterEach, describe, expect, it, vi } from 'vitest'
import { DETECT_WIDTH, startToolTracker } from '../src/vision/toolTracker'
import type { PointerPoint } from '../src/vision/pointer'
import { BOARD, laserDot, makeFrame, type TestFrame } from './helpers/frames'

afterEach(() => vi.unstubAllGlobals())

// A fake camera: `next()` is the picture the video shows; `step()` runs one animation frame.
function harness(next: () => TestFrame) {
  const frames: (() => void)[] = []
  const drawn: number[][] = []
  const video = { readyState: 4, videoWidth: 1280, videoHeight: 720, currentTime: 0 } as HTMLVideoElement
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({
      drawImage: (_v: unknown, ...rest: number[]) => { drawn.push(rest) },
      getImageData: () => next(),
    }),
  }
  vi.stubGlobal('document', { createElement: () => canvas })
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => { frames.length = 0 })
  let now = 0
  vi.stubGlobal('performance', { now: () => now })
  const got: PointerPoint[] = []
  const stop = startToolTracker(video, p => got.push(p))
  const step = (newFrame = true) => {
    now += 33
    if (newFrame) (video as { currentTime: number }).currentTime += 0.033
    frames.shift()?.()
  }
  return { got, step, stop, canvas, drawn, pending: () => frames.length }
}

describe('tool tracker: runs the laser detector on the camera', () => {
  it('pushes laser points for a laser on the board, on a small copy of the frame', () => {
    let x = 200
    const h = harness(() => { const f = makeFrame(BOARD, DETECT_WIDTH, 270); laserDot(f, x++, 180); return f })
    for (let i = 0; i < 5; i++) h.step()
    expect(h.got.length).toBeGreaterThanOrEqual(3)
    expect(h.got.every(p => p.kind === 'laser')).toBe(true)
    expect(h.got.at(-1)!.x).toBeCloseTo(204 / DETECT_WIDTH, 2)
    expect(h.got.at(-1)!.t).toBe(5 * 33)
    expect([h.canvas.width, h.canvas.height]).toEqual([DETECT_WIDTH, 270]) // 16:9 kept
    expect(h.drawn[0]).toEqual([0, 0, DETECT_WIDTH, 270])
    h.stop()
  })
  it('pushes nothing for a board with no laser', () => {
    const h = harness(() => makeFrame(BOARD, DETECT_WIDTH, 270))
    for (let i = 0; i < 5; i++) h.step()
    expect(h.got).toEqual([])
    h.stop()
  })
  it('skips a camera frame it has already looked at', () => {
    let reads = 0
    const h = harness(() => { reads++; return makeFrame(BOARD, DETECT_WIDTH, 270) })
    h.step()
    h.step(false)
    h.step(false)
    expect(reads).toBe(1)
    h.stop()
  })
  it('one bad frame does not stop the tracker', () => {
    let n = 0
    const h = harness(() => {
      if (++n === 2) throw new Error('boom')
      const f = makeFrame(BOARD, DETECT_WIDTH, 270); laserDot(f, 200, 180); return f
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 6; i++) h.step()
    expect(h.got.length).toBeGreaterThanOrEqual(2)
    h.stop()
  })
  it('stop ends the loop', () => {
    const h = harness(() => makeFrame(BOARD, DETECT_WIDTH, 270))
    h.step()
    h.stop()
    expect(h.pending()).toBe(0)
  })
})

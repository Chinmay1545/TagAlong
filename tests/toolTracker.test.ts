import { afterEach, describe, expect, it, vi } from 'vitest'
import { DETECT_WIDTH, startToolTracker } from '../src/vision/toolTracker'
import type { PointerPoint } from '../src/vision/pointer'
import { BOARD, disc, laserDot, line, makeFrame, type TestFrame } from './helpers/frames'
import type { HandInfo } from '../src/vision/stick'

afterEach(() => vi.unstubAllGlobals())

// A fake camera: `next()` is the picture the video shows; `step()` runs one animation frame.
function harness(next: () => TestFrame, getHand?: () => HandInfo | null, tools?: { laser: boolean; stick: boolean }) {
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
  const stop = startToolTracker(video, p => got.push(p), getHand, tools)
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
  it('pushes stick points for a stick held in the tracked hand', () => {
    let n = 0
    const scene = () => {
      const f = makeFrame(BOARD, DETECT_WIDTH, 270)
      if (++n > 5) { // first the empty board, then the hand, arm and stick
        line(f, 380, 180, 510, 310, 24, [60, 70, 110])
        disc(f, 380, 180, 16, [200, 150, 125])
        line(f, 380, 180, 200 + Math.max(0, 10 - n) * 8, 70, 4, [120, 85, 50]) // swings in, then rests
      }
      return f
    }
    let now = 0
    const h = harness(scene, () => ({ x: 380 / 480, y: 180 / 270, r: 16 / 480, fx: Math.SQRT1_2, fy: Math.SQRT1_2, t: now }))
    for (let i = 0; i < 14; i++) { now += 33; h.step() }
    const sticks = h.got.filter(p => p.kind === 'stick')
    expect(sticks.length).toBeGreaterThanOrEqual(3)
    expect(sticks.at(-1)!.x).toBeCloseTo(200 / 480, 1)
    expect(sticks.at(-1)!.y).toBeCloseTo(70 / 270, 1)
    h.stop()
  })
  it('a hand last seen long ago is not used', () => {
    const calls: (HandInfo | null)[] = []
    let n = 0
    const scene = () => { const f = makeFrame(BOARD, DETECT_WIDTH, 270); if (++n > 5) line(f, 60, 150, 300, 150, 4, [40, 40, 45]); return f }
    // A stale hand right at the end of a line: if it were used, the line would look held.
    const h = harness(scene, () => { const hand = { x: 300 / 480, y: 150 / 270, r: 16 / 480, fx: 1, fy: 0, t: -5000 }; calls.push(hand); return hand })
    for (let i = 0; i < 10; i++) h.step()
    expect(calls.length).toBeGreaterThan(0)
    expect(h.got).toEqual([])
    h.stop()
  })
  it('with the laser switched off, a laser on the board gives no points', () => {
    let x = 200
    const h = harness(() => { const f = makeFrame(BOARD, DETECT_WIDTH, 270); laserDot(f, x++, 180); return f }, undefined, { laser: false, stick: true })
    for (let i = 0; i < 6; i++) h.step()
    expect(h.got).toEqual([])
    h.stop()
  })
  it('with the stick switched off, a stick gives no points but a laser still does', () => {
    let n = 0
    const scene = () => {
      const f = makeFrame(BOARD, DETECT_WIDTH, 270)
      if (++n > 5) {
        line(f, 380, 180, 510, 310, 24, [60, 70, 110])
        disc(f, 380, 180, 16, [200, 150, 125])
        line(f, 380, 180, 200 + Math.max(0, 10 - n) * 8, 70, 4, [120, 85, 50])
        laserDot(f, 100, 60)
      }
      return f
    }
    let now = 0
    const h = harness(scene, () => ({ x: 380 / 480, y: 180 / 270, r: 16 / 480, fx: Math.SQRT1_2, fy: Math.SQRT1_2, t: now }), { laser: true, stick: false })
    for (let i = 0; i < 14; i++) { now += 33; h.step() }
    expect(h.got.length).toBeGreaterThan(0)
    expect(h.got.every(p => p.kind === 'laser')).toBe(true)
    h.stop()
  })
  it('with both switched off, it does no work at all', () => {
    let reads = 0
    const h = harness(() => { reads++; return makeFrame(BOARD, DETECT_WIDTH, 270) }, undefined, { laser: false, stick: false })
    for (let i = 0; i < 5; i++) h.step()
    expect(reads).toBe(0)
    expect(h.pending()).toBe(0)
    expect(h.got).toEqual([])
    h.stop()
  })
  it('stop ends the loop', () => {
    const h = harness(() => makeFrame(BOARD, DETECT_WIDTH, 270))
    h.step()
    h.stop()
    expect(h.pending()).toBe(0)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMousePointer } from '../src/vision/mousePointer'
import type { PointerPoint } from '../src/vision/pointer'

afterEach(() => vi.useRealTimers())
const rect = { left: 100, top: 50, width: 800, height: 400 }

describe('mouse pointer (demo mode)', () => {
  it('pushes a mouse point in board coordinates when the mouse moves', () => {
    vi.useFakeTimers()
    const got: PointerPoint[] = []
    const m = createMousePointer(p => got.push(p))
    m.move(500, 250, rect)
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ kind: 'mouse', x: 0.5, y: 0.5, confidence: 1 })
    m.stop()
  })
  it('a resting mouse keeps pointing: points keep coming with fresh times', () => {
    vi.useFakeTimers()
    const got: PointerPoint[] = []
    const m = createMousePointer(p => got.push(p))
    m.move(500, 250, rect)
    vi.advanceTimersByTime(1000)
    expect(got.length).toBeGreaterThanOrEqual(15)
    expect(got.every(p => p.x === 0.5 && p.y === 0.5)).toBe(true)
    expect(got.at(-1)!.t).toBeGreaterThan(got[0].t + 900)
    m.stop()
  })
  it('stops when the mouse leaves the stage', () => {
    vi.useFakeTimers()
    const got: PointerPoint[] = []
    const m = createMousePointer(p => got.push(p))
    m.move(500, 250, rect)
    m.leave()
    const n = got.length
    vi.advanceTimersByTime(1000)
    expect(got).toHaveLength(n)
    m.stop()
  })
  it('a move outside the stage counts as leaving', () => {
    vi.useFakeTimers()
    const got: PointerPoint[] = []
    const m = createMousePointer(p => got.push(p))
    m.move(500, 250, rect)
    m.move(10, 10, rect)
    const n = got.length
    vi.advanceTimersByTime(1000)
    expect(got).toHaveLength(n)
    expect(n).toBe(1)
    m.stop()
  })
  it('stop ends the repeats', () => {
    vi.useFakeTimers()
    const got: PointerPoint[] = []
    const m = createMousePointer(p => got.push(p))
    m.move(500, 250, rect)
    m.stop()
    vi.advanceTimersByTime(1000)
    expect(got).toHaveLength(1)
  })
})

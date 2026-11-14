import { describe, expect, it, vi } from 'vitest'
import { drawPointerDot } from '../src/ui/pointerDot'
import type { PointerPoint } from '../src/vision/pointer'

function fakeCtx() {
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 0, font: '',
    beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), roundRect: vi.fn(),
    fillText: vi.fn(), measureText: vi.fn((s: string) => ({ width: s.length * 6 })),
  }
}
const p = (kind: PointerPoint['kind'], x = 0.25, y = 0.5): PointerPoint => ({ kind, x, y, confidence: 1, t: 0 })
const same = (x: number) => x

describe('pointer dot on the judge screen', () => {
  it('draws the dot at the point and writes the kind next to it', () => {
    for (const kind of ['finger', 'stick', 'laser', 'mouse'] as const) {
      const ctx = fakeCtx()
      drawPointerDot(ctx as unknown as CanvasRenderingContext2D, p(kind), 800, 400, same)
      expect(ctx.arc.mock.calls[0].slice(0, 2)).toEqual([200, 200])
      expect(ctx.fillText.mock.calls[0][0]).toBe(kind)
    }
  })
  it('draws in mirrored space when the stage is mirrored', () => {
    const ctx = fakeCtx()
    drawPointerDot(ctx as unknown as CanvasRenderingContext2D, p('laser'), 800, 400, x => 1 - x)
    expect(ctx.arc.mock.calls[0].slice(0, 2)).toEqual([600, 200])
  })
  it('keeps the label inside the picture at the right edge', () => {
    const ctx = fakeCtx()
    drawPointerDot(ctx as unknown as CanvasRenderingContext2D, p('finger', 0.99, 0.5), 800, 400, same)
    const [x, , w] = ctx.roundRect.mock.calls[0] as number[]
    expect(x + w).toBeLessThanOrEqual(800)
  })
})

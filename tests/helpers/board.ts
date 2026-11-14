import type { Term } from '../../src/core/types'
import type { AnyPoint, PointerKind } from '../../src/vision/pointer'

// A small but realistic board:   2x    ( x + 3 )
//                                       2x
// The bracket group has its own box, and so do the x and the 3 inside it.
export const T1: Term = { id: 1, latex: '2x', phrase: 'the 2x on top left', box: { x: 0.24, y: 0.21, w: 0.1, h: 0.15 } }
export const G: Term = { id: 2, latex: '(x+3)', phrase: 'the x plus 3 group', box: { x: 0.44, y: 0.21, w: 0.23, h: 0.15 } }
export const T3: Term = { id: 3, latex: '2x', phrase: 'the 2x on the bottom', box: { x: 0.44, y: 0.6, w: 0.1, h: 0.15 } }
export const X: Term = { id: 4, latex: 'x', phrase: 'the x in the group', box: { x: 0.47, y: 0.24, w: 0.04, h: 0.09 } }
export const N3: Term = { id: 5, latex: '3', phrase: 'the 3 in the group', box: { x: 0.6, y: 0.24, w: 0.04, h: 0.09 } }
export const BOARD_TERMS: Term[] = [T1, G, T3, X, N3]
export const centre = (t: Term) => ({ x: t.box.x + t.box.w / 2, y: t.box.y + t.box.h / 2 })

// Seeded random numbers, so a failing random case fails the same way every run.
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// The pointer rests at (x, y) from t0 to t1. jitter: how far each point may be off, per axis.
export function rest(kind: PointerKind, x: number, y: number, t0: number, t1: number, jitter = 0, stepMs = 33, rand: () => number = rng(7)): AnyPoint[] {
  const out: AnyPoint[] = []
  for (let t = t0; t <= t1; t += stepMs) out.push({ kind, x: x + (rand() * 2 - 1) * jitter, y: y + (rand() * 2 - 1) * jitter, confidence: 1, t })
  return out
}

// The pointer moves in a straight line from a to b between t0 and t1.
export function move(kind: PointerKind, a: { x: number; y: number }, b: { x: number; y: number }, t0: number, t1: number, stepMs = 33): AnyPoint[] {
  const out: AnyPoint[] = []
  for (let t = t0; t <= t1; t += stepMs) {
    const u = t1 === t0 ? 1 : (t - t0) / (t1 - t0)
    out.push({ kind, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, confidence: 1, t })
  }
  return out
}

export const inOrder = (...tracks: AnyPoint[][]): AnyPoint[] => tracks.flat().sort((a, b) => a.t - b.t)

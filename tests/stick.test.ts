import { describe, expect, it } from 'vitest'
import { createStickTracker, handInfo, type HandInfo } from '../src/vision/stick'
import type { PointerPoint } from '../src/vision/pointer'
import { BLACK_INK, BOARD, DARK, H, SKIN, W, addNoise, disc, line, makeFrame, type RGB, type TestFrame } from './helpers/frames'

// A plain stick or ruler with no tape on it. The detector learns what the board looks like, then looks for
// a long, thin, straight new thing that is held: it starts at the hand (or the arm, or the picture's edge).
const WOOD: RGB = [120, 85, 50]
const SLEEVE: RGB = [60, 70, 110]

function board(bg: RGB = BOARD) {
  const f = makeFrame(bg)
  line(f, 60, 50, 150, 50, 3, BLACK_INK) // writing
  line(f, 70, 80, 110, 110, 3, BLACK_INK)
  line(f, 150, 200, 330, 200, 3, BLACK_INK) // a long fraction bar, already on the board
  return f
}
// A hand at (hx, hy) with its arm leaving the picture at the bottom right.
function person(f: TestFrame, hx: number, hy: number, armWidth = 24) {
  line(f, hx, hy, hx + 130, hy + 130, armWidth, SLEEVE)
  disc(f, hx, hy, 16, SKIN)
  return f
}
// What the hand tracker would report for that hand: centre, size, and which way the arm leaves.
const hand = (hx: number, hy: number, t = 0): HandInfo => ({ x: hx / W, y: hy / H, r: 16 / W, fx: Math.SQRT1_2, fy: Math.SQRT1_2, t })

// A real stick moves: it swings in over the first few frames and then rests. `sw(i)` is how far (in pixels)
// the tip still is from its resting place on frame i.
const sw = (i: number) => Math.max(0, 5 - i) * 8

// Shows the board for a second, then the scene for `frames` frames. Returns every point reported.
function run(scene: (i: number) => TestFrame, getHand: (i: number) => HandInfo | null, frames = 10, bg: RGB = BOARD, noise = 0) {
  const tr = createStickTracker()
  let t = 0
  for (let i = 0; i < 30; i++, t += 33) tr.update(noise ? addNoise(board(bg), noise, i + 1) : board(bg), t, null)
  const got: (PointerPoint | null)[] = []
  for (let i = 0; i < frames; i++, t += 33) got.push(tr.update(noise ? addNoise(scene(i), noise, 100 + i) : scene(i), t, getHand(i)))
  return { got, last: got.at(-1) ?? null, tr, t }
}
const near = (p: PointerPoint | null, x: number, y: number, tol = 0.025) => {
  expect(p).not.toBeNull()
  expect(Math.abs(p!.x - x / W)).toBeLessThan(tol)
  expect(Math.abs(p!.y - y / H)).toBeLessThan(tol * (W / H))
}

describe('stick tip detector (no tape)', () => {
  it('finds the far end of a stick held in the hand', () => {
    const { got, last } = run(i => { const f = person(board(), 380, 180); line(f, 380, 180, 200 + sw(i), 70, 4, WOOD); return f }, () => hand(380, 180))
    expect(got[0]).toBeNull() // one frame is not enough
    expect(last).toMatchObject({ kind: 'stick' })
    near(last, 200, 70)
    expect(last!.confidence).toBeGreaterThan(0)
  })
  it('the dot is on the tip, not on the hand', () => {
    const { last } = run(i => { const f = person(board(), 380, 180); line(f, 380, 180, 120, 150 - sw(i), 4, WOOD); return f }, () => hand(380, 180))
    near(last, 120, 150)
    expect(Math.hypot(last!.x - 380 / W, last!.y - 180 / H)).toBeGreaterThan(0.3)
  })
  it('works whichever way the stick points: up, left, down-left', () => {
    for (const [tx, ty] of [[370, 30], [150, 185], [250, 250]]) {
      const { last } = run(i => { const f = person(board(), 380, 150); line(f, 380, 150, tx - sw(i), ty, 4, WOOD); return f }, () => hand(380, 150))
      near(last, tx, ty)
    }
  })
  it('follows the tip as the stick moves', () => {
    const tipX = (i: number) => 150 + i * 6
    const { got } = run(i => { const f = person(board(), 380, 180); line(f, 380, 180, tipX(i), 70, 4, WOOD); return f }, () => hand(380, 180), 16)
    near(got[15], tipX(15), 70)
    expect(got.slice(4).every(Boolean)).toBe(true) // every frame, once the tip has been seen to move
  })
  it('a light stick on a dark board', () => {
    const { last } = run(i => { const f = person(board(DARK), 380, 180); line(f, 380, 180, 200 + sw(i), 70, 4, [230, 225, 200]); return f }, () => hand(380, 180), 10, DARK)
    near(last, 200, 70)
  })
  it('survives camera noise', () => {
    const { last } = run(i => { const f = person(board(), 380, 180); line(f, 380, 180, 200 + sw(i), 70, 4, WOOD); return f }, () => hand(380, 180), 10, BOARD, 6)
    near(last, 200, 70, 0.035)
  })
  it('a stick held still keeps being reported for five seconds', () => {
    const scene = (i: number) => { const f = person(board(), 380, 180); line(f, 380, 180, 200 + sw(i), 70, 4, WOOD); return f }
    const { got } = run(scene, () => hand(380, 180), 150)
    expect(got.filter(Boolean).length).toBeGreaterThanOrEqual(145)
    near(got.at(-1)!, 200, 70)
  })
})

describe('stick detector: when the hand is not tracked', () => {
  it('a stick reaching in from the edge of the picture: the tip is the end inside', () => {
    const { last } = run(i => { const f = board(); line(f, 479, 230, 250 + sw(i), 100, 4, WOOD); return f }, () => null)
    near(last, 250, 100)
  })
  it('a stick held in a fist the hand tracker missed: the tip is the end away from the arm', () => {
    const { last } = run(i => { const f = person(board(), 380, 180); line(f, 380, 180, 200 + sw(i), 70, 4, WOOD); return f }, () => null)
    near(last, 200, 70)
  })
})

describe('stick detector: things that are not a stick', () => {
  const none = (r: { got: (PointerPoint | null)[] }) => expect(r.got.every(p => p === null)).toBe(true)

  it('an empty board: nothing', () => none(run(() => board(), () => null)))
  it('a hand and arm with no stick: nothing', () => none(run(() => person(board(), 380, 180), () => hand(380, 180))))
  it('a pointing finger is too short to be a stick', () => {
    none(run(() => { const f = person(board(), 380, 180); line(f, 380, 180, 352, 160, 5, SKIN); return f }, () => hand(380, 180)))
  })
  it('a marker pen in the hand is too short', () => {
    none(run(() => { const f = person(board(), 380, 180); line(f, 380, 180, 345, 165, 4, BLACK_INK); return f }, () => hand(380, 180)))
  })
  it('a finger on the end of a fraction bar that was already on the board: nothing', () => {
    none(run(() => person(board(), 340, 205), () => hand(340, 205)))
  })
  it('a long straight line just drawn, with the hand moved away: nothing', () => {
    none(run(() => { const f = person(board(), 400, 60); line(f, 60, 150, 300, 150, 3, BLACK_INK); return f }, () => hand(400, 60)))
    none(run(() => { const f = board(); line(f, 60, 150, 300, 150, 3, BLACK_INK); return f }, () => null))
  })
  it('a line just drawn, with the hand still on its end, is not a stick (a stick moves, ink does not)', () => {
    // The line grows from x=60 to the pen in the hand, then the hand rests on its end.
    const penX = (i: number) => Math.min(300, 120 + i * 30)
    none(run(i => { const f = person(board(), penX(i) + 10, 150); line(f, 60, 150, penX(i), 150, 3, BLACK_INK); return f }, i => hand(penX(i) + 10, 150), 40))
  })
  it('a stick-like thing that never moves is not reported; once it moves, it is', () => {
    const tr = createStickTracker()
    let t = 0
    for (let i = 0; i < 30; i++, t += 33) tr.update(board(), t, null)
    const scene = (tipX: number) => { const f = person(board(), 380, 180); line(f, 380, 180, tipX, 70, 4, WOOD); return f }
    for (let i = 0; i < 20; i++, t += 33) expect(tr.update(scene(200), t, hand(380, 180))).toBeNull()
    let last: PointerPoint | null = null
    for (let i = 0; i < 6; i++, t += 33) last = tr.update(scene(200 - i * 6), t, hand(380, 180))
    near(last, 170, 70)
  })
  it('a thin arm seen from far away is not a stick', () => {
    none(run(() => person(board(), 380, 180, 7), () => hand(380, 180)))
  })
  it('a curved cable is not a stick', () => {
    none(run(() => {
      const f = person(board(), 380, 180)
      for (let a = 0; a < 60; a++) { // an arc bulging far from a straight line
        const u = a / 60
        disc(f, 380 - 200 * u, 180 - 90 * Math.sin(Math.PI * u), 2, BLACK_INK)
      }
      return f
    }, () => hand(380, 180)))
  })
  it('the lights change: nothing, and it works again afterwards', () => {
    const dim = (f: TestFrame) => { for (let i = 0; i < f.data.length; i++) if (i % 4 !== 3) f.data[i] = f.data[i] * 0.55; return f }
    const tr = createStickTracker()
    let t = 0
    for (let i = 0; i < 30; i++, t += 33) tr.update(board(), t, null)
    for (let i = 0; i < 30; i++, t += 33) expect(tr.update(dim(board()), t, null)).toBeNull()
    let last: PointerPoint | null = null
    for (let i = 0; i < 10; i++, t += 33) {
      const f = person(board(), 380, 180); line(f, 380, 180, 200 + sw(i), 70, 4, WOOD)
      last = tr.update(dim(f), t, hand(380, 180))
    }
    near(last, 200, 70)
  })
  it('a stick that was put down and left is forgotten', () => {
    const scene = (i: number) => { const f = board(); line(f, 479, 230, 250 + sw(i), 100, 4, WOOD); return f }
    const { tr, t, last: before } = run(scene, () => null, 10)
    expect(before).not.toBeNull()
    let last: PointerPoint | null = null
    const still = scene(99)
    for (let i = 0; i < 600; i++) last = tr.update(still, t + i * 100, null) // one minute, not moving
    expect(last).toBeNull()
  })
})

describe('handInfo: from the hand tracker landmarks', () => {
  // 21 landmarks: wrist at index 0, middle knuckle at index 9. Only those two and the spread matter here.
  const marks = Array.from({ length: 21 }, (_, i) => ({ x: 0.5 + (i % 5) * 0.01, y: 0.5 - Math.floor(i / 5) * 0.02 }))
  marks[0] = { x: 0.52, y: 0.6 } // wrist below
  marks[9] = { x: 0.52, y: 0.5 } // knuckle above
  it('gives the centre, the size and the direction the arm leaves', () => {
    const h = handInfo(marks, 16 / 9, 123)!
    expect(h.t).toBe(123)
    expect(h.x).toBeGreaterThan(0.5)
    expect(h.x).toBeLessThan(0.55)
    expect(h.r).toBeGreaterThan(0.01)
    expect(h.fx).toBeCloseTo(0, 5)
    expect(h.fy).toBeCloseTo(1, 5) // the arm leaves downwards
  })
  it('is null without a full hand', () => {
    expect(handInfo(undefined, 16 / 9, 0)).toBeNull()
    expect(handInfo(marks.slice(0, 5), 16 / 9, 0)).toBeNull()
  })
})

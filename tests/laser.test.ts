import { describe, expect, it } from 'vitest'
import { createLaserTracker, findLaserDots } from '../src/vision/laser'
import { LASER_STATIC_WEAK_MS } from '../src/core/config'
import { BLACK_INK, BLOWN, BOARD, DARK, H, RED_INK, W, addNoise, clone, disc, laserDot, line, makeFrame, rect, setPx } from './helpers/frames'

// A board with some writing on it, in black and red marker.
function board(bg = BOARD) {
  const f = makeFrame(bg)
  line(f, 60, 60, 160, 60, 3, BLACK_INK)
  line(f, 60, 90, 120, 120, 3, BLACK_INK)
  line(f, 250, 80, 330, 80, 3, RED_INK) // a red underline
  line(f, 260, 120, 290, 150, 3, RED_INK)
  return f
}

describe('findLaserDots: one frame', () => {
  it('finds a red laser dot on a whiteboard, at the right place', () => {
    const f = board()
    laserDot(f, 200, 180)
    const dots = findLaserDots(f)
    expect(dots).toHaveLength(1)
    expect(dots[0].x).toBeCloseTo(200 / W, 2)
    expect(dots[0].y).toBeCloseTo(180 / H, 2)
    expect(dots[0].colour).toBe('red')
    expect(dots[0].confidence).toBeGreaterThan(0.5)
  })
  it('finds a green laser dot', () => {
    const f = board()
    laserDot(f, 400, 60, 'green')
    const dots = findLaserDots(f)
    expect(dots).toHaveLength(1)
    expect(dots[0].colour).toBe('green')
    expect(dots[0].x).toBeCloseTo(400 / W, 2)
  })
  it('finds a laser on a dark board', () => {
    const f = makeFrame(DARK)
    laserDot(f, 100, 100)
    expect(findLaserDots(f)).toHaveLength(1)
  })
  it('finds a tiny dot (two pixels) and a big bloomed one', () => {
    const tiny = board()
    setPx(tiny, 200, 180, [255, 90, 100])
    setPx(tiny, 201, 180, [255, 90, 100])
    expect(findLaserDots(tiny)).toHaveLength(1)
    const big = board()
    laserDot(big, 200, 180, 'red', 6)
    expect(findLaserDots(big)).toHaveLength(1)
  })
  it('survives camera noise', () => {
    const f = board()
    laserDot(f, 200, 180)
    const dots = findLaserDots(addNoise(f, 6))
    expect(dots).toHaveLength(1)
    expect(dots[0].x).toBeCloseTo(200 / W, 2)
  })
  it('a board with no laser: nothing, with red and black ink on it', () => {
    expect(findLaserDots(board())).toEqual([])
    expect(findLaserDots(addNoise(board(), 6))).toEqual([])
  })
  it('red marker ink is not a laser: it is darker than the board, a laser is brighter', () => {
    const f = board()
    disc(f, 200, 180, 3, RED_INK) // a red ink dot the size of a laser dot
    expect(findLaserDots(f)).toEqual([])
    const bright = board()
    disc(bright, 200, 180, 3, [215, 60, 60]) // fresh, bright red ink: still no brighter than the board around it
    expect(findLaserDots(bright)).toEqual([])
  })
  it('ignores big bright areas: glare, a window, a red shirt', () => {
    const glare = board()
    disc(glare, 240, 135, 40, [255, 255, 255])
    expect(findLaserDots(glare)).toEqual([])
    const shirt = board()
    rect(shirt, 300, 100, 120, 170, [255, 70, 80])
    expect(findLaserDots(shirt)).toEqual([])
    const reflection = board()
    disc(reflection, 240, 135, 14, [255, 110, 110]) // a red reflection far bigger than a dot
    expect(findLaserDots(reflection)).toEqual([])
  })
  it('ignores a long thin red streak', () => {
    const f = makeFrame(DARK)
    line(f, 100, 100, 112, 100, 2, [255, 80, 90])
    expect(findLaserDots(f)).toEqual([])
  })
  it('can be told to look for one colour only', () => {
    const f = board()
    laserDot(f, 200, 180, 'green')
    expect(findLaserDots(f, { colours: ['red'] })).toEqual([])
    expect(findLaserDots(f, { colours: ['green'] })).toHaveLength(1)
  })
  it('works on any frame size', () => {
    const f = makeFrame(BOARD, 320, 180)
    laserDot(f, 160, 90, 'red', 2)
    const dots = findLaserDots(f)
    expect(dots[0].x).toBeCloseTo(0.5, 2)
    expect(dots[0].y).toBeCloseTo(0.5, 2)
  })
})

describe('laser tracker: across frames', () => {
  const withDot = (x: number, y: number, bg = BOARD, colour: 'red' | 'green' = 'red') => { const f = board(bg); laserDot(f, x, y, colour); return f }

  it('reports a dot only once it has been seen two frames in a row', () => {
    const tr = createLaserTracker()
    expect(tr.update(withDot(200, 180), 0)).toBeNull()
    const p = tr.update(withDot(201, 180), 33)!
    expect(p).toMatchObject({ kind: 'laser', t: 33 })
    expect(p.x).toBeCloseTo(201 / W, 2)
    expect(p.y).toBeCloseTo(180 / H, 2)
    expect(p.confidence).toBeGreaterThan(0)
  })
  it('a one-frame flash is never reported', () => {
    const tr = createLaserTracker()
    expect(tr.update(board(), 0)).toBeNull()
    expect(tr.update(withDot(200, 180), 33)).toBeNull()
    expect(tr.update(board(), 66)).toBeNull()
    expect(tr.update(board(), 99)).toBeNull()
  })
  it('two flashes in different places are not a laser', () => {
    const tr = createLaserTracker()
    expect(tr.update(withDot(50, 50), 0)).toBeNull()
    expect(tr.update(withDot(400, 220), 33)).toBeNull()
  })
  it('follows a laser moving across the board', () => {
    const tr = createLaserTracker()
    const seen: number[] = []
    for (let i = 0; i < 30; i++) {
      const p = tr.update(withDot(60 + i * 12, 200), i * 33)
      if (p) seen.push(p.x)
    }
    expect(seen.length).toBeGreaterThanOrEqual(28)
    expect(seen.at(-1)).toBeCloseTo((60 + 29 * 12) / W, 2)
    expect(seen.every((x, i) => i === 0 || x > seen[i - 1])).toBe(true)
  })
  it('keeps reporting a hand-held (slightly shaking) laser for many seconds', () => {
    const tr = createLaserTracker()
    let got = 0
    for (let i = 0; i < 300; i++) if (tr.update(withDot(200 + (i % 3) - 1, 180 + ((i >> 1) % 2)), i * 33)) got++
    expect(got).toBeGreaterThanOrEqual(295)
  })
  it('stops when the laser is switched off, and starts again when it comes back', () => {
    const tr = createLaserTracker()
    tr.update(withDot(200, 180), 0)
    expect(tr.update(withDot(200, 180), 33)).not.toBeNull()
    expect(tr.update(board(), 66)).toBeNull()
    expect(tr.update(board(), 99)).toBeNull()
    expect(tr.update(withDot(300, 100), 400)).toBeNull() // first frame back
    expect(tr.update(withDot(300, 100), 433)).not.toBeNull()
  })
  it('a red dot that never moves on an over-exposed board is ink: dropped after a few seconds', () => {
    // On a blown-out board, red ink and a laser halo look the same in one frame. Ink never moves.
    const f = makeFrame(BLOWN)
    disc(f, 200, 180, 3, [255, 80, 90])
    const tr = createLaserTracker()
    let last: unknown = null
    for (let t = 0; t <= LASER_STATIC_WEAK_MS + 500; t += 33) last = tr.update(clone(f), t)
    expect(last).toBeNull()
    // and a real laser elsewhere on that board is still found
    let p: unknown = null
    for (let i = 0; i < 3; i++) { const g = clone(f); laserDot(g, 350 + i, 60); p = tr.update(g, LASER_STATIC_WEAK_MS + 600 + i * 33) }
    expect(p).toMatchObject({ kind: 'laser' })
    expect((p as { x: number }).x).toBeCloseTo(352 / W, 2)
  })
  it('with a laser and a red ink dot on an over-exposed board, it follows the one that moves', () => {
    const f = makeFrame(BLOWN)
    disc(f, 100, 100, 3, [255, 80, 90])
    const tr = createLaserTracker()
    for (let t = 0; t <= LASER_STATIC_WEAK_MS + 500; t += 33) tr.update(clone(f), t)
    const xs: number[] = []
    for (let i = 0; i < 10; i++) {
      const g = clone(f)
      laserDot(g, 300 + i * 5, 200)
      const p = tr.update(g, LASER_STATIC_WEAK_MS + 600 + i * 33)
      if (p) xs.push(p.x)
    }
    expect(xs.length).toBeGreaterThanOrEqual(8)
    expect(xs.every(x => x > 0.5)).toBe(true)
  })
  it('reset forgets the track', () => {
    const tr = createLaserTracker()
    tr.update(withDot(200, 180), 0)
    tr.reset()
    expect(tr.update(withDot(200, 180), 33)).toBeNull()
  })
})

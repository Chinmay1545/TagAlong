import { describe, expect, it } from 'vitest'
import { MIN_TOOL_POINTS, activePointer, coversBoard, kindOf, leading, leadingAt, pointerLabel, type PointerPoint } from '../src/vision/pointer'
import { TOOL_NEAR_MS } from '../src/core/config'

const pt = (kind: PointerPoint['kind'], t: number, x = 0.5, y = 0.5): PointerPoint => ({ kind, x, y, confidence: 1, t })

describe('pointer point', () => {
  it('a plain fingertip sample (no kind) counts as a finger', () => {
    expect(kindOf({ t: 0, x: 0.1, y: 0.1 })).toBe('finger')
    expect(kindOf(pt('laser', 0))).toBe('laser')
  })
  it('only a hand covers the board; a stick, a laser and the mouse do not', () => {
    expect(coversBoard('finger')).toBe(true)
    expect(coversBoard('stick')).toBe(false)
    expect(coversBoard('laser')).toBe(false)
    expect(coversBoard('mouse')).toBe(false)
  })
  it('labels each kind for the judge screen', () => {
    expect(pointerLabel('finger')).toBe('finger')
    expect(pointerLabel('stick')).toBe('stick')
    expect(pointerLabel('laser')).toBe('laser')
    expect(pointerLabel('mouse')).toBe('mouse')
  })
})

describe('leading: which pointer wins when more than one is seen', () => {
  const finger = [0, 30, 60, 90].map(t => pt('finger', t, 0.2, 0.2))
  const stick = [0, 30, 60, 90].map(t => pt('stick', t, 0.5, 0.5))
  const laser = [0, 30, 60, 90].map(t => pt('laser', t, 0.8, 0.8))
  it('laser beats stick beats finger', () => {
    expect(leading([...finger, ...stick, ...laser]).every(p => kindOf(p) === 'laser')).toBe(true)
    expect(leading([...finger, ...stick]).every(p => kindOf(p) === 'stick')).toBe(true)
    expect(leading(finger)).toEqual(finger)
  })
  it('keeps time order and drops the other kinds', () => {
    expect(leading([finger[0], laser[0], finger[1], laser[1], laser[2]]).map(p => p.t)).toEqual([0, 30, 60])
  })
  it('one or two stray laser or stick points do not take over from the finger', () => {
    expect(leading([...finger, laser[0], laser[1]]).every(p => kindOf(p) === 'finger')).toBe(true)
    expect(leading([...finger, stick[0]]).every(p => kindOf(p) === 'finger')).toBe(true)
  })
  it('a stray laser point is still used when nothing else is there', () => {
    expect(leading([laser[0]])).toEqual([laser[0]])
  })
  it('the mouse (demo mode) beats everything', () => {
    const mouse = [0, 30, 60].map(t => pt('mouse', t))
    expect(leading([...finger, ...laser, ...mouse]).every(p => kindOf(p) === 'mouse')).toBe(true)
  })
  it('plain samples with no kind are fingers', () => {
    const plain = [{ t: 0, x: 0.1, y: 0.1 }, { t: 30, x: 0.1, y: 0.1 }]
    expect(leading(plain)).toEqual(plain)
    expect(leading([...plain, ...laser]).every(p => kindOf(p) === 'laser')).toBe(true)
  })
  it('empty in, empty out', () => expect(leading([])).toEqual([]))
})

describe('activePointer: the dot shown on the judge screen', () => {
  it('is the newest point of the winning kind', () => {
    const p = activePointer([pt('finger', 900, 0.2, 0.2), pt('laser', 880, 0.8, 0.8), pt('laser', 910, 0.81, 0.8), pt('laser', 940, 0.82, 0.8), pt('finger', 950, 0.2, 0.2)], 1000)
    expect(p).toMatchObject({ kind: 'laser', x: 0.82, t: 940 })
  })
  it('falls back to the finger once the laser is gone', () => {
    const old = [0, 30, 60].map(t => pt('laser', t))
    expect(activePointer([...old, pt('finger', 950, 0.2, 0.2)], 1000)).toMatchObject({ kind: 'finger', x: 0.2 })
  })
  it('is null when nothing was seen in the last half second', () => {
    expect(activePointer([pt('finger', 100)], 1000)).toBeNull()
    expect(activePointer([], 1000)).toBeNull()
  })
  it('gives a plain fingertip sample a kind and a confidence', () => {
    expect(activePointer([{ t: 990, x: 0.3, y: 0.4 }], 1000)).toEqual({ kind: 'finger', x: 0.3, y: 0.4, confidence: 1, t: 990 })
  })
})

// For "this / that / here" the question is who was pointing when the word was said, not who was seen at
// some point in the second around it.
describe('leadingAt: which pointer counts at the moment of the word', () => {
  const T = 1000
  const run = (kind: PointerPoint['kind'], t0: number, t1: number, x = 0.5) => {
    const out: PointerPoint[] = []
    for (let t = t0; t <= t1; t += 33) out.push(pt(kind, t, x, 0.5))
    return out
  }
  const mix = (...tracks: PointerPoint[][]) => tracks.flat().sort((a, b) => a.t - b.t)
  const kinds = (ps: { t: number }[]) => [...new Set(ps.map(p => kindOf(p as PointerPoint)))]

  it('a laser seen around the word beats the finger', () => {
    expect(kinds(leadingAt(mix(run('finger', 500, 1500), run('laser', 500, 1500)), T))).toEqual(['laser'])
  })
  it('a laser that went off well before the word does not: the finger counts', () => {
    expect(kinds(leadingAt(mix(run('finger', 500, 1500), run('laser', 500, T - TOOL_NEAR_MS - 50)), T))).toEqual(['finger'])
  })
  it('a laser that only comes on well after the word does not either', () => {
    expect(kinds(leadingAt(mix(run('finger', 500, 1500), run('laser', T + TOOL_NEAR_MS + 50, 1500)), T))).toEqual(['finger'])
  })
  it('a laser that went off just before the word still counts (within TOOL_NEAR_MS)', () => {
    expect(kinds(leadingAt(mix(run('finger', 500, 1500), run('laser', 500, T - 100)), T))).toEqual(['laser'])
  })
  it('when the laser leads, all of its points in the window are returned, not just the near ones', () => {
    const laser = run('laser', 500, 1500)
    expect(leadingAt(mix(run('finger', 500, 1500), laser), T)).toEqual(laser)
  })
  it(`needs ${MIN_TOOL_POINTS} tool points near the word: fewer is a stray dot`, () => {
    const near = (n: number) => Array.from({ length: n }, (_, i) => pt('laser', T - 40 + i * 33))
    expect(kinds(leadingAt(mix(run('finger', 500, 1500), near(MIN_TOOL_POINTS - 1)), T))).toEqual(['finger'])
    expect(kinds(leadingAt(mix(run('finger', 500, 1500), near(MIN_TOOL_POINTS)), T))).toEqual(['laser'])
  })
  it('laser gone, stick still there: the stick', () => {
    expect(kinds(leadingAt(mix(run('finger', 500, 1500), run('stick', 500, 1500), run('laser', 500, 600)), T))).toEqual(['stick'])
  })
  it('the mouse leads only while it is on the photo around the word', () => {
    expect(kinds(leadingAt(mix(run('finger', 500, 1500), run('mouse', 900, 1100)), T))).toEqual(['mouse'])
    expect(kinds(leadingAt(mix(run('finger', 500, 1500), run('mouse', 500, 600)), T))).toEqual(['finger'])
  })
  it('a tool with no finger in view at all', () => {
    expect(kinds(leadingAt(run('stick', 500, 1500), T))).toEqual(['stick'])
  })
  it('a tool long gone and no finger: nothing is pointing', () => {
    expect(leadingAt(run('laser', 500, 600), T)).toEqual([])
  })
  it('plain fingertip samples with no kind are fingers', () => {
    const plain = [{ t: 900, x: 0.1, y: 0.1 }, { t: 1000, x: 0.1, y: 0.1 }]
    expect(leadingAt(plain, T)).toEqual(plain)
  })
  it('nothing in, nothing out', () => expect(leadingAt([], T)).toEqual([]))
})

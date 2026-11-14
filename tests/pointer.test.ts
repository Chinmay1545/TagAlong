import { describe, expect, it } from 'vitest'
import { activePointer, coversBoard, kindOf, leading, pointerLabel, type PointerPoint } from '../src/vision/pointer'

const pt = (kind: PointerPoint['kind'], t: number, x = 0.5, y = 0.5): PointerPoint => ({ kind, x, y, confidence: 1, t })

describe('pointer point', () => {
  it('a plain fingertip sample (no kind) counts as a finger', () => {
    expect(kindOf({ t: 0, x: 0.1, y: 0.1 })).toBe('finger')
    expect(kindOf(pt('laser', 0))).toBe('laser')
  })
  it('only a finger or a stick covers the board; a laser and the mouse do not', () => {
    expect(coversBoard('finger')).toBe(true)
    expect(coversBoard('stick')).toBe(true)
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

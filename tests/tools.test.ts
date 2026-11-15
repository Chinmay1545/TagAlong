import { describe, expect, it } from 'vitest'
import { pointersLabel, toolsFor } from '../src/vision/tools'

// The laser and stick detectors are off unless the link asks for them, so an untested detector can never
// steal the pointer from the finger in a demo.
describe('toolsFor: which detectors the link turns on', () => {
  it('a plain link: both off', () => {
    expect(toolsFor('')).toEqual({ laser: false, stick: false, hand: true })
    expect(toolsFor('?demo=1')).toEqual({ laser: false, stick: false, hand: true })
    expect(toolsFor('?mirror=1&student=1')).toEqual({ laser: false, stick: false, hand: true })
  })
  it('?laser=1 turns on the laser only', () => expect(toolsFor('?laser=1')).toEqual({ laser: true, stick: false, hand: true }))
  it('?stick=1 turns on the stick only', () => expect(toolsFor('?stick=1')).toEqual({ laser: false, stick: true, hand: true }))
  it('both can be on, together with other flags', () => {
    expect(toolsFor('?laser=1&stick=1')).toEqual({ laser: true, stick: true, hand: true })
    expect(toolsFor('?demo=1&stick=1&mirror=1&laser=1')).toEqual({ laser: true, stick: true, hand: true })
  })
  it('only "1" turns a detector on', () => {
    expect(toolsFor('?laser=0&stick=true')).toEqual({ laser: false, stick: false, hand: true })
    expect(toolsFor('?laser&stick=')).toEqual({ laser: false, stick: false, hand: true })
    expect(toolsFor('?LASER=1')).toEqual({ laser: false, stick: false, hand: true })
  })
})

describe('pointersLabel: what the judge screen says is switched on', () => {
  it('finger only by default', () => expect(pointersLabel({ laser: false, stick: false, hand: false }, false)).toBe('finger'))
  it('lists what is on', () => {
    expect(pointersLabel({ laser: true, stick: false, hand: false }, false)).toBe('finger + laser')
    expect(pointersLabel({ laser: false, stick: true, hand: false }, false)).toBe('finger + stick')
    expect(pointersLabel({ laser: true, stick: true, hand: false }, false)).toBe('finger + stick + laser')
  })
  it('demo mode has the mouse too', () => {
    expect(pointersLabel({ laser: false, stick: false, hand: false }, true)).toBe('mouse + finger')
    expect(pointersLabel({ laser: true, stick: true, hand: false }, true)).toBe('mouse + finger + stick + laser')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { createEarcons } from '../src/phone/earcons'

const fakeCtx = () => {
  const osc = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
  const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() }
  const ctx = { currentTime: 0, destination: {}, resume: vi.fn(), createOscillator: vi.fn(() => ({ ...osc })), createGain: vi.fn(() => gain) }
  return ctx
}

describe('earcons', () => {
  it('plays nothing before unlock, one oscillator per note after', () => {
    const ctx = fakeCtx()
    const e = createEarcons(() => ctx as unknown as AudioContext)
    e.play('start')
    expect(ctx.createOscillator).not.toHaveBeenCalled()
    e.unlock()
    expect(ctx.resume).toHaveBeenCalled()
    e.play('start')
    expect(ctx.createOscillator).toHaveBeenCalledTimes(3)
    e.play('drop')
    expect(ctx.createOscillator).toHaveBeenCalledTimes(5)
  })
  it('never throws when audio is missing or broken', () => {
    expect(() => { const e = createEarcons(); e.unlock(); e.play('join') }).not.toThrow()
    const e = createEarcons(() => { throw new Error('no audio') })
    expect(() => { e.unlock(); e.play('back') }).not.toThrow()
  })
})

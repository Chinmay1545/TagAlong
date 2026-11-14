import { describe, it, expect, vi } from 'vitest'
import { loadClasses, saveClass } from '../src/phone/classes'
import { pickRoom, waitingText } from '../src/phone/pick'
import { createVoice } from '../src/phone/voice'
import { createEarcons } from '../src/phone/earcons'

const mem = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}
const bad = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }

describe('classes', () => {
  it('round trips, newest first, dedupes by token with new name', () => {
    const s = mem()
    saveClass(s, { token: 'a', name: 'Math' })
    saveClass(s, { token: 'b', name: 'Bio' })
    expect(saveClass(s, { token: 'a', name: 'Math 201' })).toEqual([{ token: 'a', name: 'Math 201' }, { token: 'b', name: 'Bio' }])
    expect(loadClasses(s)).toEqual([{ token: 'a', name: 'Math 201' }, { token: 'b', name: 'Bio' }])
  })
  it('caps at 10', () => {
    const s = mem()
    for (let i = 0; i < 12; i++) saveClass(s, { token: `t${i}`, name: `n${i}` })
    const l = loadClasses(s)
    expect(l).toHaveLength(10)
    expect(l[0].token).toBe('t11')
  })
  it('bad storage, bad JSON, non-array, junk entries', () => {
    expect(loadClasses(bad)).toEqual([])
    expect(() => saveClass(bad, { token: 'a', name: 'b' })).not.toThrow()
    expect(loadClasses({ getItem: () => '{oops' })).toEqual([])
    expect(loadClasses({ getItem: () => '{"a":1}' })).toEqual([])
    expect(loadClasses({ getItem: () => JSON.stringify([{ token: 'a', name: 'A' }, { token: 1, name: 'B' }, { name: 'C' }, null]) })).toEqual([{ token: 'a', name: 'A' }])
  })
})

describe('pickRoom', () => {
  const saved = [{ token: 'a', name: 'A' }, { token: 'b', name: 'B' }]
  it('preferred live joins', () => expect(pickRoom(['a', 'b'], saved, 'b')).toEqual({ kind: 'join', token: 'b' }))
  it('one saved live joins', () => expect(pickRoom(['b', 'zzz'], saved, null)).toEqual({ kind: 'join', token: 'b' }))
  it('preferred not live but other live joins it', () => expect(pickRoom(['a'], saved, 'b')).toEqual({ kind: 'join', token: 'a' }))
  it('several live chooses in saved order', () => expect(pickRoom(['b', 'a'], saved, null)).toEqual({ kind: 'choose', options: saved }))
  it('none waits', () => expect(pickRoom([], saved, 'a')).toEqual({ kind: 'wait' }))
})

describe('waitingText', () => {
  it('one', () => expect(waitingText([{ token: 'a', name: 'Math 201' }])).toBe('Waiting for Math 201 to start.'))
  it('several', () => expect(waitingText([{ token: 'a', name: 'Math 201' }, { token: 'b', name: 'Biology 110' }])).toBe('Waiting. Your classes: Math 201, Biology 110.'))
})

describe('voice', () => {
  class U { rate = 1; constructor(public text: string) {} }
  it('speak mode cancels then speaks at rate', () => {
    vi.stubGlobal('SpeechSynthesisUtterance', U)
    const calls: string[] = []
    const spoken: U[] = []
    const v = createVoice('speak', { cancel: () => void calls.push('cancel'), speak: (u) => { calls.push('speak'); spoken.push(u as unknown as U) } })
    v.say('hi')
    expect(calls).toEqual(['cancel', 'speak'])
    expect(spoken[0].text).toBe('hi')
    expect(spoken[0].rate).toBe(1.1)
    v.unlock()
    expect(spoken[1].text).toBe('')
    vi.unstubAllGlobals()
  })
  it('cancel stops in-flight speech in speak mode only', () => {
    const synth = { cancel: vi.fn(), speak: vi.fn() }
    createVoice('speak', synth).cancel()
    expect(synth.cancel).toHaveBeenCalledTimes(1)
    const quiet = { cancel: vi.fn(), speak: vi.fn() }
    createVoice('screenreader', quiet).cancel()
    expect(quiet.cancel).not.toHaveBeenCalled()
  })
  it('screenreader mode never touches synth', () => {
    const synth = { cancel: vi.fn(), speak: vi.fn() }
    const v = createVoice('screenreader', synth)
    v.say('hi'); v.unlock()
    expect(synth.cancel).not.toHaveBeenCalled()
    expect(synth.speak).not.toHaveBeenCalled()
  })
})

describe('earcons', () => {
  const fake = () => {
    const freqs: number[] = [], starts: number[] = [], gains: number[] = [], types: string[] = []
    const ctx = {
      currentTime: 1,
      destination: {},
      createOscillator: () => {
        const o = { type: '', frequency: { value: 0 }, connect: (n: unknown) => n, start: (t: number) => { freqs.push(o.frequency.value); starts.push(t); types.push(o.type) }, stop: () => {} }
        return o
      },
      createGain: () => {
        const g = { gain: { value: 0, setValueAtTime: (v: number) => void gains.push(v), linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: (n: unknown) => n }
        return g
      },
    }
    return { ctx: ctx as unknown as AudioContext, freqs, starts, gains, types }
  }
  const kinds = { join: [660, 880], start: [523, 659, 784], drop: [330, 247], back: [440, 660], mark: [880] } as const
  for (const [k, f] of Object.entries(kinds)) {
    it(`plays ${k}`, () => {
      const { ctx, freqs, starts, types } = fake()
      const e = createEarcons(() => ctx)
      e.unlock()
      e.play(k as keyof typeof kinds)
      expect(freqs).toEqual(f)
      expect(types.every((t) => t === 'sine')).toBe(true)
      starts.forEach((s, i) => expect(s).toBeCloseTo(1 + i * 0.16))
    })
  }
  it('play before unlock is silent', () => {
    const { ctx, freqs } = fake()
    createEarcons(() => ctx).play('join')
    expect(freqs).toEqual([])
  })
  it('no web audio does not throw', () => {
    const e = createEarcons()
    expect(() => { e.unlock(); e.play('join') }).not.toThrow()
    const e2 = createEarcons(() => { throw new Error('x') })
    expect(() => { e2.unlock(); e2.play('mark') }).not.toThrow()
  })
})

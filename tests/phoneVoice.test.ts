import { afterEach, describe, expect, it, vi } from 'vitest'
import { unlockVoice } from '../src/phone/voice'

afterEach(() => vi.unstubAllGlobals())

describe('unlockVoice', () => {
  it('speaks one empty utterance and nothing else', () => {
    class U { constructor(public text: string) {} }
    vi.stubGlobal('SpeechSynthesisUtterance', U)
    const synth = { speak: vi.fn(), cancel: vi.fn() }
    unlockVoice(synth as never)
    expect(synth.speak).toHaveBeenCalledTimes(1)
    expect((synth.speak.mock.calls[0][0] as U).text).toBe('')
    expect(synth.cancel).not.toHaveBeenCalled()
  })
  it('does nothing, and does not throw, where speech is missing or breaks', () => {
    vi.stubGlobal('SpeechSynthesisUtterance', undefined)
    expect(() => unlockVoice({ speak: vi.fn(), cancel: vi.fn() } as never)).not.toThrow()
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public t: string) {} })
    expect(() => unlockVoice(undefined)).not.toThrow()
    expect(() => unlockVoice({ speak: () => { throw new Error('x') }, cancel: vi.fn() } as never)).not.toThrow()
  })
})

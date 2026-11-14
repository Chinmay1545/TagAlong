import { describe, it, expect } from 'vitest'
import { missingLines } from '../src/ui/Readiness'

describe('missingLines', () => {
  it('empty when all configured', () => {
    expect(missingLines({ ok: true, board: 'anthropic', tts: true, notes: true, transcribe: 'configured' })).toEqual([])
  })
  it('lists each missing item in plain words', () => {
    const l = missingLines({ ok: false, board: 'missing', tts: false, notes: false, transcribe: 'missing' })
    expect(l).toHaveLength(4)
    expect(l[1]).toBe('Voice: Polly not configured — using the browser voice.')
  })
})

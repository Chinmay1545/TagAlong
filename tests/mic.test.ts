import { describe, it, expect } from 'vitest'
import { downsampleTo16k } from '../src/speech/mic'

describe('downsampleTo16k', () => {
  it('48k -> 1/3 length', () => {
    expect(downsampleTo16k(new Float32Array(480), 48000).length).toBe(160)
  })
  it('maps extremes and clamps', () => {
    const o = downsampleTo16k(new Float32Array([1, 1, 1, -1, -1, -1, 2, 2, 2, -3, -3, -3]), 48000)
    expect(Array.from(o)).toEqual([32767, -32768, 32767, -32768])
  })
  it('averages', () => {
    expect(downsampleTo16k(new Float32Array([0, 0.5, 1]), 48000)[0]).toBe(Math.round(0.5 * 32767))
  })
  it('16k keeps length', () => {
    expect(downsampleTo16k(new Float32Array(100), 16000).length).toBe(100)
  })
})

import { describe, it, expect, vi } from 'vitest'
import { askScene, ASK_FAILED } from '../src/live/assist'

const blob = new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' })
const ok = (body: unknown) => vi.fn(async () => ({ ok: true, json: async () => body }) as Response)

describe('askScene: "what is happening?"', () => {
  it('posts the frame as a jpeg and returns the answer', async () => {
    const post = ok({ text: 'Students are packing up.' })
    expect(await askScene(async () => blob, post)).toBe('Students are packing up.')
    expect(post).toHaveBeenCalledWith('/api/describe', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
  })
  it('no frame: a plain sorry, and no request', async () => {
    const post = ok({ text: 'x' })
    expect(await askScene(async () => null, post)).toBe(ASK_FAILED)
    expect(post).not.toHaveBeenCalled()
  })
  it('server error, network error or an empty answer: a plain sorry', async () => {
    expect(await askScene(async () => blob, vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response))).toBe(ASK_FAILED)
    expect(await askScene(async () => blob, vi.fn(async () => { throw new Error('offline') }))).toBe(ASK_FAILED)
    expect(await askScene(async () => blob, ok({ text: '  ' }))).toBe(ASK_FAILED)
    expect(await askScene(async () => { throw new Error('camera gone') }, ok({ text: 'x' }))).toBe(ASK_FAILED)
  })
})

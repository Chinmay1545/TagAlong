import { describe, it, expect, vi, afterEach } from 'vitest'
import { shouldReadBoard, startBoardLoop } from '../src/board/boardLoop'
import { isFixtureMode, loadFixture, readBoard } from '../src/board/boardClient'
import { TipBuffer } from '../src/core/tipBuffer'
import type { Term } from '../src/core/types'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('shouldReadBoard', () => {
  it('reads when no hand ever seen and frame changed', () => expect(shouldReadBoard(10000, null, true)).toBe(true))
  it('waits when hand seen 100 ms ago', () => expect(shouldReadBoard(10000, 9900, true)).toBe(false))
  it('reads when hand seen 400 ms ago', () => expect(shouldReadBoard(10000, 9600, true)).toBe(true))
  it('skips when frame unchanged', () => expect(shouldReadBoard(10000, null, false)).toBe(false))
  it('boundary: exactly HAND_RECENT_MS ago still counts as recent (strict >)', () =>
    expect(shouldReadBoard(10000, 9700, true)).toBe(false))
})

describe('isFixtureMode', () => {
  it('parses ?fixture=1', () => {
    expect(isFixtureMode('?fixture=1')).toBe(true)
    expect(isFixtureMode('')).toBe(false)
    expect(isFixtureMode('?fixture=0')).toBe(false)
  })
})

describe('client fetches', () => {
  it('loadFixture returns terms', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ terms: [{ id: 1 }] }) })))
    expect(await loadFixture()).toEqual([{ id: 1 }])
  })
  it('readBoard throws server error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: 'boom' }) })))
    await expect(readBoard(new Blob(['x']))).rejects.toThrow('boom')
  })
})

// Drives the real loop with a fake camera: `scene` sets the frame's brightness,
// `replies` is what /api/read-board answers, one entry per read.
function harness() {
  const W = 64, H = 36
  const cam = { scene: 50 }
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(W * H * 4).fill(cam.scene) }),
    }),
    toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['jpeg'])),
  }
  vi.stubGlobal('document', { createElement: () => canvas })
  const replies: Term[][] = []
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ terms: replies.shift() ?? [] }) }))
  vi.stubGlobal('fetch', fetchMock)
  const video = { readyState: 4, videoWidth: W, videoHeight: H } as HTMLVideoElement
  const shown: Term[][] = []
  vi.useFakeTimers()
  const loop = startBoardLoop(video, new TipBuffer(), t => shown.push(t))
  const tick = () => vi.advanceTimersByTimeAsync(3000)
  return { cam, replies, shown, reads: () => fetchMock.mock.calls.length, tick, stop: loop.stop, reset: loop.reset, fetchMock }
}

const fraction: Term[] = [
  { id: 1, latex: '2x', phrase: 'the 2x on top', box: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } },
  { id: 2, latex: '2x', phrase: 'the 2x on the bottom', box: { x: 0.2, y: 0.5, w: 0.1, h: 0.1 } },
]

describe('board loop: erasing the board', () => {
  it('clears the terms after two empty reads in a row', async () => {
    const h = harness()
    h.replies.push(fraction)
    await h.tick()
    expect(h.shown).toEqual([fraction])

    h.cam.scene = 220 // board wiped
    h.replies.push([], [])
    await h.tick()
    await h.tick()
    expect(h.shown).toEqual([fraction, []])
    h.stop()
  })

  it('keeps the terms after a single empty read (someone stood in front of the board)', async () => {
    const h = harness()
    h.replies.push(fraction)
    await h.tick()

    h.cam.scene = 120 // person in front
    h.replies.push([])
    await h.tick()
    h.cam.scene = 50 // they move away, board unchanged
    h.replies.push(fraction)
    await h.tick()
    expect(h.shown).not.toContainEqual([])
    h.stop()
  })

  it('stops re-reading a blank board once it is cleared', async () => {
    const h = harness()
    h.cam.scene = 220
    h.replies.push([], [])
    await h.tick()
    await h.tick()
    const readsWhenCleared = h.reads()
    await h.tick()
    await h.tick()
    expect(readsWhenCleared).toBe(2)
    expect(h.reads()).toBe(2)
    h.stop()
  })
})

describe('board loop: reset button', () => {
  it('clears the terms at once and re-reads the board on the next tick', async () => {
    const h = harness()
    h.replies.push(fraction)
    await h.tick()
    h.reset()
    expect(h.shown.at(-1)).toEqual([]) // boxes gone immediately
    h.replies.push(fraction)
    await h.tick() // board unchanged, but reset forgets the old frame so it is read again
    expect(h.reads()).toBe(2)
    expect(h.shown.at(-1)).toEqual(fraction)
    h.stop()
  })

  it('ignores a read that was in flight when reset was pressed', async () => {
    const h = harness()
    let answer!: (v: unknown) => void
    h.fetchMock.mockImplementationOnce(() => new Promise(r => { answer = r }) as never)
    await h.tick() // read starts, reply pending
    h.reset()
    answer({ ok: true, json: async () => ({ terms: fraction }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.shown).toEqual([[]]) // the stale board did not come back
    h.stop()
  })
})

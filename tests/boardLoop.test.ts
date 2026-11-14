import { describe, it, expect, vi, afterEach } from 'vitest'
import { BOARD_TICK_MS, READ_SETTLE_MS, isSettled, scaleToMax, shouldReadBoard, startBoardLoop } from '../src/board/boardLoop'
import { isFixtureMode, loadFixture, readBoard } from '../src/board/boardClient'
import { TipBuffer } from '../src/core/tipBuffer'
import type { Term } from '../src/core/types'
import { BOARD_INTERVAL_MS, IDLE_REREAD_MS, SETTLE_MS } from '../src/core/config'

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
function harness(tips = new TipBuffer()) {
  const W = 64, H = 36
  const cam: { scene: number; paint: null | ((rgba: Uint8ClampedArray) => void) } = { scene: 50, paint: null }
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({
      drawImage: () => {},
      getImageData: () => { const data = new Uint8ClampedArray(W * H * 4).fill(cam.scene); cam.paint?.(data); return { data } },
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
  const loop = startBoardLoop(video, tips, t => shown.push(t))
  // Long enough for a changed picture to settle and be read (one check to see the change, then READ_SETTLE_MS of stillness: three checks).
  const tick = () => vi.advanceTimersByTimeAsync(3 * BOARD_TICK_MS)
  return { cam, replies, shown, reads: () => fetchMock.mock.calls.length, tick, stop: loop.stop, reset: loop.reset, lock: loop.lock, locked: loop.locked, reading: loop.reading, pending: loop.pendingRegion, fetchMock }
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

// A streamed reply the test feeds by hand: push(line objects), then close().
function manualStream() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(c) { ctl = c } })
  return {
    response: new Response(body, { headers: { 'content-type': 'application/x-ndjson' } }),
    push: (...lines: unknown[]) => ctl.enqueue(new TextEncoder().encode(lines.map(l => JSON.stringify(l) + '\n').join(''))),
    close: () => ctl.close(),
  }
}

describe('board loop: streamed reads', () => {
  const N: Term = { id: 1, latex: 'y', phrase: 'the y on the right', box: { x: 0.6, y: 0.2, w: 0.1, h: 0.1 } }

  it('draws each term as it arrives, on top of the previous board', async () => {
    const h = harness()
    h.replies.push(fraction)
    await h.tick()
    const s = manualStream()
    h.fetchMock.mockImplementationOnce(async () => s.response as never)
    h.cam.scene = 120
    await h.tick() // read starts
    s.push({ type: 'term', term: N })
    await vi.advanceTimersByTimeAsync(0)
    const partial = h.shown.at(-1)!
    expect(partial.map(t => t.latex)).toEqual(['2x', '2x', 'y']) // old boxes kept while the read is running
    expect(new Set(partial.map(t => t.id)).size).toBe(3) // no id clash
    s.push({ type: 'done', count: 1, ms: 1 })
    s.close()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.shown.at(-1)!.map(t => t.latex)).toEqual(['y'])
    h.stop()
  })

  it('a wobbly camera re-read keeps the same term objects (boxes do not jump)', async () => {
    const h = harness()
    h.replies.push(fraction)
    await h.tick()
    h.cam.scene = 60 // the picture moved a little
    h.replies.push(fraction.map((t, i) => ({ ...t, id: 9 - i, box: { ...t.box, x: t.box.x + 0.01 } })))
    await h.tick()
    expect(h.reads()).toBe(2)
    const last = h.shown.at(-1)!
    expect(last).toHaveLength(2)
    last.forEach((t, i) => expect(t).toBe(h.shown[0][i]))
    h.stop()
  })

  it('a read that fails half way puts the previous board back', async () => {
    const h = harness()
    h.replies.push(fraction)
    await h.tick()
    const s = manualStream()
    h.fetchMock.mockImplementationOnce(async () => s.response as never)
    h.cam.scene = 120
    await h.tick()
    s.push({ type: 'term', term: N })
    await vi.advanceTimersByTimeAsync(0)
    s.push({ type: 'error', error: 'board read failed' })
    s.close()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.shown.at(-1)).toEqual(fraction)
    h.stop()
  })

  it('a term streamed after reset is ignored', async () => {
    const h = harness()
    const s = manualStream()
    h.fetchMock.mockImplementationOnce(async () => s.response as never)
    await h.tick()
    h.reset()
    s.push({ type: 'term', term: N }, { type: 'done', count: 1, ms: 1 })
    s.close()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.shown).toEqual([[]])
    h.stop()
  })
})

describe('board loop: 1 s checks (1.4)', () => {
  it('checks the board every second', () => expect(BOARD_INTERVAL_MS).toBe(1000))

  it('a change is picked up by the next check and read once it settles', async () => {
    const h = harness()
    h.replies.push(fraction)
    await h.tick()
    expect(h.reads()).toBe(1)
    h.cam.scene = 120
    await vi.advanceTimersByTimeAsync(3 * BOARD_TICK_MS) // seen on the next check, read once it has settled (1.9)
    expect(h.reads()).toBe(2)
    h.stop()
  })

  it('never has more than one read in flight, however long it takes', async () => {
    const h = harness()
    let answer!: (v: unknown) => void
    h.fetchMock.mockImplementationOnce(() => new Promise(r => { answer = r }) as never)
    await h.tick()
    for (let i = 0; i < 8; i++) { h.cam.scene = 60 + i * 20; await h.tick() } // board keeps changing during a slow read
    expect(h.reads()).toBe(1)
    answer({ ok: true, json: async () => ({ terms: fraction }) })
    await vi.advanceTimersByTimeAsync(0)
    await h.tick()
    expect(h.reads()).toBe(2) // the next check reads again once the first is done
    h.stop()
  })
})

describe('board loop: wait for the picture to settle (1.9)', () => {
  it('waits about a second of stillness after a change', () => expect(SETTLE_MS).toBe(1000))

  it('does not read while the picture keeps changing (teacher still writing)', async () => {
    const h = harness()
    for (let i = 0; i < 6; i++) { h.cam.scene = 40 + i * 20; await vi.advanceTimersByTimeAsync(BOARD_INTERVAL_MS) }
    expect(h.reads()).toBe(0)
    h.replies.push(fraction)
    await vi.advanceTimersByTimeAsync(SETTLE_MS) // still for SETTLE_MS
    expect(h.reads()).toBe(1)
    expect(h.shown).toEqual([fraction])
    h.stop()
  })

  it('a picture that moves and comes back to what was read is not read again', async () => {
    const h = harness()
    h.replies.push(fraction)
    await h.tick()
    h.cam.scene = 200 // someone walks past
    await vi.advanceTimersByTimeAsync(BOARD_INTERVAL_MS)
    h.cam.scene = 50 // gone again, board unchanged
    await vi.advanceTimersByTimeAsync(3 * BOARD_INTERVAL_MS)
    expect(h.reads()).toBe(1)
    h.stop()
  })

  it('the first read of a still board starts three checks in', async () => {
    const h = harness()
    await vi.advanceTimersByTimeAsync(2 * BOARD_TICK_MS)
    expect(h.reads()).toBe(0)
    await vi.advanceTimersByTimeAsync(BOARD_TICK_MS)
    expect(h.reads()).toBe(1)
    h.stop()
  })
})

describe('board loop: pending change region (for 1.5)', () => {
  it('reports the changed area while it is unread or being read, null once read', async () => {
    const h = harness()
    expect(h.pending()).toBeNull() // nothing seen yet
    let answer!: (v: unknown) => void
    h.fetchMock.mockImplementationOnce(() => new Promise(r => { answer = r }) as never)
    await vi.advanceTimersByTimeAsync(BOARD_INTERVAL_MS)
    expect(h.pending()).toEqual({ x: 0, y: 0, w: 1, h: 1 }) // never read: the whole board is pending
    await vi.advanceTimersByTimeAsync(SETTLE_MS) // read starts
    expect(h.reads()).toBe(1)
    expect(h.pending()).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    answer({ ok: true, json: async () => ({ terms: fraction }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.pending()).toBeNull()
    h.cam.scene = 200 // whole picture changes (uniform test frames)
    await vi.advanceTimersByTimeAsync(BOARD_INTERVAL_MS)
    expect(h.pending()).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    h.stop()
  })
})

describe('board loop: every box gets its own spoken phrase', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('never shows two terms with the same phrase, so both whispers of "this cancels with that" play', async () => {
    const h = harness()
    h.replies.push([
      { id: 1, latex: '2x', phrase: 'the 2 x in the middle', box: { x: 0.45, y: 0.38, w: 0.1, h: 0.06 } },
      { id: 2, latex: '2x', phrase: 'the 2 x in the middle', box: { x: 0.45, y: 0.48, w: 0.1, h: 0.06 } },
    ])
    h.cam.scene = 120
    await h.tick()
    const last = h.shown.at(-1)!
    expect(last).toHaveLength(2)
    expect(new Set(last.map(x => x.phrase)).size).toBe(2)
    h.stop()
  })
})

describe('board loop: what blocks a read (pointer kinds)', () => {
  // A pointer of this kind is seen every 100 ms for as long as the test runs.
  const keepPointing = (tips: TipBuffer, kind: 'finger' | 'stick' | 'laser' | 'mouse') =>
    setInterval(() => tips.push({ kind, t: performance.now(), x: 0.5, y: 0.5, confidence: 1 }), 100)

  it('a laser on the board does not block a read', async () => {
    const tips = new TipBuffer()
    const h = harness(tips)
    const id = keepPointing(tips, 'laser')
    h.replies.push(fraction)
    await h.tick()
    expect(h.reads()).toBe(1)
    expect(h.shown).toEqual([fraction])
    clearInterval(id)
    h.stop()
  })

  it('a finger in view still blocks the read', async () => {
    const tips = new TipBuffer()
    const h = harness(tips)
    const id = keepPointing(tips, 'finger')
    h.replies.push(fraction)
    await h.tick()
    expect(h.reads()).toBe(0)
    clearInterval(id)
    await h.tick()
    expect(h.reads()).toBe(1)
    h.stop()
  })

  it('a stick in view does not block a read (a false stick must never stop the boxes)', async () => {
    const tips = new TipBuffer()
    const h = harness(tips)
    const id = keepPointing(tips, 'stick')
    h.replies.push(fraction)
    await h.tick()
    expect(h.reads()).toBe(1)
    clearInterval(id)
    h.stop()
  })
})

// The frame is 64x36, so one pixel is one cell of the change check.
describe('board loop: a laser dot is not ink (pointer masking)', () => {
  const dotAt = (cx: number, cy: number) => (rgba: Uint8ClampedArray) => {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) rgba.fill(255, ((cy + dy) * 64 + cx + dx) * 4, ((cy + dy) * 64 + cx + dx) * 4 + 4)
  }
  const cell = (cx: number, cy: number) => ({ x: (cx + 1) / 64, y: (cy + 1) / 36 }) // centre of the 2x2 dot

  it('a laser dot alone does not create a pending region', async () => {
    const tips = new TipBuffer()
    const h = harness(tips)
    h.replies.push(fraction)
    await h.tick()
    expect(h.pending()).toBeNull()
    h.cam.paint = dotAt(40, 20)
    const id = setInterval(() => tips.push({ kind: 'laser', ...cell(40, 20), confidence: 1, t: performance.now() }), 100)
    await vi.advanceTimersByTimeAsync(BOARD_INTERVAL_MS * 3)
    expect(h.pending()).toBeNull()
    expect(h.reads()).toBe(1)
    clearInterval(id)
    h.stop()
  })

  it('the same bright spot with no laser seen is real change and is pending', async () => {
    const h = harness()
    h.replies.push(fraction)
    await h.tick()
    h.cam.paint = dotAt(40, 20)
    await vi.advanceTimersByTimeAsync(BOARD_INTERVAL_MS) // seen, not settled yet
    expect(h.pending()).not.toBeNull()
    const reads = h.reads()
    h.replies.push(fraction)
    await vi.advanceTimersByTimeAsync(BOARD_INTERVAL_MS * 3) // real change: once settled, it is read
    expect(h.reads()).toBe(reads + 1)
    h.stop()
  })

  it('a laser on the very first frame leaves no ghost behind when it goes away', async () => {
    const tips = new TipBuffer()
    const h = harness(tips)
    h.cam.paint = dotAt(40, 20)
    const id = setInterval(() => tips.push({ kind: 'laser', ...cell(40, 20), confidence: 1, t: performance.now() }), 100)
    h.replies.push(fraction)
    await h.tick()
    expect(h.reads()).toBe(1)
    clearInterval(id)
    h.cam.paint = null // laser off
    await vi.advanceTimersByTimeAsync(BOARD_INTERVAL_MS * 3)
    expect(h.pending()).toBeNull()
    h.stop()
  })

  it('a moving laser does not prevent settle: new ink is still read', async () => {
    const tips = new TipBuffer()
    const h = harness(tips)
    h.replies.push(fraction)
    await h.tick()
    expect(h.reads()).toBe(1)
    // The laser wanders the whole time; a new position on every check.
    let step = 0
    const move = () => {
      step++
      const cx = 5 + ((step * 7) % 50), cy = 5 + ((step * 5) % 25)
      h.cam.paint = dotAt(cx, cy)
      tips.push({ kind: 'laser', ...cell(cx, cy), confidence: 1, t: performance.now() })
    }
    move()
    const id = setInterval(move, 100)
    await vi.advanceTimersByTimeAsync(BOARD_INTERVAL_MS * 3)
    expect(h.reads()).toBe(1) // a laser alone starts no read
    h.cam.scene = 90 // the teacher has written something
    h.replies.push(fraction)
    await h.tick()
    await h.tick()
    expect(h.reads()).toBe(2)
    clearInterval(id)
    h.stop()
  })
})

describe('board loop: small writing on a board that was already read', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
  const twoMarks = (rgba: Uint8ClampedArray) => { // "x = 5" left and "x = 6" right: a few dark cells each
    for (const [x, y] of [[8, 10], [9, 10], [8, 11], [50, 10], [51, 10], [51, 11]]) rgba.fill(30, (y * 64 + x) * 4, (y * 64 + x) * 4 + 3)
  }
  const xs: Term[] = [
    { id: 1, latex: 'x', phrase: 'the x on the left', box: { x: 0.12, y: 0.27, w: 0.04, h: 0.06 } },
    { id: 2, latex: 'x', phrase: 'the x on the right', box: { x: 0.78, y: 0.27, w: 0.04, h: 0.06 } },
  ]

  it('reads the board again when a few small terms are written', async () => {
    const h = harness()
    h.cam.scene = 220
    h.replies.push(xs.slice(0, 0), [], xs) // blank board read twice (cleared), then the writing
    await h.tick()
    await h.tick()
    expect(h.reads()).toBe(2)
    h.cam.paint = twoMarks
    await h.tick()
    expect(h.reads()).toBe(3)
    expect(h.shown.at(-1)).toHaveLength(2)
    h.stop()
  })

  it('after one empty read, confirms with a second read even if the picture did not change again', async () => {
    const h = harness()
    h.cam.scene = 220
    h.replies.push(xs) // the board had two terms
    await h.tick()
    h.cam.scene = 90 // the teacher steps in front of the board: a big change, read comes back empty
    h.replies.push([])
    await h.tick()
    const readsAfterEmpty = h.reads()
    h.cam.scene = 220 // teacher steps away; only a tiny mark (2 cells, below the change rule) differs from the last good read
    h.cam.paint = (rgba: Uint8ClampedArray) => { for (const i of [10 * 64 + 8, 10 * 64 + 9]) rgba.fill(30, i * 4, i * 4 + 3) }
    h.replies.push(xs)
    await h.tick()
    expect(h.reads()).toBe(readsAfterEmpty + 1)
    h.stop()
  })

  it('reads again after a long quiet spell even if no change was seen (safety net)', async () => {
    const h = harness()
    h.cam.scene = 220
    h.replies.push(xs, xs) // the idle re-read sees the same board
    await h.tick()
    const reads = h.reads()
    await vi.advanceTimersByTimeAsync(IDLE_REREAD_MS + BOARD_INTERVAL_MS)
    expect(h.reads()).toBe(reads + 1)
    h.stop()
  })
})

describe('board loop: faster checks', () => {
  it('settles after READ_SETTLE_MS of stillness at the new tick', () => {
    expect(BOARD_TICK_MS).toBe(500)
    expect(isSettled(1, BOARD_TICK_MS, READ_SETTLE_MS)).toBe(false)
    expect(isSettled(2, BOARD_TICK_MS, READ_SETTLE_MS)).toBe(true)
  })
  it('reads a changed picture within ~1.5 s', async () => {
    const h = harness()
    h.replies.push(fraction)
    await vi.advanceTimersByTimeAsync(1500)
    expect(h.reads()).toBe(1)
  })
  it('scaleToMax keeps the long side at most 1024 and never enlarges', () => {
    expect(scaleToMax(1920, 1080, 1024)).toEqual({ w: 1024, h: 576 })
    expect(scaleToMax(1080, 1920, 1024)).toEqual({ w: 576, h: 1024 })
    expect(scaleToMax(640, 360, 1024)).toEqual({ w: 640, h: 360 })
  })
  it('the photo sent is at most 1024 px on its long side', async () => {
    const W = 2000, H = 1000
    const sizes: { w: number; h: number }[] = []
    const mk = () => {
      const c = {
        width: 0, height: 0,
        getContext: () => ({ drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(W * H * 4).fill(50) }) }),
        toBlob: (cb: (b: Blob | null) => void) => { sizes.push({ w: c.width, h: c.height }); cb(new Blob(['j'])) },
      }
      return c
    }
    vi.stubGlobal('document', { createElement: mk })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ terms: [] }) })))
    vi.useFakeTimers()
    const loop = startBoardLoop({ readyState: 4, videoWidth: W, videoHeight: H } as HTMLVideoElement, new TipBuffer(), () => {})
    await vi.advanceTimersByTimeAsync(2000)
    loop.stop()
    expect(sizes.length).toBeGreaterThan(0)
    expect(Math.max(sizes[0].w, sizes[0].h)).toBeLessThanOrEqual(1024)
  })
})

describe('board loop: lock', () => {
  it('a locked loop starts no read even when the frame changes; unlock resumes', async () => {
    const h = harness()
    h.lock(true)
    expect(h.locked()).toBe(true)
    h.replies.push(fraction)
    await h.tick()
    expect(h.reads()).toBe(0)
    expect(h.pending()).toBeNull()
    h.lock(false)
    await h.tick()
    expect(h.reads()).toBe(1)
  })
  it('reset unlocks', async () => {
    const h = harness()
    h.lock(true)
    h.reset()
    expect(h.locked()).toBe(false)
    h.replies.push(fraction)
    await h.tick()
    expect(h.reads()).toBe(1)
  })
})

describe('board loop: reading state', () => {
  it('is true while a read is in flight and false after', async () => {
    const h = harness()
    let release!: () => void
    h.fetchMock.mockImplementationOnce(() => new Promise(r => { release = () => r({ ok: true, json: async () => ({ terms: [] }) } as never) }))
    expect(h.reading()).toBe(false)
    await vi.advanceTimersByTimeAsync(1500)
    expect(h.reading()).toBe(true)
    release()
    await vi.advanceTimersByTimeAsync(10)
    expect(h.reading()).toBe(false)
  })
})

describe('board loop: lock during a read', () => {
  it('a read in flight when locked is ignored, reading() is false, and a later read applies after unlock', async () => {
    const h = harness()
    let answer!: (v: unknown) => void
    h.fetchMock.mockImplementationOnce(() => new Promise(r => { answer = r }) as never)
    await vi.advanceTimersByTimeAsync(1500)
    expect(h.reading()).toBe(true)
    h.lock(true)
    expect(h.reading()).toBe(false)
    answer({ ok: true, json: async () => ({ terms: fraction }) })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.shown).toEqual([])
    expect(h.reading()).toBe(false)
    h.lock(false)
    h.replies.push(fraction)
    await h.tick()
    expect(h.shown.at(-1)).toEqual(fraction)
  })
})

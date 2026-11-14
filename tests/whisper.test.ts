import { describe, it, expect, vi } from 'vitest'
import { WhisperQueue, createWhisperPlayer } from '../src/audio/whisper'
import type { Term, Resolution } from '../src/core/types'

describe('WhisperQueue', () => {
  it('first clip starts now', () => expect(new WhisperQueue(150).schedule(1000, 400)).toBe(1000))
  it('second clip waits for end1 + gap', () => {
    const q = new WhisperQueue(150)
    q.schedule(1000, 400)
    expect(q.schedule(1100, 300)).toBe(1550)
  })
  it('starts now after drain', () => {
    const q = new WhisperQueue(150)
    q.schedule(1000, 400)
    expect(q.schedule(5000, 300)).toBe(5000)
  })
  it('three rapid clips strictly ordered with gaps', () => {
    const q = new WhisperQueue(150)
    const s = [q.schedule(0, 100), q.schedule(0, 100), q.schedule(0, 100)]
    expect(s).toEqual([0, 250, 500])
  })
})

const term = (id: number, phrase: string, x = 0.5): Term => ({ id, latex: '', phrase, box: { x: x - 0.1, y: 0, w: 0.2, h: 0.1 } })
const res = (terms: Term[]): Resolution => ({ word: { word: 'this', t: 0, isPointer: true }, terms })

function fakeCtx(dur = 0.5, state = 'running') {
  const started: { buf: any; when: number; pan?: number; stop: any }[] = []
  const gains: any[] = []
  const ctx: any = {
    currentTime: 2,
    state,
    resume: vi.fn(async () => { ctx.state = 'running' }),
    destination: {},
    decodeAudioData: async (ab: ArrayBuffer) => ({ duration: dur, tag: ab.byteLength }),
    createBufferSource() {
      const s: any = { buffer: null, connect: vi.fn(() => s), stop: vi.fn(), start: (when: number) => started.push({ buf: s.buffer, when, pan: s.pan, stop: s.stop }) }
      return s
    },
    createGain() {
      const g: any = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(() => g) }
      gains.push(g)
      return g
    },
    createStereoPanner() { return { pan: { value: 0 }, connect: vi.fn() } },
  }
  return { ctx, started, gains }
}
const now = () => 5000

describe('createWhisperPlayer', () => {
  const setup = (fetchTts = async (t: string) => new ArrayBuffer(t.length)) => {
    const { ctx, started } = fakeCtx()
    const speak = vi.fn()
    const p = createWhisperPlayer({ fetchTts, ctx, speak, now })
    return { p, started, speak }
  }

  it('empty terms -> null', () => {
    const { p, started, speak } = setup()
    expect(p.play(res([]))).toBeNull()
    expect(started.length + speak.mock.calls.length).toBe(0)
  })
  it('disabled -> null', async () => {
    const { p, started } = setup()
    await p.prepare([term(1, 'x squared')])
    p.setEnabled(false)
    expect(p.enabled()).toBe(false)
    expect(p.play(res([term(1, 'x squared')]))).toBeNull()
    expect(started.length).toBe(0)
  })
  it('prepared phrase plays buffer at scheduled time', async () => {
    const { p, started, speak } = setup()
    await p.prepare([term(1, 'x squared')])
    const r = p.play(res([term(1, 'x squared')]))
    expect(r).toEqual({ startedAt: 5000 })
    expect(started).toHaveLength(1)
    expect(started[0].when).toBe(2)
    expect(speak).not.toHaveBeenCalled()
  })
  it('unprepared or failed phrase falls back to speech', async () => {
    const { p, started, speak } = setup(async () => { throw new Error('502') })
    await p.prepare([term(1, 'bad')])
    expect(p.play(res([term(1, 'bad')]))).not.toBeNull()
    p.play(res([term(2, 'never prepared')]))
    expect(speak.mock.calls.map(c => c[0])).toEqual(['bad', 'never prepared'])
    expect(started).toHaveLength(0)
  })
  it('multi-term plays in order with gap', async () => {
    const { p, started } = setup()
    const ts = [term(1, 'a'), term(2, 'bb'), term(3, 'ccc')]
    await p.prepare(ts)
    p.play(res(ts))
    expect(started.map(s => s.buf.tag)).toEqual([1, 2, 3])
    expect(started.map(s => s.when)).toEqual([2, 2.65, 3.3])
  })
  it('prepare fetches each phrase once', async () => {
    const f = vi.fn(async () => new ArrayBuffer(1))
    const { p } = setup(f)
    await p.prepare([term(1, 'a'), term(2, 'a')])
    await p.prepare([term(1, 'a')])
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('startedAt is on the perf clock for clips scheduled ahead', async () => {
    const { ctx } = fakeCtx(0.05)
    const p = createWhisperPlayer({ fetchTts: async () => new ArrayBuffer(1), ctx, speak: vi.fn(), now })
    const ts = [term(1, 'a'), term(2, 'b')]
    await p.prepare(ts)
    p.play(res([term(1, 'a')]))
    const r = p.play(res([term(2, 'b')]))
    expect(Math.abs(r!.startedAt - 5200)).toBeLessThanOrEqual(1)
  })
  it('resumes a suspended context before scheduling', async () => {
    const { ctx, started } = fakeCtx(0.5, 'suspended')
    const p = createWhisperPlayer({ fetchTts: async () => new ArrayBuffer(1), ctx, speak: vi.fn(), now })
    await p.prepare([term(1, 'a')])
    p.play(res([term(1, 'a')]))
    expect(ctx.resume).toHaveBeenCalled()
    expect(started).toHaveLength(1)
  })

  it('failed fetch is retried by the next prepare', async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error('502')).mockResolvedValue(new ArrayBuffer(1))
    const { p, started } = setup(f)
    await p.prepare([term(1, 'a')])
    await p.prepare([term(1, 'a')])
    expect(f).toHaveBeenCalledTimes(2)
    p.play(res([term(1, 'a')]))
    expect(started).toHaveLength(1)
  })
  it('skips empty phrases', async () => {
    const f = vi.fn(async () => new ArrayBuffer(1))
    const { p, started, speak } = setup(f)
    await p.prepare([term(1, '  ')])
    expect(f).not.toHaveBeenCalled()
    expect(p.play(res([term(1, '  ')]))).toBeNull()
    expect(started.length + speak.mock.calls.length).toBe(0)
  })
  it('same phrase already playing is not scheduled again', async () => {
    const { p, started } = setup()
    await p.prepare([term(1, 'a')])
    const a = p.play(res([term(1, 'a')]))
    const b = p.play(res([term(1, 'a')]))
    expect(started).toHaveLength(1)
    expect(b).toEqual(a)
  })
  it('duplicate of a clip already sounding never reports a start in the past', async () => {
    const { ctx } = fakeCtx()
    const p = createWhisperPlayer({ fetchTts: async () => new ArrayBuffer(1), ctx, speak: vi.fn(), now })
    await p.prepare([term(1, 'a')])
    p.play(res([term(1, 'a')])) // starts at ctx 2.0 s
    ctx.currentTime = 2.3 // 300 ms into the 500 ms clip; perf clock still 5000
    expect(p.play(res([term(1, 'a')]))!.startedAt).toBe(5000)
  })
  it('startedAt includes output latency', async () => {
    const { ctx } = fakeCtx()
    ctx.outputLatency = 0.04
    const p = createWhisperPlayer({ fetchTts: async () => new ArrayBuffer(1), ctx, speak: vi.fn(), now })
    await p.prepare([term(1, 'a')])
    expect(p.play(res([term(1, 'a')]))!.startedAt).toBeCloseTo(5040)
  })
  it('long backlog: fades active, drops queued, new clip starts at now + 80 ms', async () => {
    const { ctx, started, gains } = fakeCtx(0.1)
    const p = createWhisperPlayer({ fetchTts: async () => new ArrayBuffer(1), ctx, speak: vi.fn(), now })
    const ts = [term(1, 'a'), term(2, 'b'), term(3, 'c')]
    await p.prepare(ts)
    p.play(res([ts[0]])) // 2.00
    p.play(res([ts[1]])) // 2.25, wait 250 ms < cap: queued
    expect(started.map(s => s.when)).toEqual([2, 2.25])
    const r = p.play(res([ts[2]])) // wait would be 500 ms > cap
    expect(started[2].when).toBeCloseTo(2.08)
    expect(r!.startedAt).toBeCloseTo(5080)
    expect(started[0].stop).toHaveBeenCalledWith(expect.closeTo(2.03, 5)) // active: faded
    expect(gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.closeTo(2.03, 5))
    expect(started[1].stop).toHaveBeenCalledWith() // queued: dropped
  })
  it('unlock resumes a suspended context', () => {
    const { ctx } = fakeCtx(0.5, 'suspended')
    createWhisperPlayer({ ctx, speak: vi.fn(), now }).unlock()
    expect(ctx.resume).toHaveBeenCalled()
  })
})

describe('createWhisperPlayer: silent (classroom camera device)', () => {
  it('reports the whisper as delivered but plays and speaks nothing on this device', async () => {
    const { ctx, started } = fakeCtx()
    const speak = vi.fn()
    const p = createWhisperPlayer({ fetchTts: async t => new ArrayBuffer(t.length), ctx, speak, now })
    await p.prepare([term(1, 'x squared')])
    p.setSilent(true)
    expect(p.play(res([term(1, 'x squared'), term(2, 'not prepared')]))).toEqual({ startedAt: 5000 })
    expect(started).toHaveLength(0)
    expect(speak).not.toHaveBeenCalled()
    p.setSilent(false)
    expect(p.play(res([term(1, 'x squared')]))).not.toBeNull()
    expect(started).toHaveLength(1)
  })

  it('"without app" (disabled) still wins over silent: nothing is delivered', () => {
    const p = createWhisperPlayer({ fetchTts: async () => new ArrayBuffer(1), ctx: fakeCtx().ctx, speak: vi.fn(), now })
    p.setSilent(true)
    p.setEnabled(false)
    expect(p.play(res([term(1, 'x squared')]))).toBeNull()
  })
})

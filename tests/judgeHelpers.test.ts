import { describe, it, expect } from 'vitest'
import { finalTimes, applyMark, notesPayload, type Row } from '../src/ui/judgeHelpers'
import { createTranscript } from '../src/transcript/store'
import type { Resolution } from '../src/core/types'

describe('finalTimes', () => {
  it('web speech -> [now, now]', () => expect(finalTimes('web', 0, 0, 5000, 9000)).toEqual([9000, 9000]))
  it('transcribe -> audioStart + seconds*1000', () => expect(finalTimes('transcribe', 1.5, 2.25, 5000, 9000)).toEqual([6500, 7250]))
  it('transcribe without audioStart -> [now, now]', () => expect(finalTimes('transcribe', 1, 2, null, 9000)).toEqual([9000, 9000]))
  it('a perf-clock resolution attaches to a final mapped by the helper', () => {
    const tr = createTranscript()
    const r: Resolution = { word: { word: 'this', t: 7000, isPointer: true }, terms: [] }
    tr.addResolution(r)
    tr.addFinal('this one', ...finalTimes('transcribe', 1.5, 2.25, 5000, 9000))
    expect(tr.segments()[0].resolutions).toEqual([r])
    tr.addResolution({ ...r, word: { ...r.word, t: 20000 } })
    tr.addFinal('x', ...finalTimes('web', 0, 0, null, 9000))
    expect(tr.segments()[1].resolutions).toEqual([])
  })
})

describe('applyMark', () => {
  it('tally survives eviction of marked rows', () => {
    let rows: Row[] = [{ id: 1, line: 'a' }]
    let tally = { correct: 0, total: 0 }
    ;({ rows, tally } = applyMark(rows, tally, 'y'))
    rows = [{ id: 2, line: 'b' }] // evicted
    ;({ rows, tally } = applyMark(rows, tally, 'n'))
    expect(tally).toEqual({ correct: 1, total: 2 })
    expect(applyMark(rows, tally, 'y').tally).toEqual({ correct: 1, total: 2 }) // nothing left to mark
  })
})

describe('notesPayload', () => {
  it('keeps the last 200 segments and clips text to 1000 chars', () => {
    const segs = Array.from({ length: 250 }, (_, i) => ({ text: String(i).padEnd(1500, 'x'), t0: 0, t1: 0, resolutions: [] }))
    const p = notesPayload(segs).segments
    expect(p).toHaveLength(200)
    expect(p[0].said.startsWith('50x')).toBe(true)
    expect(p[0].said).toHaveLength(1000)
    expect(p[0].meant).toHaveLength(1000)
  })
})

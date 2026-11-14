import { describe, it, expect } from 'vitest'
import { median, markNewest, marksOf, notesPayload, notesText, parseLine, type Row } from './judgeHelpers'
import type { Segment } from '../transcript/store'

const rows: Row[] = [{ id: 3, line: 'c' }, { id: 2, line: 'b' }, { id: 1, line: 'a' }]
const seg: Segment = { text: 'Look at this.', t0: 0, t1: 1, resolutions: [{ word: { word: 'this', t: 0.5 } as never, terms: [{ phrase: 'x squared' } as never] }] }

describe('helpers', () => {
  it('median', () => { expect(median([3, 1, 2])).toBe(2); expect(median([1, 2, 3, 4])).toBe(2.5) })
  it('marks newest unmarked row', () => {
    const a = markNewest(rows, 'y'), b = markNewest(a, 'n')
    expect(b.map(r => r.mark)).toEqual(['y', 'n', undefined])
    expect(marksOf(b)).toEqual({ correct: 1, total: 2 })
    expect(markNewest(markNewest(b, 'y'), 'y').filter(r => r.mark).length).toBe(3)
  })
  it('notes payload and text', () => {
    expect(notesPayload([seg])).toEqual({ segments: [{ said: 'Look at this.', meant: 'Look at x squared.' }] })
    const t = notesText([seg], { rewrite: ['r1'], summary: ['s1'] })
    expect(t).toContain('Meant: Look at x squared.')
    expect(t).toContain('- r1')
    expect(t).toContain('- s1')
  })
  it('parses log lines', () => {
    expect(parseLine('this → x squared · 0.42 s')).toEqual({ head: 'this', body: 'x squared', tail: '0.42 s', kind: 'played' })
    expect(parseLine('that → a, b · muted')).toEqual({ head: 'that', body: 'a, b', tail: 'muted', kind: 'muted' })
    expect(parseLine('this → silent')).toEqual({ head: 'this', body: '', tail: 'silent', kind: 'silent' })
    expect(parseLine('board → 3 terms · 1.10 s').kind).toBe('played')
    expect(parseLine('board → empty')).toEqual({ head: 'board', body: 'empty', tail: '', kind: 'plain' })
  })
})

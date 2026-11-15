import { describe, it, expect } from 'vitest'
import { isRoomName, parseCameraMsg, studentLinkPath, whisperFromResolution, MAX_BOARD_PHRASES, MAX_PHRASE } from '../src/live/roomProtocol'
import type { Resolution } from '../src/core/types'

describe('room names', () => {
  it('accepts short lowercase course names', () => {
    for (const r of ['math201', 'bio-110', 'a']) expect(isRoomName(r)).toBe(true)
  })
  it('rejects empty, long, spaced, upper case or odd characters', () => {
    for (const r of ['', 'Math201', 'math 201', 'x'.repeat(41), '../etc', 'math201?', 3, null]) expect(isRoomName(r)).toBe(false)
  })
})

describe('parseCameraMsg (what the camera device may send)', () => {
  it('accepts a whisper, a board snapshot, a notice and a status', () => {
    expect(parseCameraMsg(JSON.stringify({ type: 'whisper', word: 'this', items: [{ phrase: 'the 2x on top', x: 0.3 }] })))
      .toEqual({ type: 'whisper', word: 'this', items: [{ phrase: 'the 2x on top', x: 0.3 }] })
    expect(parseCameraMsg(JSON.stringify({ type: 'board', phrases: ['the 2x on top', 'the 3 on the bottom'] })))
      .toEqual({ type: 'board', phrases: ['the 2x on top', 'the 3 on the bottom'] })
    expect(parseCameraMsg(JSON.stringify({ type: 'notice', text: 'Class is ending.' }))).toEqual({ type: 'notice', text: 'Class is ending.' })
    expect(parseCameraMsg(JSON.stringify({ type: 'status', open: true }))).toEqual({ type: 'status', open: true })
  })

  it('drops unknown fields so nothing extra is relayed to students', () => {
    expect(parseCameraMsg(JSON.stringify({ type: 'notice', text: 'hi', evil: '<script>' }))).toEqual({ type: 'notice', text: 'hi' })
  })

  it('rejects junk, unknown types and oversized or malformed fields', () => {
    const bad = [
      'not json', '42', 'null', JSON.stringify({ type: 'hack' }),
      JSON.stringify({ type: 'whisper', word: 'this', items: [] }),
      JSON.stringify({ type: 'whisper', word: 'this', items: [{ phrase: '', x: 0.5 }] }),
      JSON.stringify({ type: 'whisper', word: 'this', items: [{ phrase: 'p', x: 2 }] }),
      JSON.stringify({ type: 'whisper', word: 'x'.repeat(30), items: [{ phrase: 'p', x: 0.5 }] }),
      JSON.stringify({ type: 'whisper', word: 'this', items: Array.from({ length: 9 }, () => ({ phrase: 'p', x: 0.5 })) }),
      JSON.stringify({ type: 'board', phrases: ['p'.repeat(MAX_PHRASE + 1)] }),
      JSON.stringify({ type: 'board', phrases: Array.from({ length: MAX_BOARD_PHRASES + 1 }, () => 'p') }),
      JSON.stringify({ type: 'board', phrases: [3] }),
      JSON.stringify({ type: 'notice', text: 'n'.repeat(301) }),
      JSON.stringify({ type: 'status', open: 'yes' }),
    ]
    for (const raw of bad) expect(parseCameraMsg(raw), raw).toBeNull()
  })

  it('allows an empty board (the board was erased)', () =>
    expect(parseCameraMsg(JSON.stringify({ type: 'board', phrases: [] }))).toEqual({ type: 'board', phrases: [] }))
})

describe('board overview', () => {
  const board = (extra: object) => JSON.stringify({ type: 'board', phrases: ['a', 'b'], ...extra })
  it('is optional and relayed when valid', () => {
    expect(parseCameraMsg(board({ overview: ['the equation: a'] }))).toEqual({ type: 'board', phrases: ['a', 'b'], overview: ['the equation: a'] })
    expect(parseCameraMsg(board({}))).toEqual({ type: 'board', phrases: ['a', 'b'] })
  })
  it('rejects a bad overview', () => {
    for (const overview of ['x', [3], ['p'.repeat(MAX_PHRASE + 1)], Array.from({ length: MAX_BOARD_PHRASES + 1 }, () => 'p'), ['']])
      expect(parseCameraMsg(board({ overview })), JSON.stringify(overview).slice(0, 30)).toBeNull()
  })
})

describe('whisperFromResolution', () => {
  const r = (terms: { phrase: string; x: number; w: number }[]): Resolution => ({
    word: { word: 'these', t: 1 } as Resolution['word'],
    terms: terms.map((t, i) => ({ id: i + 1, latex: 'x', phrase: t.phrase, box: { x: t.x, y: 0.1, w: t.w, h: 0.1 } })),
  })
  it('sends each term phrase with its horizontal centre, for left/right panning on the phone', () =>
    expect(whisperFromResolution(r([{ phrase: 'the x on the left', x: 0.1, w: 0.1 }, { phrase: 'the y on the right', x: 0.8, w: 0.1 }])))
      .toEqual({ type: 'whisper', word: 'these', items: [{ phrase: 'the x on the left', x: 0.15000000000000002 }, { phrase: 'the y on the right', x: 0.8500000000000001 }] }))
  it('returns null when nothing was resolved (nothing to whisper)', () => expect(whisperFromResolution(r([]))).toBeNull())
})

describe('studentLinkPath', () => {
  it('builds the saved link a student opens', () =>
    expect(studentLinkPath('math201', 'tok_123')).toBe('/?student&room=math201&t=tok_123'))
})

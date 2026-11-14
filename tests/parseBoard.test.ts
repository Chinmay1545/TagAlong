import { describe, it, expect } from 'vitest'
import { parseBoardResponse } from '../server/parseBoard'
import { BOARD_PROMPT } from '../server/prompt'

const ok = '{"terms":[{"latex":"2x","phrase":"the 2x on top","box":{"x":0.2,"y":0.2,"w":0.1,"h":0.1}}]}'
const t = (latex: string, phrase: string, box: unknown) => ({ latex, phrase, box })
const wrap = (...terms: unknown[]) => JSON.stringify({ terms })

describe('parseBoardResponse', () => {
  it('drops a term whose phrase is only whitespace', () => {
    expect(parseBoardResponse(wrap(t('2x', '   ', { x: 0.2, y: 0.2, w: 0.1, h: 0.1 })))).toEqual([])
  })
  it('parses a valid response', () => {
    expect(parseBoardResponse(ok)).toEqual([{ id: 1, latex: '2x', phrase: 'the 2x on top', box: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } }])
  })
  it('strips code fences and prose', () => {
    expect(parseBoardResponse('```json\n' + ok + '\n```')).toHaveLength(1)
    expect(parseBoardResponse('Here you go: ' + ok)).toHaveLength(1)
  })
  it('never throws on garbage', () => {
    expect(parseBoardResponse('not json')).toEqual([])
    expect(parseBoardResponse('{broken')).toEqual([])
    expect(parseBoardResponse('')).toEqual([])
    expect(parseBoardResponse('{"terms": "nope"}')).toEqual([])
    expect(parseBoardResponse('{}')).toEqual([])
  })
  it('clamps boxes', () => {
    const [a] = parseBoardResponse(wrap(t('a', 'the a', { x: 0.95, y: 0.1, w: 0.2, h: 0.1 })))
    expect(a.box.x).toBe(0.95)
    expect(a.box.w).toBeCloseTo(0.05)
    expect(a.box.y).toBe(0.1)
    expect(a.box.h).toBe(0.1)
  })
  it('drops bad terms and renumbers', () => {
    const good = (l: string) => t(l, 'the ' + l, { x: 0.1, y: 0.1, w: 0.1, h: 0.1 })
    const r = parseBoardResponse(wrap(good('a'), { latex: 'b', box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }, good('c')))
    expect(r.map(x => [x.id, x.latex])).toEqual([[1, 'a'], [2, 'c']])
    expect(parseBoardResponse(wrap(t('a', 'p', { x: 1.2, y: 0.1, w: 0.1, h: 0.1 })))).toEqual([])
    expect(parseBoardResponse(wrap(t('a', 'p', { x: 0.1, y: 0.1, w: 0, h: 0.1 })))).toEqual([])
    expect(parseBoardResponse(wrap(t('a', '', { x: 0.1, y: 0.1, w: 0.1, h: 0.1 })))).toEqual([])
    expect(parseBoardResponse(wrap(t('a', 'p', { x: 'q', y: 0.1, w: 0.1, h: 0.1 })))).toEqual([])
  })
  it('exports the prompt', () => {
    expect(BOARD_PROMPT.startsWith('You are reading a whiteboard photo')).toBe(true)
    expect(BOARD_PROMPT.endsWith('reply {"terms":[]}.')).toBe(true)
  })
})

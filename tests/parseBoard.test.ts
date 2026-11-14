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
    const r = parseBoardResponse(wrap(good('a'), { latex: 'b', phrase: 'the b' }, good('c'))) // no box
    expect(r.map(x => [x.id, x.latex])).toEqual([[1, 'a'], [2, 'c']])
    expect(parseBoardResponse(wrap(t('a', 'p', { x: 1.2, y: 0.1, w: 0.1, h: 0.1 })))).toEqual([])
    expect(parseBoardResponse(wrap(t('a', 'p', { x: 0.1, y: 0.1, w: 0, h: 0.1 })))).toEqual([])
    expect(parseBoardResponse(wrap(t('a', '', { x: 0.1, y: 0.1, w: 0.1, h: 0.1 })))).toEqual([])
    expect(parseBoardResponse(wrap(t('a', 'p', { x: 'q', y: 0.1, w: 0.1, h: 0.1 })))).toEqual([])
  })
  it('exports the prompt: compact lines, no phrase', () => {
    expect(BOARD_PROMPT.startsWith('You are reading a whiteboard photo')).toBe(true)
    expect(BOARD_PROMPT).toContain('latex|tag|x|y|w|h')
    expect(BOARD_PROMPT).toContain('0 to 1000')
    expect(BOARD_PROMPT).not.toMatch(/phrase/i)
    expect(BOARD_PROMPT.endsWith('reply with the single word EMPTY.')).toBe(true)
  })
  it('old JSON without a phrase gets one built from the LaTeX and position', () => {
    expect(parseBoardResponse(wrap({ latex: 'x^2', box: { x: 0.45, y: 0.15, w: 0.1, h: 0.1 } }))).toEqual([
      { id: 1, latex: 'x^2', phrase: 'x squared', box: { x: 0.45, y: 0.15, w: 0.1, h: 0.1 } },
    ])
  })
})

describe('parseBoardResponse: compact line format', () => {
  it('parses latex|x|y|w|h in thousandths and builds the phrase', () => {
    expect(parseBoardResponse('2x|237|211|95|150\n(x + 3)|439|211|231|153\n')).toEqual([
      { id: 1, latex: '2x', phrase: '2x', box: { x: 0.237, y: 0.211, w: 0.095, h: 0.15 } },
      { id: 2, latex: '(x + 3)', phrase: 'x plus 3', box: { x: 0.439, y: 0.211, w: 0.231, h: 0.153 } },
    ])
  })
  it('keeps pipes inside the LaTeX (absolute value): the last four fields are the box', () => {
    expect(parseBoardResponse('|x|-1|100|100|100|100')[0].latex).toBe('|x|-1')
  })
  it('ignores fences, prose, blank and broken lines; EMPTY means no terms', () => {
    const r = parseBoardResponse('```\nHere are the terms:\n2x|100|100|50|50\n\nbad|1|2\ny|a|b|c|d\n|100|100|50|50\n```')
    expect(r.map(t => t.latex)).toEqual(['2x'])
    expect(parseBoardResponse('EMPTY')).toEqual([])
  })
  it('clamps boxes to the frame and drops empty ones', () => {
    expect(parseBoardResponse('a|950|100|200|100')[0].box).toEqual({ x: 0.95, y: 0.1, w: expect.closeTo(0.05) as unknown as number, h: 0.1 })
    expect(parseBoardResponse('a|100|100|0|100')).toEqual([])
  })
  it('accepts 0-1 decimals too, in case the model ignores the scale', () => {
    expect(parseBoardResponse('a|0.2|0.2|0.1|0.1')[0].box).toEqual({ x: 0.2, y: 0.2, w: 0.1, h: 0.1 })
  })
})

describe('parseBoardResponse: tagged lines', () => {
  it('reads latex|tag|x|y|w|h and builds the contract phrase', () => {
    const r = parseBoardResponse('2x|top|237|211|95|150\n(x + 3)|top|439|211|231|153\n2x|bottom|439|560|96|149\n2x(x+3)|numerator|237|211|433|153\n\\frac{2x(x+3)}{2x}|fraction|219|211|562|498')
    expect(r.map(t => t.phrase)).toEqual(['2x, in the top', 'x plus 3, in the top', '2x, in the bottom', 'the top: 2x times x plus 3', 'the fraction: 2x times x plus 3, over 2x'])
    expect(r[0].box).toEqual({ x: 0.237, y: 0.211, w: 0.095, h: 0.15 })
    expect(r.map(t => t.id)).toEqual([1, 2, 3, 4, 5])
  })
  it('an unknown tag is treated as none', () => {
    expect(parseBoardResponse('2x|banana|237|211|95|150')[0].phrase).toBe('2x')
  })
  it('keeps pipes inside the LaTeX when a tag is present', () => {
    const [t] = parseBoardResponse('|x|-1|left|100|100|100|100')
    expect(t.latex).toBe('|x|-1')
    expect(t.phrase.endsWith(', on the left side')).toBe(true)
  })
  it('old 5-field lines with a pipe in the LaTeX still parse', () => {
    expect(parseBoardResponse('|x||100|100|100|100')[0].latex).toBe('|x|')
    expect(parseBoardResponse('|x|100|100|100|100')[0].latex).toBe('|x')
  })
})

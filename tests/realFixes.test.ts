import { describe, expect, it } from 'vitest'
import { tidyTerms, uniquePhrases, phraseFor } from '../src/core/phrase'
import { speakMath } from '../src/core/speakMath'
import { overview } from '../src/live/overview'
import { clipPhrase, MAX_PHRASE } from '../src/live/roomProtocol'
import { TTS_MAX_CHARS } from '../src/core/config'
import { createClassroom } from '../src/live/classroom'
import type { Term } from '../src/core/types'

const t = (id: number, phrase: string, x: number, y: number, w: number, h: number): Term => ({ id, latex: phrase, phrase, box: { x, y, w, h } })

describe('tidyTerms', () => {
  const big = t(1, 'the top: a times b', 0.1, 0.1, 0.5, 0.2)
  it('a top inside a larger top becomes the brackets, keeping id, box and latex', () => {
    const inner = t(2, 'the top: a', 0.1, 0.1, 0.2, 0.2)
    const out = tidyTerms([big, inner])
    expect(out[1]).toEqual({ ...inner, phrase: 'the brackets: a' })
    expect(out[0]).toBe(big)
  })
  it('a bottom inside a top stays, and it is idempotent', () => {
    const b = t(2, 'the bottom: a', 0.1, 0.1, 0.2, 0.2)
    expect(tidyTerms([big, b])[1]).toBe(b)
    const once = tidyTerms([big, t(2, 'the top: a', 0.1, 0.1, 0.2, 0.2)])
    expect(tidyTerms(once).map(x => x.phrase)).toEqual(once.map(x => x.phrase))
  })
  it('drops an exact twin (same phrase, same box)', () => {
    expect(tidyTerms([t(1, 'the brackets: a', 0.1, 0.1, 0.2, 0.2), t(2, 'the brackets: a', 0.1, 0.1, 0.2, 0.2)]).map(x => x.id)).toEqual([1])
  })
})

describe('uniquePhrases tells equal phrases apart by the math', () => {
  it('in the top / in the bottom', () => {
    const out = uniquePhrases([
      t(1, 'the top: p', 0.1, 0.1, 0.5, 0.2), t(2, 'the bottom: q', 0.1, 0.6, 0.5, 0.2),
      t(3, 'the brackets: x plus 3', 0.2, 0.1, 0.1, 0.2), t(4, 'the brackets: x plus 3', 0.2, 0.6, 0.1, 0.2),
    ])
    expect(out.slice(2).map(x => x.phrase)).toEqual(['the brackets: x plus 3, in the top', 'the brackets: x plus 3, in the bottom'])
  })
  it('equation numbers when no side group contains them', () => {
    const out = uniquePhrases([
      t(1, 'the equation: a equals 0', 0.1, 0.1, 0.5, 0.1), t(2, 'the equation: b equals 0', 0.1, 0.5, 0.5, 0.1),
      t(3, '0, on the right side', 0.5, 0.1, 0.05, 0.1), t(4, '0, on the right side', 0.5, 0.5, 0.05, 0.1),
    ])
    expect(out.slice(2).map(x => x.phrase)).toEqual(['0, on the right side, in equation 1', '0, on the right side, in equation 2'])
  })
})

describe('overview numbers equal kinds', () => {
  it('two equations are numbered, one of a kind is not', () => {
    const two = [t(1, 'the equation: a equals 1', 0.1, 0.1, 0.4, 0.1), t(2, 'the equation: b equals 2', 0.1, 0.5, 0.4, 0.1)]
    expect(overview(two)).toEqual(['equation 1: a equals 1', 'equation 2: b equals 2'])
    expect(overview([two[0]])).toEqual(['the equation: a equals 1'])
  })
})

describe('speech', () => {
  it('negatives', () => {
    expect(speakMath('-3')).toBe('negative 3')
    expect(speakMath('y = -3')).toBe('y equals negative 3')
    expect(speakMath('9 - 3')).toBe('9 minus 3')
  })
  it('powers', () => {
    expect(speakMath('x^4')).toBe('x to the fourth')
    expect(speakMath('x^10')).toBe('x to the tenth')
    expect(speakMath('x^n')).toBe('x to the n')
    expect(speakMath('x^2 + y^3')).toBe('x squared plus y cubed')
  })
  it('cdot', () => {
    expect(phraseFor('(x + 3) \\cdot 2x', { x: 0, y: 0, w: 1, h: 1 })).toBe('the quantity x plus 3, times 2x')
  })
})

describe('one clip', () => {
  it('the caps are 300 and equal', () => { expect(MAX_PHRASE).toBe(300); expect(TTS_MAX_CHARS).toBe(300) })
  it('clips at a word boundary and is idempotent', () => {
    const c = clipPhrase('word '.repeat(80))
    expect(c.length).toBeLessThanOrEqual(300)
    expect(c.endsWith('word')).toBe(true)
    expect(clipPhrase(c)).toBe(c)
    expect(clipPhrase('a'.repeat(400))).toHaveLength(300)
  })
  it('a board message stays under 15000 characters', async () => {
    const sent: unknown[] = []
    const room = createClassroom({
      connect: (_u, on) => { setTimeout(() => on.onState?.('open')); return { send: m => sent.push(m), close() {} } },
      fetchLink: async () => '/x', location: { protocol: 'https:', host: 'h', origin: 'https://h' },
    })
    await room.open('r1')
    await new Promise(r => setTimeout(r))
    const long = 'the equation: ' + 'x plus 1 '.repeat(40)
    room.board(Array.from({ length: 80 }, (_, i) => t(i + 1, `${long} ${i}`, 0.1, 0.01 + i * 0.01, 0.3, 0.005)))
    const b = sent.at(-1) as { phrases: string[]; overview: string[] }
    expect(JSON.stringify(b).length).toBeLessThanOrEqual(15000)
    expect(b.phrases.length).toBeLessThan(80)
    expect(b.overview.length).toBeGreaterThan(0)
  })
})

describe('numbered container', () => {
  it('only an equation or a fraction is numbered; side groups are not', () => {
    const out = uniquePhrases([
      t(1, 'the left side: y', 0.1, 0.1, 0.3, 0.2), t(2, 'the left side: y', 0.1, 0.6, 0.3, 0.2),
      t(3, 'y', 0.15, 0.15, 0.05, 0.05), t(4, 'y', 0.15, 0.65, 0.05, 0.05),
    ])
    expect(out.some(x => x.phrase.includes('in left side'))).toBe(false)
    expect(new Set(out.map(x => x.phrase)).size).toBe(4)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseBoardResponse } from '../server/parseBoard'
import { uniquePhrases } from '../src/core/phrase'
import { TipBuffer } from '../src/core/tipBuffer'
import { createLive } from '../src/live/live'
import { overview } from '../src/live/overview'
import type { Resolution, Term } from '../src/core/types'
import type { WordItem } from '../src/speech/words'
import type { AnyPoint } from '../src/vision/pointer'
import { inOrder, move, rest } from './helpers/board'

// The board the team writes and presents. Left: (x^2-9)/(x^2+5x+6) = ((x-3)(x+3))/((x+2)(x+3)). Right: 3(x-4)+5 = 2x+9.
// What the model replies for it: every term first, then the groups, boxes in thousandths and nested.
const REPLY = `
x^2|top|60|300|50|70
9|top|140|300|30|70
x^2|bottom|60|470|50|70
5x|bottom|125|470|50|70
6|bottom|190|470|30|70
x - 3|top|270|300|70|70
x + 3|top|360|300|70|70
x + 2|bottom|270|470|70|70
x + 3|bottom|360|470|70|70
3|left|540|340|30|70
x|bracket|610|340|35|70
4|bracket|665|340|30|70
5|left|740|340|30|70
2x|right|820|340|60|70
9|right|930|340|30|70
x^2 - 9|numerator|60|300|110|70
x^2 + 5x + 6|denominator|60|470|160|70
(x - 3)(x + 3)|numerator|270|300|160|70
(x + 2)(x + 3)|denominator|270|470|160|70
\\frac{x^2 - 9}{x^2 + 5x + 6}|fraction|60|300|160|240
\\frac{(x - 3)(x + 3)}{(x + 2)(x + 3)}|fraction|270|300|160|240
(x - 4)|group|590|330|110|90
\\frac{x^2 - 9}{x^2 + 5x + 6}|lhs|60|300|160|240
\\frac{(x - 3)(x + 3)}{(x + 2)(x + 3)}|rhs|270|300|160|240
3(x - 4) + 5|lhs|540|330|230|90
2x + 9|rhs|820|340|140|70
\\frac{x^2 - 9}{x^2 + 5x + 6} = \\frac{(x - 3)(x + 3)}{(x + 2)(x + 3)}|equation|60|300|370|240
3(x - 4) + 5 = 2x + 9|equation|540|330|420|90
`.trim()

const terms: Term[] = uniquePhrases(parseBoardResponse(REPLY))
const by = (phrase: string, nth = 0) => terms.filter(t => t.phrase === phrase)[nth]
const mid = (t: Term) => ({ x: t.box.x + t.box.w / 2, y: t.box.y + t.box.h / 2 })

const EXPECTED = [
  'x squared, in the top', '9, in the top', 'x squared, in the bottom', '5x, in the bottom', '6, in the bottom',
  'x minus 3, in the top', 'x plus 3, in the top', 'x plus 2, in the bottom', 'x plus 3, in the bottom',
  '3, on the left side', 'x, in the brackets', '4, in the brackets', '5, on the left side', '2x, on the right side', '9, on the right side',
  'the top: x squared minus 9', 'the bottom: x squared plus 5x plus 6',
  'the top: the quantity x minus 3, times the quantity x plus 3', 'the bottom: the quantity x plus 2, times the quantity x plus 3',
  'the fraction: x squared minus 9, over x squared plus 5x plus 6',
  'the fraction: the quantity x minus 3, times the quantity x plus 3, over the quantity x plus 2, times the quantity x plus 3',
  'the brackets: x minus 4',
  'the left side: x squared minus 9, over x squared plus 5x plus 6',
  'the right side: the quantity x minus 3, times the quantity x plus 3, over the quantity x plus 2, times the quantity x plus 3',
  'the left side: 3 times the quantity x minus 4, plus 5', 'the right side: 2x plus 9',
  'the equation: x squared minus 9, over x squared plus 5x plus 6, equals the quantity x minus 3, times the quantity x plus 3, over the quantity x plus 2, times the quantity x plus 3',
  'the equation: 3 times the quantity x minus 4, plus 5 equals 2x plus 9',
]

describe('the demo board, as the reader gives it', () => {
  it('has the exact phrase of every item', () => expect(terms.map(t => t.phrase)).toEqual(EXPECTED))
  it('never says a screen position', () => {
    for (const t of terms) expect(t.phrase).not.toMatch(/\bon (the )?(top|bottom)\b|top left|top right|in the middle/)
  })
  it('overview: the two equations, the left one first', () => {
    expect(overview(terms)).toEqual([EXPECTED[26], EXPECTED[27]])
  })
})

// A fake clock drives everything: points reach the tip buffer and words reach createLive at their own
// times (ms from the start), like the camera and Transcribe would deliver them.
let base = 0
beforeEach(() => { vi.useFakeTimers(); base = performance.now() })
afterEach(() => { vi.useRealTimers() })

function session(points: AnyPoint[]) {
  const tips = new TipBuffer(60_000)
  const played: string[] = []
  let enabled = true
  const player = {
    play: (r: Resolution) => { if (!enabled) return null; played.push(r.terms.map(t => t.phrase).join(' | ')); return { startedAt: performance.now() } },
    setEnabled: (on: boolean) => { enabled = on },
  }
  const live = createLive({ getTerms: () => terms, tips, player: player as never })
  points.forEach(p => setTimeout(() => tips.push({ ...p, t: p.t + base }), p.t))
  const items: WordItem[] = []
  let seg = 0
  return {
    live, played,
    // Transcribe: each word arrives `lag` ms after it started, with the utterance so far.
    say(words: [string, number][], lag = 50) {
      const segment = ++seg
      words.forEach(([w, at]) => setTimeout(() => {
        items.push({ content: w, startTime: at / 1000, isPartial: false, arrivedAt: performance.now(), segment })
        live.handleItems([...items], base)
      }, at + lag))
    },
    // Browser speech: no timing, the word arrives some time after it was said.
    sayLate(word: string, arrivesAt: number) {
      setTimeout(() => live.handleItems([{ content: word, isPartial: false, arrivedAt: performance.now(), segment: ++seg }], null, true), arrivesAt)
    },
    run: (ms: number) => vi.advanceTimersByTime(ms),
  }
}
const at = (t: Term) => mid(t)
const topB = () => at(by('x plus 3, in the top')), botB = () => at(by('x plus 3, in the bottom'))

describe('the six demo moments, through the real pointing code', () => {
  it('0. whisper off: "this cancels with that" at both (x+3) plays nothing', () => {
    const s = session(inOrder(rest('finger', topB().x, topB().y, 0, 1300), move('finger', topB(), botB(), 1333, 1500), rest('finger', botB().x, botB().y, 1533, 3000)))
    s.live.setWhisperEnabled(false)
    s.say([['this', 500], ['cancels', 700], ['with', 950], ['that', 2000]])
    s.run(4000)
    expect(s.played).toEqual([])
  })
  it('1. rest on the top (x+3) "this", then the bottom (x+3) "that"', () => {
    const s = session(inOrder(rest('finger', topB().x, topB().y, 0, 1300), move('finger', topB(), botB(), 1333, 1500), rest('finger', botB().x, botB().y, 1533, 3000)))
    s.say([['this', 500], ['cancels', 700], ['with', 950], ['that', 2000]])
    s.run(4000)
    expect(s.played).toEqual(['x plus 3, in the top', 'x plus 3, in the bottom'])
  })
  it('2. a hand sweeping across the left top with "this whole top part"', () => {
    const s = session(move('finger', { x: 0.05, y: 0.335 }, { x: 0.19, y: 0.335 }, 300, 700))
    s.say([['this', 500], ['whole', 620], ['top', 740], ['part', 860]])
    s.run(3000)
    expect(s.played).toEqual(['the top: x squared minus 9'])
  })
  it('3. rest on the 3 "this", then on the bracket "this bracket"', () => {
    const three = at(by('3, on the left side')), paren = { x: 0.592, y: 0.375 }
    const s = session(inOrder(rest('finger', three.x, three.y, 0, 1300), move('finger', three, paren, 1333, 1500), rest('finger', paren.x, paren.y, 1533, 3000)))
    s.say([['this', 500]])
    s.say([['this', 2000], ['bracket', 2120]])
    s.run(4000)
    expect(s.played).toEqual(['3, on the left side', 'the brackets: x minus 4'])
  })
  it('4. rest on the 5 "this", then on the right side "that side"', () => {
    const five = at(by('5, on the left side')), gap = { x: 0.905, y: 0.375 }
    const s = session(inOrder(rest('finger', five.x, five.y, 0, 1300), move('finger', five, gap, 1333, 1500), rest('finger', gap.x, gap.y, 1533, 3000)))
    s.say([['this', 500]])
    s.say([['that', 2000], ['side', 2120]])
    s.run(4000)
    expect(s.played).toEqual(['5, on the left side', 'the right side: 2x plus 9'])
  })
  it('5. no pointing, "this is my favourite part": nothing', () => {
    const s = session([])
    s.say([['this', 500], ['is', 620], ['my', 700], ['favourite', 800], ['part', 1000]])
    s.run(3000)
    expect(s.played).toEqual([])
  })
  it('a finger resting on the bar of the left fraction, "this": that fraction', () => {
    const s = session(rest('finger', 0.14, 0.42, 0, 2000))
    s.say([['this', 500]])
    s.run(3000)
    expect(s.played).toEqual(['the fraction: x squared minus 9, over x squared plus 5x plus 6'])
  })
})

describe('edge cases', () => {
  it('a word that arrives late (browser speech): the finger has left, the term it rested on is still whispered', () => {
    const s = session(inOrder(rest('finger', topB().x, topB().y, 0, 800), move('finger', topB(), { x: 0.95, y: 0.95 }, 833, 1300)))
    s.sayLate('this', 1300)
    s.run(2500)
    expect(s.played).toEqual(['x plus 3, in the top'])
  })
  it('"this" said while the finger is still moving, then it rests within the recheck window', () => {
    const s = session(inOrder(move('finger', { x: 0.9, y: 0.9 }, topB(), 500, 930), rest('finger', topB().x, topB().y, 950, 2000)))
    s.say([['this', 1000], ['is', 1100], ['it', 1200]])
    s.run(3000)
    expect(s.played).toEqual(['x plus 3, in the top'])
  })
  it('a finger halfway between the two top brackets (x-3) and (x+3) says nothing', () => {
    const a = by('x minus 3, in the top').box, b = by('x plus 3, in the top').box
    const gap = { x: (a.x + a.w + b.x) / 2, y: a.y + a.h / 2 }
    const s = session(rest('finger', gap.x, gap.y, 0, 2000))
    s.say([['this', 500]])
    s.run(3000)
    expect(s.played).toEqual([])
  })
  it('"this" + "is all about": the plain term, not a group', () => {
    const s = session(rest('finger', topB().x, topB().y, 0, 2000))
    s.say([['this', 500], ['is', 620], ['all', 740], ['about', 860]])
    s.run(3000)
    expect(s.played).toEqual(['x plus 3, in the top'])
  })
  it('a later sentence\'s "top" more than 800 ms after "this": the plain term', () => {
    const s = session(rest('finger', topB().x, topB().y, 0, 3000))
    s.say([['this', 500], ['is', 700], ['true', 900], ['top', 1700]], 1300) // all arrive together, after the last word
    s.run(4000)
    expect(s.played).toEqual(['x plus 3, in the top'])
  })
})

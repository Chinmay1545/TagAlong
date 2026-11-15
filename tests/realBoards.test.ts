import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseBoardResponse } from '../server/parseBoard'
import { uniquePhrases } from '../src/core/phrase'
import { GROUP, groupKind } from '../src/core/scope'
import { TipBuffer } from '../src/core/tipBuffer'
import { createLive } from '../src/live/live'
import { overview } from '../src/live/overview'
import type { Resolution, Term } from '../src/core/types'
import type { WordItem } from '../src/speech/words'
import type { AnyPoint } from '../src/vision/pointer'
import { inOrder, move, rest, rng } from './helpers/board'

// Real replies of the live reader for three chalkboards (boards 1 and 4 are the same chalkboard, 2 and 5 are
// the same one, 3 is the third). Everything below runs the real modules, no mocks of our code.
//   A: ((2x^3 + 5x^2)(x + 3)) / ((x + 3) * 2x)            (boards 1, 4)
//   B: ((4x^3 + 3x^2 + 2x)(y + y^2 + 1)) / ((x^4 + 9x^2 + 9)(y + 1)(y + 3))   (boards 2, 5)
//   C: 83x^3 + 4x^2 - 9x + 5 = 0 ; (y - 1)(y + 3) = 0 ; y = 1 or y = -3     (board 3)
const load = (n: number): Term[] => uniquePhrases(parseBoardResponse(readFileSync(new URL(`./fixtures/real/real-board-${n}.txt`, import.meta.url), 'utf8')))
const BOARDS = [1, 2, 3, 4, 5].map(n => ({ n, terms: load(n) }))

const CONTRACT = GROUP
const isGroup = (t: Term) => CONTRACT.test(t.phrase)
const TOL = 0.01
type Box = Term['box']
const inside = (a: Box, b: Box) => a.x >= b.x - TOL && a.y >= b.y - TOL && a.x + a.w <= b.x + b.w + TOL && a.y + a.h <= b.y + b.h + TOL
const area = (t: Term) => t.box.w * t.box.h
const mid = (t: Term) => ({ x: t.box.x + t.box.w / 2, y: t.box.y + t.box.h / 2 })
const near = (b: Box, p: { x: number; y: number }, m: number) => p.x >= b.x - m && p.x <= b.x + b.w + m && p.y >= b.y - m && p.y <= b.y + b.h + m

describe('speech on the real boards', () => {
  it('board 1', () => expect(BOARDS[0].terms.map(t => t.phrase)).toMatchInlineSnapshot(`
    [
      "2x cubed, in the brackets",
      "5x squared, in the brackets",
      "x plus 3, top of the fraction",
      "x plus 3, bottom of the fraction",
      "2x, bottom of the fraction",
      "the brackets: 2x cubed plus 5x squared",
      "the top of the fraction: the quantity 2x cubed plus 5x squared, times the quantity x plus 3",
      "the bottom of the fraction: the quantity x plus 3, times 2x",
      "the fraction: the quantity 2x cubed plus 5x squared, times the quantity x plus 3, over the quantity x plus 3, times 2x",
    ]
  `))
  it('board 2', () => expect(BOARDS[1].terms.map(t => t.phrase)).toMatchInlineSnapshot(`
    [
      "4x cubed, top of the fraction",
      "3x squared, top of the fraction",
      "2x, top of the fraction",
      "y, top of the fraction",
      "y squared, top of the fraction",
      "1, top of the fraction",
      "x to the fourth, bottom of the fraction",
      "9x squared, bottom of the fraction",
      "9, bottom of the fraction",
      "y plus 1, bottom of the fraction",
      "y plus 3, bottom of the fraction",
      "the brackets: 4x cubed plus 3x squared plus 2x",
      "the brackets: y plus y squared plus 1",
      "the top of the fraction: the quantity 4x cubed plus 3x squared plus 2x, times the quantity y plus y squared plus 1",
      "the bottom of the fraction: the quantity x to the fourth plus 9x squared plus 9, times the quantity y plus 1, times the quantity y plus 3",
      "the fraction: the quantity 4x cubed plus 3x squared plus 2x, times the quantity y plus y squared plus 1, over the quantity x to the fourth plus 9x squared plus 9, times the quantity y plus 1, times the quantity y plus 3",
      "the brackets: x to the fourth plus 9x squared plus 9",
      "the brackets: y plus 1",
      "the brackets: y plus 3",
    ]
  `))
  it('board 3', () => expect(BOARDS[2].terms.map(t => t.phrase)).toMatchInlineSnapshot(`
    [
      "83x cubed, left side of the equation",
      "4x squared, left side of the equation",
      "9x, left side of the equation",
      "5, left side of the equation",
      "0, right side of the equation, in equation 1",
      "y minus 1, left side of the equation",
      "y plus 3, left side of the equation",
      "0, right side of the equation, in equation 2",
      "y, left side of the equation, in equation 3",
      "1, right side of the equation",
      "y, left side of the equation, in equation 4",
      "negative 3, right side of the equation",
      "the left side of the equation: 83x cubed plus 4x squared minus 9x plus 5",
      "the right side of the equation: 0, in equation 1",
      "the equation: 83x cubed plus 4x squared minus 9x plus 5 equals 0",
      "the left side of the equation: the quantity y minus 1, times the quantity y plus 3",
      "the right side of the equation: 0, in equation 2",
      "the equation: the quantity y minus 1, times the quantity y plus 3, equals 0",
      "the left side of the equation: y, in equation 3",
      "the right side of the equation: 1",
      "the equation: y equals 1",
      "the left side of the equation: y, in equation 4",
      "the right side of the equation: negative 3",
      "the equation: y equals negative 3",
    ]
  `))
  it('board 4', () => expect(BOARDS[3].terms.map(t => t.phrase)).toMatchInlineSnapshot(`
    [
      "2x cubed, top of the fraction",
      "5x squared, top of the fraction",
      "x, top of the fraction",
      "3, top of the fraction",
      "x, bottom of the fraction",
      "3, bottom of the fraction",
      "2x, bottom of the fraction",
      "the brackets: 2x cubed plus 5x squared",
      "the brackets: x plus 3, top of the fraction",
      "the brackets: x plus 3, bottom of the fraction",
      "the top of the fraction: the quantity 2x cubed plus 5x squared, times the quantity x plus 3",
      "the bottom of the fraction: the quantity x plus 3, times 2x",
      "the fraction: the quantity 2x cubed plus 5x squared, times the quantity x plus 3, over the quantity x plus 3, times 2x",
    ]
  `))
  it('board 5', () => expect(BOARDS[4].terms.map(t => t.phrase)).toMatchInlineSnapshot(`
    [
      "4x cubed, top of the fraction",
      "3x squared, top of the fraction",
      "2x, top of the fraction",
      "y, top of the fraction",
      "y squared, top of the fraction",
      "1, top of the fraction",
      "x to the fourth, bottom of the fraction",
      "9x squared, bottom of the fraction",
      "9, bottom of the fraction",
      "y, bottom of the fraction, in the brackets y plus 1",
      "1, bottom of the fraction",
      "y, bottom of the fraction, in the brackets y plus 3",
      "3, bottom of the fraction",
      "the brackets: 4x cubed plus 3x squared plus 2x",
      "the brackets: y plus y squared plus 1",
      "the brackets: x to the fourth plus 9x squared plus 9",
      "the brackets: y plus 1",
      "the brackets: y plus 3",
      "the top of the fraction: the quantity 4x cubed plus 3x squared plus 2x, times the quantity y plus y squared plus 1",
      "the bottom of the fraction: the quantity x to the fourth plus 9x squared plus 9, times the quantity y plus 1, times the quantity y plus 3",
      "the fraction: the quantity 4x cubed plus 3x squared plus 2x, times the quantity y plus y squared plus 1, over the quantity x to the fourth plus 9x squared plus 9, times the quantity y plus 1, times the quantity y plus 3",
    ]
  `))

  for (const { n, terms } of BOARDS) {
    it(`board ${n}: unique, no screen words, short, groups match the contract`, () => {
      const phrases = terms.map(t => t.phrase)
      expect(new Set(phrases.map(p => p.toLowerCase())).size).toBe(phrases.length)
      for (const p of phrases) {
        expect(p).not.toMatch(/\b(upper|lower|middle)\b|on top|from the (left|top)/)
        expect(p.length).toBeLessThanOrEqual(300)
      }
      for (const t of terms) if (/^the /.test(t.phrase) && /: /.test(t.phrase)) expect(t.phrase).toMatch(CONTRACT)
    })
  }
})

// A fake clock drives everything: points reach the tip buffer and words reach createLive at their own times
// (ms from the start), like the camera and Transcribe would deliver them.
let base = 0
beforeEach(() => { vi.useFakeTimers(); base = performance.now() })
afterEach(() => { vi.useRealTimers() })

// Plays one session over `terms`: returns what the recording player was asked to say (one string per answer).
function play(terms: Term[], points: AnyPoint[], words: [string, number][], runMs = 3000): string[] {
  const tips = new TipBuffer(60_000)
  const played: string[] = []
  const player = { play: (r: Resolution) => { played.push(r.terms.map(t => t.phrase).join(' | ')); return { startedAt: performance.now() } }, setEnabled: () => {} }
  const live = createLive({ getTerms: () => terms, tips, player: player as never })
  points.forEach(p => setTimeout(() => tips.push({ ...p, t: p.t + base }), p.t))
  const items: WordItem[] = []
  words.forEach(([w, at]) => setTimeout(() => {
    items.push({ content: w, startTime: at / 1000, isPartial: false, arrivedAt: performance.now(), segment: 1 })
    live.handleItems([...items], base)
  }, at + 50))
  vi.advanceTimersByTime(runMs)
  return played
}

// A finger resting 400 ms at (x, y), 30 Hz, with the shake of a real hand; "this" said mid-rest.
const point = (terms: Term[], seed: number, p: { x: number; y: number }) => play(terms, rest('finger', p.x, p.y, 0, 400, 0.008, 33, rng(seed)), [['this', 200]], 2000)

function targets(t: Term) {
  const { x, y, w, h } = t.box
  const c = mid(t)
  const inner = [{ x: x + w * 0.25, y: c.y }, { x: x + w * 0.75, y: c.y }, { x: c.x, y: y + h * 0.25 }, { x: c.x, y: y + h * 0.75 }]
  const free = { left: x, right: 1 - x - w, top: y, bottom: 1 - y - h }
  const side = (Object.keys(free) as (keyof typeof free)[]).reduce((a, b) => (free[b] > free[a] ? b : a))
  const edge = side === 'left' ? { x: x - 0.01, y: c.y } : side === 'right' ? { x: x + w + 0.01, y: c.y } : side === 'top' ? { x: c.x, y: y - 0.01 } : { x: c.x, y: y + h + 0.01 }
  return { centre: [c], inner, edge: [edge] }
}

describe('pointing at every single term, like a real hand', () => {
  for (const { n, terms } of BOARDS) {
    it(`board ${n}`, () => {
      const singles = terms.filter(t => !isGroup(t))
      const tally = { centre: [0, 0], inner: [0, 0], edge: [0, 0] }
      let wrong = 0, silent = 0, other = 0
      const problems: string[] = []
      for (const t of singles) {
        for (const [kind, pts] of Object.entries(targets(t)) as ['centre' | 'inner' | 'edge', { x: number; y: number }[]][]) {
          for (const p of pts) for (let seed = 1; seed <= 5; seed++) {
            const out = point(terms, seed, p)
            tally[kind][1]++
            if (out.length === 1 && out[0] === t.phrase) tally[kind][0]++
            else if (!out.length) silent++
            else if (kind === 'edge' && out.length === 1 && terms.some(o => o.phrase === out[0] && near(o.box, p, 0.015))) other++ // a box really under the finger (a neighbour 0.01 away, or the group around)
            else { wrong++; problems.push(`${kind} "${t.phrase}" (id ${t.id}) at ${p.x.toFixed(3)},${p.y.toFixed(3)} -> ${JSON.stringify(out)}`) }
          }
        }
      }
      console.log(`board ${n}: centre ${tally.centre[0]}/${tally.centre[1]}, inner ${tally.inner[0]}/${tally.inner[1]}, edge ${tally.edge[0]}/${tally.edge[1]} (wrong ${wrong}, silent ${silent}, other box under the finger ${other})`)
      expect(problems.slice(0, 10)).toEqual([])
      expect(tally.centre[0]).toBe(tally.centre[1])
      expect(tally.inner[0]).toBe(tally.inner[1])
    })
  }
})

describe('pointing in the gap between two neighbouring terms', () => {
  for (const { n, terms } of BOARDS) {
    it(`board ${n}: the containing group or silence, never a wrong single term`, () => {
      const singles = terms.filter(t => !isGroup(t))
      const smallestGroup = (t: Term) => terms.filter(g => isGroup(g) && g !== t && inside(t.box, g.box)).sort((a, b) => area(a) - area(b))[0]
      const pairs: [Term, Term][] = []
      for (const a of singles) for (const b of singles) {
        const g = smallestGroup(a)
        if (a === b || !g || smallestGroup(b) !== g || a.box.x + a.box.w > b.box.x) continue
        if (Math.abs(mid(a).y - mid(b).y) > Math.min(a.box.h, b.box.h) / 2) continue
        if (singles.some(c => c !== a && c !== b && mid(c).x > mid(a).x && mid(c).x < mid(b).x && Math.abs(mid(c).y - mid(a).y) < a.box.h)) continue
        pairs.push([a, b])
      }
      expect(pairs.length).toBeGreaterThan(0)
      const wrong: string[] = []
      for (const [a, b] of pairs) {
        const p = { x: (a.box.x + a.box.w + b.box.x) / 2, y: (mid(a).y + mid(b).y) / 2 }
        for (let seed = 1; seed <= 5; seed++) {
          for (const said of point(terms, seed, p)) {
            const hit = singles.find(s => s.phrase === said)
            if (hit && !near(hit.box, p, 0.015)) wrong.push(`"${said}" for the gap between "${a.phrase}" and "${b.phrase}"`)
          }
        }
      }
      expect(wrong).toEqual([])
    })
  }
})

describe('pointing plus a group word', () => {
  // [words said after "this", group kinds that answer]
  const CASES: [string, string[], string[]][] = [
    ['top', ['top'], ['this', 'top', 'part']],
    ['bottom', ['bottom'], ['this', 'bottom']],
    ['fraction', ['fraction'], ['this', 'fraction']],
    ['side', ['left side', 'right side'], ['that', 'side']],
    ['equation', ['equation'], ['this', 'equation']],
    ['brackets', ['brackets'], ['this', 'bracket']],
  ]
  for (const { n, terms } of BOARDS) {
    for (const [name, kinds, said] of CASES) {
      const kind = kinds.join('/')
      const singles = terms.filter(t => !isGroup(t))
      const expectedFor = (t: Term) => terms.filter(g => kinds.includes(groupKind(g.phrase) ?? '') && inside(t.box, g.box)).sort((a, b) => area(a) - area(b))[0]
      const subjects = singles.filter(expectedFor)
      if (!subjects.length) continue
      it(`board ${n}: "${said.join(' ')}" on a term in a ${kind} gives that ${kind}`, () => {
        const bad: string[] = []
        for (const t of subjects) {
          const want = expectedFor(t)
          const words = said.map((w, i) => [w, 200 + i * 120] as [string, number])
          const out = play(terms, rest('finger', mid(t).x, mid(t).y, 0, 600, 0.008, 33, rng(3)), words, 2500)
          if (out.length !== 1 || out[0] !== want.phrase) bad.push(`on "${t.phrase}": wanted "${want.phrase}", got ${JSON.stringify(out)}`)
        }
        expect(bad).toEqual([])
      })
    }
  }
})

describe('a "these" sweep across a numerator', () => {
  for (const { n, terms } of BOARDS) {
    const tops = terms.filter(t => groupKind(t.phrase) === 'top')
    if (!tops.length) continue
    it(`board ${n}: the single terms of the top, left to right, no groups`, () => {
      const top = tops.sort((a, b) => area(b) - area(a))[0]
      const singles = terms.filter(t => !isGroup(t) && inside(t.box, top.box)).sort((a, b) => mid(a).x - mid(b).x)
      expect(singles.length).toBeGreaterThan(2)
      const leg = Math.floor(900 / (singles.length - 1)) // the word is answered when it arrives, so the sweep (under 1 s) comes just before it
      const legs = singles.slice(1).map((s, i) => move('finger', mid(singles[i]), mid(s), 100 + i * leg, 100 + (i + 1) * leg))
      const out = play(terms, inOrder(...legs), [['these', 1050]], 3000)
      expect(out).toEqual([singles.map(s => s.phrase).join(' | ')])
    })
  }
})

describe('what is on the board, in short', () => {
  it('boards with one fraction give one "the fraction" item', () => {
    for (const i of [0, 1, 3, 4]) {
      const o = overview(BOARDS[i].terms)
      expect(o).toHaveLength(1)
      expect(o[0]).toMatch(/^the fraction: /)
    }
  })
  it('board 3 gives four numbered equations', () => {
    expect(overview(BOARDS[2].terms)).toMatchInlineSnapshot(`
      [
        "equation 1: 83x cubed plus 4x squared minus 9x plus 5 equals 0",
        "equation 2: the quantity y minus 1, times the quantity y plus 3, equals 0",
        "equation 3: y equals 1",
        "equation 4: y equals negative 3",
      ]
    `)
  })
})

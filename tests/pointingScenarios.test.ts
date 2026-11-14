import { describe, expect, it, vi } from 'vitest'
import { TipBuffer } from '../src/core/tipBuffer'
import { createLive } from '../src/live/live'
import { HOLD_MAX_MS } from '../src/core/config'
import type { Box, Resolution, Term } from '../src/core/types'
import type { AnyPoint, PointerKind } from '../src/vision/pointer'
import type { WordItem } from '../src/speech/words'
import { BOARD_TERMS, G, N3, T1, T3, X, centre, inOrder, move, rest, rng } from './helpers/board'

// Whole-path tests: pointer points go in, words are "said", and we check what would be whispered.
// Everything between is real: the buffer, the pointer priority, the gate, the resolver and the hold.
function scene(points: AnyPoint[], opts: { terms?: Term[]; pending?: Box | null; bufferMs?: number } = {}) {
  let terms = opts.terms ?? BOARD_TERMS
  let region = opts.pending ?? null
  let clock = points.length ? Math.max(...points.map(p => p.t)) : 0
  let enabled = true
  let seg = 0
  const tips = new TipBuffer(opts.bufferMs)
  inOrder(points).forEach(p => tips.push(p))
  const play = vi.fn((_r: Resolution) => (enabled ? { startedAt: clock + 10 } : null))
  const live = createLive({ getTerms: () => terms, tips, player: { play, setEnabled: on => { enabled = on } }, now: () => clock, getPendingRegion: () => region })
  const got: { word: string; terms: string[]; whispered: boolean }[] = []
  live.onResolution((r, ms) => got.push({ word: r.word.word, terms: r.terms.map(t => t.phrase), whispered: ms !== null }))
  return {
    live, play, got, tips,
    heard: () => got.map(g => g.terms),
    // A word the recogniser reports at time t (no word timing: browser speech).
    say: (word: string, t: number) => live.handleItems([{ content: word, isPartial: false, arrivedAt: t, segment: ++seg }], null),
    // A whole sentence with word timings (Transcribe): [word, seconds from the start of the audio].
    sayTimed: (words: [string, number][], arrivedAt = clock) =>
      live.handleItems(words.map(([content, startTime]): WordItem => ({ content, startTime, isPartial: false, arrivedAt, segment: seg })), 0),
    items: (items: WordItem[]) => live.handleItems(items, null),
    setTerms: (t: Term[]) => { terms = t },
    setRegion: (r: Box | null) => { region = r },
    advance: (ms: number) => { clock += ms },
    mute: () => live.setWhisperEnabled(false),
    add: (pts: AnyPoint[]) => { inOrder(pts).forEach(p => tips.push(p)); clock = Math.max(clock, ...pts.map(p => p.t)) },
  }
}
const c1 = centre(T1), c3 = centre(T3), cx = centre(X), cn = centre(N3)
const names = (...ts: Term[]) => ts.map(t => t.phrase)

describe('scenario: "this cancels with that"', () => {
  // The pointer rests on the top-left 2x, moves, and rests on the bottom 2x.
  const path = (kind: PointerKind) => inOrder(rest(kind, c1.x, c1.y, 0, 600, 0.004), move(kind, c1, c3, 633, 867), rest(kind, c3.x, c3.y, 900, 1500, 0.004))

  it.each(['finger', 'stick', 'laser', 'mouse'] as const)('with a %s: two whispers, the right terms, in order', kind => {
    const s = scene(path(kind))
    s.say('this', 300)
    s.say('that', 1200)
    expect(s.heard()).toEqual([names(T1), names(T3)])
    expect(s.play).toHaveBeenCalledTimes(2)
    expect(s.got.every(g => g.whispered)).toBe(true)
  })
  it.each(['stick', 'laser'] as const)('with a %s while the hand that holds it rests near another term: the tool decides', kind => {
    const s = scene(inOrder(path(kind), rest('finger', cn.x, cn.y, 0, 1500, 0.004)))
    s.say('this', 300)
    s.say('that', 1200)
    expect(s.heard()).toEqual([names(T1), names(T3)])
  })
  it('with word timings (Transcribe), a sentence that arrives late is resolved at the time each word was said', () => {
    const s = scene(path('finger'))
    s.sayTimed([['so', 0.1], ['this', 0.3], ['cancels', 0.6], ['with', 0.9], ['that', 1.2]])
    expect(s.heard()).toEqual([names(T1), names(T3)])
    expect(s.got.map(g => g.word)).toEqual(['this', 'that'])
  })
  it('the words in the other order point the other way', () => {
    const s = scene(path('finger'))
    s.sayTimed([['that', 0.3], ['this', 1.2]])
    expect(s.heard()).toEqual([names(T1), names(T3)])
    expect(s.got.map(g => g.word)).toEqual(['that', 'this'])
  })
  it('a word said while the pointer is travelling between the two terms is silent', () => {
    const s = scene(inOrder(rest('finger', c1.x, c1.y, 0, 300), move('finger', c1, c3, 333, 1200), rest('finger', c3.x, c3.y, 1233, 2500)))
    s.say('this', 800)
    expect(s.heard()).toEqual([[]])
    expect(s.play).not.toHaveBeenCalled()
  })
  it('"this" said twice on the same term whispers twice', () => {
    const s = scene(rest('finger', c1.x, c1.y, 0, 1500))
    s.say('this', 400)
    s.say('this', 1100)
    expect(s.heard()).toEqual([names(T1), names(T1)])
  })
  it('the recogniser sending the same word again (partial, then final) whispers once', () => {
    const s = scene(rest('finger', c1.x, c1.y, 0, 1500))
    s.items([{ content: 'this', isPartial: true, arrivedAt: 400, segment: 5 }])
    s.items([{ content: 'this', isPartial: true, arrivedAt: 450, segment: 5 }, { content: 'cancels', isPartial: true, arrivedAt: 450, segment: 5 }])
    s.items([{ content: 'this', isPartial: false, arrivedAt: 500, segment: 5 }, { content: 'cancels', isPartial: false, arrivedAt: 500, segment: 5 }])
    expect(s.heard()).toEqual([names(T1)])
  })
})

describe('scenario: how the word is written', () => {
  it.each(['This', 'THAT', 'here', 'this,', 'That.', 'Here!', '"this"'])('%s is a pointer word', w => {
    const s = scene(rest('finger', c1.x, c1.y, 0, 1500))
    s.say(w, 800)
    expect(s.heard()).toEqual([names(T1)])
  })
  it.each(['the', 'thus', 'there', 'cancels', 'thing', 'hear', 'thistle', ''])('"%s" is not a pointer word: nothing happens at all', w => {
    const s = scene(rest('finger', c1.x, c1.y, 0, 1500))
    s.say(w, 800)
    expect(s.got).toEqual([])
    expect(s.play).not.toHaveBeenCalled()
  })
  it('a long sentence with no pointer word never whispers, even with a finger resting on a term', () => {
    const s = scene(rest('finger', c1.x, c1.y, 0, 1500))
    s.sayTimed('so the top and the bottom are equal and we can cancel'.split(' ').map((w, i) => [w, i * 0.1]))
    expect(s.got).toEqual([])
  })
})

describe('scenario: the bracket group', () => {
  it.each([
    ['on the x', cx, X],
    ['on the 3', cn, N3],
    ['on the plus sign', { x: 0.555, y: 0.285 }, G],
    ['on the closing bracket', { x: 0.665, y: 0.285 }, G],
  ])('pointer resting %s', (_w, at, want) => {
    const s = scene(rest('finger', at.x, at.y, 0, 1500, 0.003))
    s.say('this', 800)
    expect(s.heard()).toEqual([names(want)])
  })
  it('"this" on the x, then "that" on the whole group', () => {
    const plus = { x: 0.555, y: 0.3 }
    const s = scene(inOrder(rest('laser', cx.x, cx.y, 0, 600, 0.004), move('laser', cx, plus, 633, 767), rest('laser', plus.x, plus.y, 800, 1500, 0.004)))
    s.say('this', 300)
    s.say('that', 1200)
    expect(s.heard()).toEqual([names(X), names(G)])
  })
})

describe('scenario: nothing to whisper', () => {
  it('no pointer in view', () => {
    const s = scene([])
    s.say('this', 500)
    expect(s.heard()).toEqual([[]])
  })
  it('a hand in view, resting far from any term', () => {
    const s = scene(rest('finger', 0.1, 0.9, 0, 1500))
    s.say('that', 800)
    expect(s.heard()).toEqual([[]])
  })
  it('a hand waving over the board while "that" is said in passing', () => {
    const wave = inOrder(move('finger', { x: 0.1, y: 0.3 }, { x: 0.9, y: 0.3 }, 0, 500), move('finger', { x: 0.9, y: 0.3 }, { x: 0.1, y: 0.3 }, 533, 1000), move('finger', { x: 0.1, y: 0.3 }, { x: 0.9, y: 0.3 }, 1033, 1500))
    const s = scene(wave)
    for (const t of [200, 500, 800, 1100, 1400]) s.say('that', t)
    expect(s.heard()).toEqual([[], [], [], [], []])
    expect(s.play).not.toHaveBeenCalled()
  })
  it('a pointer resting on a term, but the board has no boxes yet', () => {
    const s = scene(rest('finger', c1.x, c1.y, 0, 1500), { terms: [] })
    s.say('this', 800)
    expect(s.heard()).toEqual([[]])
  })
  it('a word from before the pointer buffer starts (too old) is silent, not wrong', () => {
    const s = scene(inOrder(rest('finger', c1.x, c1.y, 0, 600), rest('finger', c3.x, c3.y, 4000, 5000)))
    s.sayTimed([['this', 0.3]])
    expect(s.heard()).toEqual([[]])
  })
  it('without the app: the term is still found, but nothing is whispered', () => {
    const s = scene(rest('finger', c1.x, c1.y, 0, 1500))
    s.mute()
    s.say('this', 800)
    expect(s.got).toEqual([{ word: 'this', terms: names(T1), whispered: false }])
  })
})

describe('scenario: more than one pointer in the picture', () => {
  it('the mouse (demo mode) beats a laser, a stick and a hand', () => {
    const s = scene(inOrder(rest('mouse', c1.x, c1.y, 0, 1500), rest('laser', cn.x, cn.y, 0, 1500), rest('stick', cx.x, cx.y, 0, 1500), rest('finger', c3.x, c3.y, 0, 1500)))
    s.say('this', 800)
    expect(s.heard()).toEqual([names(T1)])
  })
  it('one or two false laser dots do not take over from a resting finger', () => {
    const blip: AnyPoint[] = [{ kind: 'laser', x: 0.9, y: 0.9, confidence: 0.4, t: 780 }, { kind: 'laser', x: 0.9, y: 0.9, confidence: 0.4, t: 813 }]
    const s = scene(inOrder(rest('finger', c1.x, c1.y, 0, 1500), blip))
    s.say('this', 800)
    expect(s.heard()).toEqual([names(T1)])
  })
  it('a laser sweeping past while the hand that holds it sits still near a term: silent (the hand is not the pointer)', () => {
    const s = scene(inOrder(move('laser', { x: 0.1, y: 0.6 }, { x: 0.9, y: 0.6 }, 300, 1300), rest('finger', c1.x, c1.y, 0, 1500)))
    s.say('this', 800)
    expect(s.heard()).toEqual([[]])
  })
  it('"these" follows the stick tip across two terms, not the still hand', () => {
    const s = scene(inOrder(move('stick', { x: 0.2, y: 0.285 }, { x: 0.7, y: 0.285 }, 0, 1500), rest('finger', c3.x, c3.y, 0, 1500)), { terms: [T1, G, T3] })
    s.say('these', 800)
    expect(s.heard()).toEqual([names(T1, G)])
  })
  it('the teacher puts the laser away and points with a finger: the finger counts again', () => {
    // Laser on the top-left 2x until 0.6 s, then switched off. Finger resting on the bottom 2x all along.
    const s = scene(inOrder(rest('laser', c1.x, c1.y, 200, 600), rest('finger', c3.x, c3.y, 0, 1500)))
    s.say('this', 1000)
    expect(s.heard()).toEqual([names(T3)])
  })
  it('a laser switched on only after the word does not change what the finger pointed at', () => {
    const s = scene(inOrder(rest('finger', c3.x, c3.y, 0, 1500), rest('laser', c1.x, c1.y, 1300, 1500)))
    s.sayTimed([['this', 1.0]])
    expect(s.heard()).toEqual([names(T3)])
  })
})

describe('scenario: pointing a little off', () => {
  it('a shaky finger whose average is on the term', () => {
    const s = scene(rest('finger', c3.x, c3.y, 0, 1500, 0.015))
    s.say('this', 800)
    expect(s.heard()).toEqual([names(T3)])
  })
  it('resting just outside a term (within reach) still counts', () => {
    const s = scene(rest('finger', T3.box.x + T3.box.w + 0.04, c3.y, 0, 1500, 0.003))
    s.say('this', 800)
    expect(s.heard()).toEqual([names(T3)])
  })
  it('resting just out of reach is silent', () => {
    const s = scene(rest('finger', T3.box.x + T3.box.w + 0.08, c3.y, 0, 1500, 0.003))
    s.say('this', 800)
    expect(s.heard()).toEqual([[]])
  })
  it('a finger a hair outside the x, but inside the bracket group: still the x', () => {
    // Fingertip tracking is only good to about a hundredth of the picture.
    const s = scene(rest('finger', X.box.x - 0.008, cx.y, 0, 1500, 0.002))
    s.say('this', 800)
    expect(s.heard()).toEqual([names(X)])
  })
})

describe('scenario: write, then point (held words)', () => {
  const NEW_A: Term = { id: 10, latex: 'y', phrase: 'the new y', box: { x: 0.66, y: 0.66, w: 0.08, h: 0.08 } }
  const NEW_B: Term = { id: 11, latex: 'z', phrase: 'the new z', box: { x: 0.81, y: 0.81, w: 0.08, h: 0.08 } }
  const fresh: Box = { x: 0.6, y: 0.6, w: 0.38, h: 0.38 } // ink written but not read yet
  const a = { x: 0.7, y: 0.7 }, b = { x: 0.85, y: 0.85 }

  it.each(['finger', 'stick', 'laser'] as const)('a %s resting on new ink: held, then whispered when the box arrives', kind => {
    const s = scene(rest(kind, a.x, a.y, 0, 1500, 0.004), { pending: fresh })
    s.say('this', 800)
    expect(s.got).toEqual([])
    s.advance(2000)
    s.setTerms([...BOARD_TERMS, NEW_A])
    s.live.checkHeld()
    expect(s.heard()).toEqual([names(NEW_A)])
    expect(s.play).toHaveBeenCalledTimes(1)
  })
  it('two held words at two new terms: each is whispered when its own box arrives', () => {
    const s = scene(inOrder(rest('finger', a.x, a.y, 0, 600), move('finger', a, b, 633, 867), rest('finger', b.x, b.y, 900, 1500)), { pending: fresh })
    s.say('this', 300)
    s.say('that', 1200)
    expect(s.got).toEqual([])
    s.setTerms([...BOARD_TERMS, NEW_A])
    s.live.checkHeld()
    expect(s.got.map(g => [g.word, g.terms])).toEqual([['this', names(NEW_A)]])
    s.setTerms([...BOARD_TERMS, NEW_A, NEW_B])
    s.live.checkHeld()
    expect(s.got.map(g => [g.word, g.terms])).toEqual([['this', names(NEW_A)], ['that', names(NEW_B)]])
    s.live.checkHeld()
    expect(s.got).toHaveLength(2)
  })
  it('a held word does not block a normal one: "that" on an old term is whispered at once', () => {
    const s = scene(inOrder(rest('finger', a.x, a.y, 0, 600), move('finger', a, c1, 633, 867), rest('finger', c1.x, c1.y, 900, 1500)), { pending: fresh })
    s.say('this', 300)
    s.say('that', 1200)
    expect(s.got.map(g => [g.word, g.terms])).toEqual([['that', names(T1)]])
    s.setTerms([...BOARD_TERMS, NEW_A])
    s.live.checkHeld()
    expect(s.got.map(g => g.word)).toEqual(['that', 'this'])
    expect(s.got[1].terms).toEqual(names(NEW_A))
  })
  it('the read finishes and there is no box where the pointer was: silent, once', () => {
    const s = scene(rest('finger', a.x, a.y, 0, 1500), { pending: fresh })
    s.say('this', 800)
    s.setTerms([...BOARD_TERMS, NEW_B]) // a box arrived, but somewhere else
    s.live.checkHeld()
    expect(s.got).toEqual([]) // still reading: keep waiting
    s.setRegion(null) // read done
    s.live.checkHeld()
    s.live.checkHeld()
    expect(s.heard()).toEqual([[]])
  })
  it('gives up after HOLD_MAX_MS even if the board never settles', () => {
    const s = scene(rest('finger', a.x, a.y, 0, 1500), { pending: fresh })
    s.say('this', 800)
    s.advance(HOLD_MAX_MS + 1)
    s.live.checkHeld()
    expect(s.heard()).toEqual([[]])
    s.setTerms([...BOARD_TERMS, NEW_A]) // too late
    s.live.checkHeld()
    expect(s.got).toHaveLength(1)
  })
  it('a hand passing over the new ink is not held', () => {
    const s = scene(move('finger', { x: 0.3, y: 0.7 }, { x: 1.1, y: 0.7 }, 300, 1300), { pending: fresh })
    s.say('this', 800)
    expect(s.heard()).toEqual([[]])
  })
  it('resting on empty board away from the new ink is not held', () => {
    const s = scene(rest('finger', 0.1, 0.9, 0, 1500), { pending: fresh })
    s.say('this', 800)
    expect(s.heard()).toEqual([[]])
  })
  it('"these" swept over new ink is not held', () => {
    const s = scene(move('finger', a, b, 300, 1300), { pending: fresh })
    s.say('these', 800)
    expect(s.heard()).toEqual([[]])
  })
  it('checkHeld with nothing held does nothing', () => {
    const s = scene(rest('finger', c1.x, c1.y, 0, 1500), { pending: fresh })
    s.live.checkHeld()
    expect(s.got).toEqual([])
  })
})

describe('scenario: 300 random pointings on the board', () => {
  const rand = rng(4242)
  const leaves = [T1, T3, X, N3]
  const kinds: PointerKind[] = ['finger', 'stick', 'laser', 'mouse']
  it('a pointer of any kind resting anywhere on a term, with jitter, whispers exactly that term', () => {
    for (let i = 0; i < 150; i++) {
      const t = leaves[Math.floor(rand() * leaves.length)]
      const kind = kinds[Math.floor(rand() * kinds.length)]
      const m = 0.012 // stay this far inside the box, so the jitter cannot carry the average out
      const x = t.box.x + m + rand() * (t.box.w - 2 * m), y = t.box.y + m + rand() * (t.box.h - 2 * m)
      const pts = rest(kind, x, y, 0, 1500, 0.008, 33, rand)
      // any tool also has a hand somewhere else, resting on a different term
      const other = leaves[(leaves.indexOf(t) + 1) % leaves.length]
      const s = scene(kind === 'finger' ? pts : inOrder(pts, rest('finger', centre(other).x, centre(other).y, 0, 1500)))
      s.say(['this', 'that', 'here'][i % 3], 400 + rand() * 700)
      expect(s.heard(), `case ${i}: ${kind} at ${x.toFixed(3)},${y.toFixed(3)} on ${t.phrase}`).toEqual([names(t)])
    }
  })
  it('a pointer resting on empty board never whispers', () => {
    for (let i = 0; i < 75; i++) {
      const kind = kinds[Math.floor(rand() * kinds.length)]
      const s = scene(rest(kind, 0.05 + rand() * 0.9, 0.86 + rand() * 0.1, 0, 1500, 0.008, 33, rand))
      s.say('this', 400 + rand() * 700)
      expect(s.heard(), `case ${i}`).toEqual([[]])
    }
  })
  it('a pointer crossing the board fast never whispers for "this"', () => {
    for (let i = 0; i < 75; i++) {
      const kind = kinds[Math.floor(rand() * kinds.length)]
      const y = 0.15 + rand() * 0.7
      const s = scene(move(kind, { x: -0.2, y }, { x: 1.2, y: y + (rand() - 0.5) * 0.2 }, 0, 1500 + rand() * 500))
      s.say('this', 400 + rand() * 700)
      expect(s.heard(), `case ${i}`).toEqual([[]])
    }
  })
})

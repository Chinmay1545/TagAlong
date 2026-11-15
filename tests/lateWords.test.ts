import { describe, expect, it, vi } from 'vitest'
import { TipBuffer } from '../src/core/tipBuffer'
import { createLive } from '../src/live/live'
import { readPointer } from '../src/core/resolver'
import { LATE_WINDOW_MS, RECHECK_MS, SCOPE_WAIT_MS, TIP_WINDOW_MS, WEB_SPEECH_LAG_MS } from '../src/core/config'
import type { Box, Resolution, Term } from '../src/core/types'
import type { AnyPoint } from '../src/vision/pointer'
import type { WordItem } from '../src/speech/words'
import { BOARD_TERMS, G, T1, T3, centre, inOrder, move, rest } from './helpers/board'

// Browser speech recognition gives no word timing: a word is only known when its result arrives, some
// time after it was said. By then the finger may have left. And with the P key (or any fresh word), the
// finger may only just be arriving. Both used to make a real "this" go silent.
const c1 = centre(T1), c3 = centre(T3)
const away = { x: 0.9, y: 0.9 }
const names = (...ts: Term[]) => ts.map(t => t.phrase)

// The pointer buffer holds points up to `now`; `more` are points that arrive after the word.
function setup(points: AnyPoint[], now: number, opts: { pending?: Box | null; terms?: Term[] } = {}) {
  let clock = now
  let terms = opts.terms ?? BOARD_TERMS
  const tips = new TipBuffer()
  inOrder(points).forEach(p => tips.push(p))
  const timers: { fn: () => void; ms: number }[] = []
  const play = vi.fn((_r: Resolution) => ({ startedAt: clock + 10 }))
  const live = createLive({
    getTerms: () => terms, tips, player: { play, setEnabled: () => {} }, now: () => clock,
    getPendingRegion: () => opts.pending ?? null, later: (fn, ms) => { timers.push({ fn, ms }) },
  })
  const got: string[][] = []
  const words: string[] = []
  live.onResolution(r => { got.push(r.terms.map(t => t.phrase)); words.push(r.word.word) })
  let seg = 0
  const item = (word: string): WordItem[] => [{ content: word, isPartial: false, arrivedAt: clock, segment: ++seg }]
  return {
    live, got, words, play, timers,
    browserSpeech: (word: string) => live.handleItems(item(word), null, true), // said a moment ago, arrives now
    pKey: (word = 'this') => live.handleItems(item(word), null), // happens right now
    transcribe: (word: string, saidAtSec: number) => live.handleItems([{ content: word, startTime: saidAtSec, isPartial: false, arrivedAt: clock, segment: ++seg }], 0),
    // Time passes: more points arrive, then any waiting recheck runs.
    pass: (ms: number, more: AnyPoint[] = []) => {
      inOrder(more).forEach(p => tips.push(p))
      clock += ms
      timers.splice(0).forEach(t => t.fn())
    },
    // Time passes and more points arrive, but a waiting recheck has not run yet.
    wait: (ms: number, more: AnyPoint[] = []) => { inOrder(more).forEach(p => tips.push(p)); clock += ms },
    setTerms: (t: Term[]) => { terms = t },
  }
}

describe('browser speech: the word arrives after it was said', () => {
  it('point, say "this", move away: still whispered, though the finger has left by the time the word arrives', () => {
    // Rests on the 2x until 0.6 s, then leaves. The word arrives at 1.0 s.
    const s = setup(inOrder(rest('finger', c1.x, c1.y, 0, 600), move('finger', c1, away, 633, 1000)), 1000)
    s.browserSpeech('this')
    expect(s.got).toEqual([names(T1)])
    expect(s.play).toHaveBeenCalledTimes(1)
  })
  it('the same motion with the P key (which is "now", not late) is silent: the pointer has left', () => {
    const s = setup(inOrder(rest('finger', c1.x, c1.y, 0, 600), move('finger', c1, away, 633, 1000)), 1000)
    s.pKey()
    s.pass(RECHECK_MS, move('finger', away, away, 1033, 1300))
    expect(s.got).toEqual([[]])
  })
  it.each([300, 500, 700, 900])('works when the word arrives %i ms after the finger left', gap => {
    const s = setup(inOrder(rest('finger', c1.x, c1.y, 0, 800), move('finger', c1, away, 833, 800 + gap)), 800 + gap)
    s.browserSpeech('that')
    expect(s.got).toEqual([names(T1)])
  })
  it('a rest that ended long before the word arrives does not count', () => {
    const gap = WEB_SPEECH_LAG_MS + LATE_WINDOW_MS + 300
    const s = setup(inOrder(rest('finger', c1.x, c1.y, 0, 800), move('finger', c1, away, 833, 800 + gap)), 800 + gap)
    s.browserSpeech('this')
    s.pass(RECHECK_MS)
    expect(s.got).toEqual([[]])
  })
  it('still pointing when the word arrives: whispered at once', () => {
    const s = setup(rest('finger', c3.x, c3.y, 0, 1000), 1000)
    s.browserSpeech('this')
    expect(s.got).toEqual([names(T3)])
    expect(s.timers).toEqual([])
  })
  it('two rests before the word arrives: the one from about when the word was said wins', () => {
    // On the top 2x until 0.3 s, on the bottom 2x from 0.45 s. The word arrives at 1.0 s, said about 0.6 s.
    const s = setup(inOrder(rest('finger', c1.x, c1.y, 0, 300), move('finger', c1, c3, 333, 420), rest('finger', c3.x, c3.y, 450, 1000)), 1000)
    s.browserSpeech('this')
    expect(s.got).toEqual([names(T3)])
  })
  it('said on the first term, finger already resting on the next when the word arrives: the first term', () => {
    // Top 2x until 0.7 s, then straight to the bottom 2x from 0.9 s. Said about 0.6 s, arrives 1.0 s.
    const s = setup(inOrder(rest('finger', c1.x, c1.y, 0, 700), move('finger', c1, c3, 733, 870), rest('finger', c3.x, c3.y, 900, 1000)), 1000)
    s.browserSpeech('this')
    expect(s.got).toEqual([names(T1)])
    expect(s.timers).toEqual([]) // the finger landing on the next term now is not what the word was about
  })
  it('"these" swept just before the word arrived still finds both terms', () => {
    const s = setup(inOrder(move('finger', { x: 0.2, y: 0.285 }, { x: 0.7, y: 0.285 }, 0, 700), move('finger', { x: 0.7, y: 0.285 }, away, 733, 1300)), 1300, { terms: [T1, G] })
    s.browserSpeech('these')
    expect(s.got).toEqual([names(T1, G)])
  })
  it('a hand that only passed over a term a moment ago is still not pointing', () => {
    const s = setup(move('finger', { x: -0.2, y: 0.285 }, { x: 1.2, y: 0.285 }, 0, 1000), 1000)
    s.browserSpeech('that')
    s.pass(RECHECK_MS, move('finger', { x: 1.2, y: 0.285 }, { x: 1.6, y: 0.285 }, 1033, 1300))
    expect(s.got).toEqual([[]])
    expect(s.play).not.toHaveBeenCalled()
  })
  it('a laser that was on the term when the word was said counts, even if it is off when the word arrives', () => {
    const s = setup(inOrder(rest('laser', c1.x, c1.y, 0, 700, 0.005), rest('finger', away.x, away.y, 0, 1000)), 1000)
    s.browserSpeech('this')
    expect(s.got).toEqual([names(T1)])
  })
  it('words with exact timing (Transcribe) keep the exact rule: the pointer at the time the word was said', () => {
    const s = setup(inOrder(rest('finger', c1.x, c1.y, 0, 600), move('finger', c1, c3, 633, 870), rest('finger', c3.x, c3.y, 900, 2000)), 2000)
    s.transcribe('this', 0.3)
    s.transcribe('that', 1.5) // the next item ends the wait of "this"; "that" is last, so it waits for scope words
    expect(s.got).toEqual([names(T1)])
    s.pass(SCOPE_WAIT_MS)
    expect(s.got).toEqual([names(T1), names(T3)])
    expect(s.timers).toEqual([])
  })
})

describe('the finger is only just arriving: wait a moment and look again', () => {
  // Moving until 0.95 s, then resting on the 2x. The word comes at 1.0 s: only 50 ms of rest so far.
  const arriving = inOrder(move('finger', away, c1, 500, 930), rest('finger', c1.x, c1.y, 950, 1000))
  const staying = rest('finger', c1.x, c1.y, 1033, 1300)

  it('P pressed as the finger lands: nothing yet, then whispered once the finger has rested', () => {
    const s = setup(arriving, 1000)
    s.pKey()
    expect(s.got).toEqual([])
    expect(s.timers.map(t => t.ms)).toEqual([RECHECK_MS])
    s.pass(RECHECK_MS, staying)
    expect(s.got).toEqual([names(T1)])
    expect(s.play).toHaveBeenCalledTimes(1)
  })
  it('the same with a browser-speech word', () => {
    const s = setup(arriving, 1000)
    s.browserSpeech('this')
    expect(s.got).toEqual([])
    s.pass(RECHECK_MS, staying)
    expect(s.got).toEqual([names(T1)])
  })
  it('the finger never settles: silent after the one recheck, and never again', () => {
    const s = setup(arriving, 1000)
    s.pKey()
    s.pass(RECHECK_MS, move('finger', c1, away, 1033, 1300))
    expect(s.got).toEqual([[]])
    expect(s.timers).toEqual([])
    s.pass(1000, rest('finger', c1.x, c1.y, 1333, 2300)) // rests later: too late for that word
    expect(s.got).toEqual([[]])
    expect(s.play).not.toHaveBeenCalled()
  })
  it('no pointer at all: silent after the recheck', () => {
    const s = setup([], 1000)
    s.pKey()
    expect(s.got).toEqual([])
    s.pass(RECHECK_MS)
    expect(s.got).toEqual([[]])
  })
  it('a word that hits is whispered at once, with no recheck', () => {
    const s = setup(rest('finger', c1.x, c1.y, 0, 1000), 1000)
    s.pKey()
    expect(s.got).toEqual([names(T1)])
    expect(s.timers).toEqual([])
  })
  it('a finger resting on empty board is silent at once: waiting would not help', () => {
    const s = setup(rest('finger', 0.1, 0.9, 0, 1000), 1000)
    s.pKey()
    expect(s.got).toEqual([[]])
    expect(s.timers).toEqual([])
  })
  it('"these" is never rechecked', () => {
    const s = setup([], 1000)
    s.pKey('these')
    expect(s.got).toEqual([[]])
    expect(s.timers).toEqual([])
  })
  it('a timed word that arrived long after it was said is not rechecked: its moment has passed', () => {
    const s = setup(move('finger', away, c1, 0, 3000), 3000)
    s.transcribe('this', 1.0)
    s.pass(SCOPE_WAIT_MS) // the scope-word wait (from its arrival), then answered at once: no recheck
    expect(s.got).toEqual([[]])
    expect(s.timers).toEqual([])
  })
  it('the finger lands on new ink: after the recheck the word is held, then whispered when the box arrives', () => {
    const fresh: Box = { x: 0.6, y: 0.6, w: 0.38, h: 0.38 }
    const NEW: Term = { id: 10, latex: 'y', phrase: 'the new y', box: { x: 0.66, y: 0.66, w: 0.08, h: 0.08 } }
    const at = { x: 0.7, y: 0.7 }
    const s = setup(inOrder(move('finger', c1, at, 500, 930), rest('finger', at.x, at.y, 950, 1000)), 1000, { pending: fresh })
    s.pKey()
    s.pass(RECHECK_MS, rest('finger', at.x, at.y, 1033, 1300))
    expect(s.got).toEqual([]) // held
    s.setTerms([...BOARD_TERMS, NEW])
    s.live.checkHeld()
    expect(s.got).toEqual([names(NEW)])
  })
  it('two words waiting at once are each answered once', () => {
    const s = setup(arriving, 1000)
    s.pKey('this')
    s.pKey('that')
    s.pass(RECHECK_MS, staying)
    expect(s.got).toEqual([names(T1), names(T1)])
  })
})

// Review finding: the teacher rests on one term, moves to the next and says "this" as the finger lands.
// The new rest is still too short, the old one qualifies, and the old term was whispered.
describe('the finger is landing on a new term while an older rest exists', () => {
  // On the top 2x until 0.7 s, travelling, then on the bottom 2x from 0.95 s. The word comes at 1.0 s.
  const landing = inOrder(rest('finger', c1.x, c1.y, 0, 700), move('finger', c1, c3, 733, 930), rest('finger', c3.x, c3.y, 950, 1000))

  it('waits for the landing and whispers the new term, not the old one', () => {
    const s = setup(landing, 1000)
    s.pKey()
    expect(s.got).toEqual([])
    expect(s.timers.map(t => t.ms)).toEqual([RECHECK_MS])
    s.pass(RECHECK_MS, rest('finger', c3.x, c3.y, 1033, 1300))
    expect(s.got).toEqual([names(T3)])
    expect(s.play).toHaveBeenCalledTimes(1)
  })
  it('the finger does not stay on the new term after all: the old term, once', () => {
    const s = setup(landing, 1000)
    s.pKey()
    s.pass(RECHECK_MS, move('finger', c3, away, 1033, 1300))
    expect(s.got).toEqual([names(T1)])
    expect(s.timers).toEqual([])
  })
  it('the finger left the term fast and is not landing anywhere: whispered at once, no waiting', () => {
    const s = setup(inOrder(rest('finger', c1.x, c1.y, 0, 850), move('finger', c1, away, 883, 1000)), 1000)
    s.pKey()
    expect(s.got).toEqual([names(T1)])
    expect(s.timers).toEqual([])
  })
  it('still resting on the term: whispered at once, no waiting', () => {
    const s = setup(rest('finger', c1.x, c1.y, 0, 1000), 1000)
    s.pKey()
    expect(s.got).toEqual([names(T1)])
    expect(s.timers).toEqual([])
  })
  it('landing on empty board after a rest on a term: waits, then goes with where the finger now rests (silent)', () => {
    const spot = { x: 0.1, y: 0.9 }
    const s = setup(inOrder(rest('finger', c1.x, c1.y, 0, 700), move('finger', c1, spot, 733, 930), rest('finger', spot.x, spot.y, 950, 1000)), 1000)
    s.pKey()
    expect(s.got).toEqual([])
    s.pass(RECHECK_MS, rest('finger', spot.x, spot.y, 1033, 1300))
    expect(s.got).toEqual([[]])
  })
  it('works for a laser landing on a new term too', () => {
    const track = inOrder(rest('laser', c1.x, c1.y, 0, 700, 0.004), move('laser', c1, c3, 733, 930), rest('laser', c3.x, c3.y, 950, 1000, 0.004))
    const s = setup(track, 1000)
    s.pKey()
    s.pass(RECHECK_MS, rest('laser', c3.x, c3.y, 1033, 1300, 0.004))
    expect(s.got).toEqual([names(T3)])
  })
  it('readPointer reports the landing', () => {
    const fill = (pts: AnyPoint[]) => { const b = new TipBuffer(); inOrder(pts).forEach(p => b.push(p)); return b }
    const word = { word: 'this', t: 1000, isPointer: true }
    const read = readPointer(word, BOARD_TERMS, fill(landing))
    expect(read.resolution.terms).toEqual([T1])
    expect(read.landing).toBe(true)
    expect(readPointer(word, BOARD_TERMS, fill(rest('finger', c1.x, c1.y, 0, 1000))).landing).toBe(false)
    expect(readPointer(word, BOARD_TERMS, fill(inOrder(rest('finger', c1.x, c1.y, 0, 850), move('finger', c1, away, 883, 1000)))).landing).toBe(false)
  })
})

// Review finding: the wait was a bare timer. It fired after a reset or a stop, and a later word could
// overtake the waiting one.
describe('words that are waiting for a second look', () => {
  const arriving = inOrder(move('finger', away, c1, 500, 930), rest('finger', c1.x, c1.y, 950, 1000))
  const staying = (t0: number, t1: number) => rest('finger', c1.x, c1.y, t0, t1)

  it('a later word does not overtake a waiting one: they come out in the order they were said', () => {
    const s = setup(arriving, 1000)
    s.pKey('this') // waits: the finger has only just landed
    s.wait(250, staying(1033, 1250))
    s.pKey('that') // by now the finger has rested: this one could be answered at once
    expect(s.got).toEqual([])
    s.pass(50, staying(1283, 1300))
    expect(s.words).toEqual(['this', 'that'])
    expect(s.got).toEqual([names(T1), names(T1)])
  })
  it('three words in a row keep their order', () => {
    const s = setup(arriving, 1000)
    s.pKey('this')
    s.wait(100, staying(1033, 1100))
    s.pKey('that')
    s.wait(100, staying(1133, 1200))
    s.pKey('here')
    s.pass(100, staying(1233, 1300))
    s.pass(RECHECK_MS, staying(1333, 1600)) // in case one of the later words needed its own second look
    expect(s.words).toEqual(['this', 'that', 'here'])
  })
  it('cancelWaiting drops a waiting word: no whisper and no log line afterwards', () => {
    const s = setup(arriving, 1000)
    s.pKey()
    s.live.cancelWaiting()
    s.pass(RECHECK_MS, staying(1033, 1300))
    expect(s.got).toEqual([])
    expect(s.play).not.toHaveBeenCalled()
  })
  it('cancelWaiting also drops the words queued behind it', () => {
    const s = setup(arriving, 1000)
    s.pKey('this')
    s.wait(250, staying(1033, 1250))
    s.pKey('that')
    s.live.cancelWaiting()
    s.pass(50, staying(1283, 1300))
    expect(s.got).toEqual([])
  })
  it('after cancelWaiting, new words work as normal', () => {
    const s = setup(arriving, 1000)
    s.pKey('this')
    s.live.cancelWaiting()
    s.pass(RECHECK_MS, staying(1033, 1300))
    s.pKey('that')
    expect(s.words).toEqual(['that'])
    expect(s.got).toEqual([names(T1)])
  })
  it('cancelWaiting with nothing waiting does nothing', () => {
    const s = setup(rest('finger', c1.x, c1.y, 0, 1000), 1000)
    s.live.cancelWaiting()
    s.pKey()
    expect(s.got).toEqual([names(T1)])
  })
})

describe('readPointer: looking at another moment or a wider window', () => {
  const fill = (pts: AnyPoint[]) => { const b = new TipBuffer(10000); inOrder(pts).forEach(p => b.push(p)); return b }
  const word = { word: 'this', t: 2000, isPointer: true }
  const tips = fill([...rest('finger', c1.x, c1.y, 900, 1200), ...move('finger', c1, away, 1233, 2000)])
  it('by default looks TIP_WINDOW_MS around the word time', () => {
    expect(readPointer(word, BOARD_TERMS, tips).miss).toBe('not-pointing')
    expect(readPointer(word, BOARD_TERMS, tips, { at: 2000, windowMs: TIP_WINDOW_MS }).miss).toBe('not-pointing')
  })
  it('can be asked to look around an earlier moment', () => {
    expect(readPointer(word, BOARD_TERMS, tips, { at: 1300, windowMs: TIP_WINDOW_MS }).resolution.terms).toEqual([T1])
  })
  it('or through a wider window', () => {
    expect(readPointer(word, BOARD_TERMS, tips, { at: 2000, windowMs: 1200 }).resolution.terms).toEqual([T1])
  })
  it('the word itself is passed through unchanged', () => {
    expect(readPointer(word, BOARD_TERMS, tips, { at: 1300, windowMs: TIP_WINDOW_MS }).resolution.word).toBe(word)
  })
})

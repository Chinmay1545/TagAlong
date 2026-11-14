import { readPointer, termAt, type When } from '../core/resolver'
import { HOLD_MAX_MS, LATE_WINDOW_MS, MAX_DIST, RECHECK_MS, TIP_WINDOW_MS, WEB_SPEECH_LAG_MS } from '../core/config'
import type { TipBuffer } from '../core/tipBuffer'
import type { Box, Resolution, Term, WordEvent } from '../core/types'
import type { createWhisperPlayer } from '../audio/whisper'
import { isBoardQuery, readingOrder } from './boardQuery'
import { detectPointerWords, type WordItem } from '../speech/words'

export type Live = {
  // late: the words were said a moment before they arrived and carry no timing (browser speech).
  handleItems(items: WordItem[], audioStartPerf: number | null, late?: boolean): void
  handleFinal(text: string, t0: number, t1: number): void
  onResolution(cb: (r: Resolution, latencyMs: number | null) => void): () => void
  onBoardQuery(cb: (r: Resolution, latencyMs: number | null) => void): () => void
  onFinalSegment(cb: (text: string, t0: number, t1: number) => void): () => void
  setWhisperEnabled(on: boolean): void
  resetUtterance(): void
  checkHeld(): void // call when the terms change, and every so often: resolves or gives up held words
  cancelWaiting(): void // drop words waiting for their second look (board reset, speech stopped, screen closed)
}

// A pointer word that found no box but pointed at board ink not read yet ("write, then say this").
type Held = { word: WordEvent; tip: { x: number; y: number }; at: number }

const SINGLE = new Set(['this', 'that', 'here'])
const near = (p: { x: number; y: number }, b: Box, m = MAX_DIST) =>
  p.x >= b.x - m && p.x <= b.x + b.w + m && p.y >= b.y - m && p.y <= b.y + b.h + m

type Deps = {
  getTerms: () => Term[]
  tips: TipBuffer
  player: Pick<ReturnType<typeof createWhisperPlayer>, 'play' | 'setEnabled'>
  now?: () => number // performance.now clock, used to time held words
  getPendingRegion?: () => Box | null // board area changed but not read yet (boardLoop.pendingRegion)
  later?: (fn: () => void, ms: number) => void // runs fn after ms (a timer; tests pass their own)
}

export function createLive({ getTerms, tips, player, now = () => performance.now(), getPendingRegion = () => null, later = (fn, ms) => { setTimeout(fn, ms) } }: Deps): Live {
  const seen = new Set<string>()
  const resCbs = new Set<(r: Resolution, l: number | null) => void>()
  const boardCbs = new Set<(r: Resolution, l: number | null) => void>()
  const finalCbs = new Set<(text: string, t0: number, t1: number) => void>()
  const sub = <T>(set: Set<T>, cb: T) => { set.add(cb); return () => { set.delete(cb) } }
  let held: Held[] = []
  const emit = (r: Resolution) => {
    const played = r.terms.length ? player.play(r) : null
    const latency = played ? played.startedAt - r.word.t : null
    resCbs.forEach(cb => cb(r, latency))
  }
  // Words keep the order they were said in. While one word waits for its second look, later words queue
  // behind it. `round` goes up on cancelWaiting, so a timer set before it does nothing when it fires.
  let waiting = false
  let round = 0
  let queue: { word: WordEvent; when: When }[] = []
  const take = (word: WordEvent, when: When) => {
    if (waiting) { queue.push({ word, when }); return }
    resolve(word, when, true)
  }
  // One pointer word. when: the moment to look at. recheck: allowed to wait and look once more.
  const resolve = (word: WordEvent, when: When, recheck: boolean) => {
    // The gate runs first: a word said with nothing resting on the board ('not-pointing') is silent
    // and is never held, so it cannot be whispered late when a box shows up.
    const { resolution, aim, miss, landing } = readPointer(word, getTerms(), tips, when)
    if ((miss === 'not-pointing' || landing) && recheck && SINGLE.has(word.word) && now() < when.at + when.windowMs) {
      // Nothing is resting yet, or the pointer is just settling on a new spot while an older rest exists.
      // The time around the word is not over, so look once more shortly instead of answering silent or
      // with the older spot. (A word whose moment has fully passed is not rechecked.)
      waiting = true
      const mine = round
      later(() => {
        if (mine !== round) return // cancelled
        waiting = false
        resolve(word, when, false)
        while (!waiting && queue.length) { const next = queue.shift()!; resolve(next.word, next.when, true) }
      }, RECHECK_MS)
      return
    }
    if (miss === 'empty-space' && aim && SINGLE.has(word.word)) {
      // The pointer rests on a spot with no box. If that spot is ink the board read has not drawn yet,
      // hold the word instead of going silent; checkHeld whispers it when the box arrives.
      const region = getPendingRegion()
      if (region && near(aim, region)) { held.push({ word, tip: aim, at: now() }); return }
    }
    emit(resolution)
  }
  return {
    handleItems(items, audioStartPerf, late = false) {
      for (const word of detectPointerWords(items, seen, audioStartPerf)) {
        // A late word (browser speech) was said some time before it arrived, and the finger may have left
        // since. Look around the moment it was probably said, and further back, instead of around now.
        const when: When = late ? { at: word.t - WEB_SPEECH_LAG_MS, windowMs: LATE_WINDOW_MS } : { at: word.t, windowMs: TIP_WINDOW_MS }
        take(word, when)
      }
    },
    cancelWaiting() { round++; waiting = false; queue = [] },
    checkHeld() {
      if (!held.length) return
      const terms = getTerms()
      const pending = getPendingRegion()
      const keep: Held[] = []
      for (const h of held) {
        const term = termAt(terms, h.tip.x, h.tip.y)
        if (term) emit({ word: h.word, terms: [term] })
        else if (!pending || now() - h.at > HOLD_MAX_MS) emit({ word: h.word, terms: [] }) // nothing left to read, or waited long enough
        else keep.push(h)
      }
      held = keep
    },
    handleFinal(text, t0, t1) {
      finalCbs.forEach(cb => cb(text, t0, t1))
      if (!isBoardQuery(text)) return
      const terms = readingOrder(getTerms())
      const r: Resolution = { word: { word: 'board', t: t1, isPointer: false }, terms }
      const played = terms.length ? player.play(r) : null // one call: whisper flush only applies to the first term
      boardCbs.forEach(cb => cb(r, played ? played.startedAt - t1 : null))
    },
    onBoardQuery: cb => sub(boardCbs, cb),
    onResolution: cb => sub(resCbs, cb),
    onFinalSegment: cb => sub(finalCbs, cb),
    setWhisperEnabled: on => player.setEnabled(on),
    resetUtterance: () => seen.clear(),
  }
}

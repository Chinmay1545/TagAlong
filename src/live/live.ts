import { readPointer, termAt, type When } from '../core/resolver'
import { HOLD_MAX_MS, LATE_WINDOW_MS, MAX_DIST, RECHECK_MS, SCOPE_SPAN_MS, SCOPE_WAIT_MS, TIP_WINDOW_MS, WEB_SPEECH_LAG_MS } from '../core/config'
import type { TipBuffer } from '../core/tipBuffer'
import type { Box, Resolution, Term, WordEvent } from '../core/types'
import type { createWhisperPlayer } from '../audio/whisper'
import { isBoardQuery } from './boardQuery'
import { topLevel } from './overview'
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
  let scoped: { word: WordEvent; go: () => void } | null = null // the word waiting for scope words, and how to stop its wait early
  let queue: { word: WordEvent; when: When; until: number }[] = [] // until: when a scope wait must end (0: no wait)
  const drain = () => {
    while (!waiting && queue.length) { const next = queue.shift()!; start(next.word, next.when, next.until) }
  }
  const start = (word: WordEvent, when: When, until: number) => {
    const wait = until - now() // measured now: a word that queued behind another keeps its cap from its own arrival
    if (!until || wait <= 0 || scopeSettled(word)) { resolve(word, when, true); return }
    // Transcribe sends words one by one: the scope words after "this" arrive a moment later. Look at the
    // pointer around the word's own time (`when`), but read the words only after they had time to come.
    waiting = true
    const mine = round
    let done = false
    const go = () => {
      if (done || mine !== round) return // already released by a later item, or cancelled
      done = true
      scoped = null
      waiting = false
      resolve(word, when, true)
      drain()
    }
    scoped = { word, go }
    later(go, wait)
  }
  const take = (word: WordEvent, when: When, until: number) => {
    if (waiting) { queue.push({ word, when, until }); return }
    start(word, when, until)
  }
  // The latest items of the current utterance, so scope words can be found after a pointer word.
  let utter: WordItem[] = []
  let audioStart: number | null = null
  const itemT = (it: WordItem) => (it.startTime !== undefined && audioStart !== null ? audioStart + it.startTime * 1000 : it.arrivedAt)
  const norm = (it: WordItem) => it.content.toLowerCase().replace(/[^a-z]/g, '')
  const indexOf = (word: WordEvent) => utter.findIndex(it => norm(it) === word.word && itemT(it) === word.t)
  // Words that may be scope words: the next 3 items (2 for browser speech, which has no timing), said within
  // SCOPE_SPAN_MS after the pointer word, in the same segment when segments exist.
  const lateWords = new WeakSet<WordEvent>()
  const wordsAfter = (word: WordEvent): string[] => {
    const i = indexOf(word)
    if (i < 0) return []
    const me = utter[i]
    return utter.slice(i + 1, i + 1 + (lateWords.has(word) ? 2 : 3))
      .filter(it => (me.segment === undefined || it.segment === undefined || it.segment === me.segment) && (lateWords.has(word) || itemT(it) - word.t <= SCOPE_SPAN_MS))
      .map(norm)
  }
  // The wait for scope words is over once the next item of the utterance has arrived, unless the items so far
  // are only "whole" (more is coming: "this whole thing"). Items said too late to count end the wait too.
  const scopeSettled = (word: WordEvent) => {
    const i = indexOf(word)
    if (i < 0 || i + 1 >= utter.length) return i < 0
    const after = wordsAfter(word)
    return !(after.length && after.every(w => w === 'whole'))
  }
  // One pointer word. when: the moment to look at. recheck: allowed to wait and look once more.
  const resolve = (word: WordEvent, when: When, recheck: boolean) => {
    // The gate runs first: a word said with nothing resting on the board ('not-pointing') is silent
    // and is never held, so it cannot be whispered late when a box shows up.
    const { resolution, aim, miss, landing, sweep } = readPointer(word, getTerms(), tips, when, wordsAfter(word))
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
        drain()
      }, RECHECK_MS)
      return
    }
    if (sweep && SINGLE.has(word.word)) { emit({ word, terms: [sweep] }); return } // no rest, but a sweep over several terms
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
      // Callers send either the whole utterance again or only the new items: keep one growing list.
      audioStart = audioStartPerf
      utter = items.length >= utter.length && (!utter.length || norm(items[0]) === norm(utter[0])) ? items : [...utter, ...items]
      if (scoped && scopeSettled(scoped.word)) scoped.go()
      for (const word of detectPointerWords(items, seen, audioStartPerf)) {
        // A late word (browser speech) was said some time before it arrived, and the finger may have left
        // since. Look around the moment it was probably said, and further back, instead of around now.
        const when: When = late ? { at: word.t - WEB_SPEECH_LAG_MS, windowMs: LATE_WINDOW_MS } : { at: word.t, windowMs: TIP_WINDOW_MS }
        // Timed (Transcribe) word with nothing (or only "whole") after it yet: wait for the next item, at most
        // SCOPE_WAIT_MS after this word ARRIVED (partials come 300-800 ms after the speech, so time since it was
        // said would be used up already). Browser speech has the whole phrase.
        if (late) lateWords.add(word)
        const i = indexOf(word)
        const timed = !late && SINGLE.has(word.word) && i >= 0 && utter[i].startTime !== undefined && audioStartPerf !== null
        const after = timed ? wordsAfter(word) : []
        const open = after.every(w => w === 'whole') && (after.length === 0 ? i === utter.length - 1 : i + after.length === utter.length - 1)
        take(word, when, timed && open ? utter[i].arrivedAt + SCOPE_WAIT_MS : 0)
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
      const terms = topLevel(getTerms()) // the short list, in reading order: not every term and group
      const r: Resolution = { word: { word: 'board', t: t1, isPointer: false }, terms }
      const played = terms.length ? player.play(r) : null // one call: whisper flush only applies to the first term
      boardCbs.forEach(cb => cb(r, played ? played.startedAt - t1 : null))
    },
    onBoardQuery: cb => sub(boardCbs, cb),
    onResolution: cb => sub(resCbs, cb),
    onFinalSegment: cb => sub(finalCbs, cb),
    setWhisperEnabled: on => player.setEnabled(on),
    resetUtterance: () => { seen.clear(); utter = [] },
  }
}

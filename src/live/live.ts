import { resolvePointer, steadiestTip, termAt } from '../core/resolver'
import { HOLD_MAX_MS, MAX_DIST, TIP_WINDOW_MS } from '../core/config'
import type { TipBuffer } from '../core/tipBuffer'
import type { Box, Resolution, Term, WordEvent } from '../core/types'
import type { createWhisperPlayer } from '../audio/whisper'
import { isBoardQuery, readingOrder } from './boardQuery'
import { detectPointerWords, type WordItem } from '../speech/words'

export type Live = {
  handleItems(items: WordItem[], audioStartPerf: number | null): void
  handleFinal(text: string, t0: number, t1: number): void
  onResolution(cb: (r: Resolution, latencyMs: number | null) => void): () => void
  onBoardQuery(cb: (r: Resolution, latencyMs: number | null) => void): () => void
  onFinalSegment(cb: (text: string, t0: number, t1: number) => void): () => void
  setWhisperEnabled(on: boolean): void
  resetUtterance(): void
  checkHeld(): void // call when the terms change, and every so often: resolves or gives up held words
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
}

export function createLive({ getTerms, tips, player, now = () => performance.now(), getPendingRegion = () => null }: Deps): Live {
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
  return {
    handleItems(items, audioStartPerf) {
      for (const word of detectPointerWords(items, seen, audioStartPerf)) {
        const r = resolvePointer(word, getTerms(), tips)
        if (!r.terms.length && SINGLE.has(word.word)) {
          // No box under the pointer yet. If it points at ink the board read has not drawn yet, hold the
          // word instead of going silent; checkHeld whispers it when the box arrives.
          const tip = steadiestTip(tips.lead(word.t - TIP_WINDOW_MS, word.t + TIP_WINDOW_MS), word.t)
          const region = getPendingRegion()
          if (tip && region && near(tip, region)) { held.push({ word, tip, at: now() }); continue }
        }
        emit(r)
      }
    },
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

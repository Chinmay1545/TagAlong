import { resolvePointer } from '../core/resolver'
import type { TipBuffer } from '../core/tipBuffer'
import type { Resolution, Term } from '../core/types'
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
}

type Deps = {
  getTerms: () => Term[]
  tips: TipBuffer
  player: Pick<ReturnType<typeof createWhisperPlayer>, 'play' | 'setEnabled'>
  now?: () => number // unused: silent/muted resolutions carry null latency
}

export function createLive({ getTerms, tips, player }: Deps): Live {
  const seen = new Set<string>()
  const resCbs = new Set<(r: Resolution, l: number | null) => void>()
  const boardCbs = new Set<(r: Resolution, l: number | null) => void>()
  const finalCbs = new Set<(text: string, t0: number, t1: number) => void>()
  const sub = <T>(set: Set<T>, cb: T) => { set.add(cb); return () => { set.delete(cb) } }
  return {
    handleItems(items, audioStartPerf) {
      for (const word of detectPointerWords(items, seen, audioStartPerf)) {
        const r = resolvePointer(word, getTerms(), tips)
        const played = r.terms.length ? player.play(r) : null
        const latency = played ? played.startedAt - word.t : null
        resCbs.forEach(cb => cb(r, latency))
      }
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

import { POINTER_WORDS } from '../core/config'
import type { WordEvent } from '../core/types'

export type WordItem = { content: string; startTime?: number; endTime?: number; isPartial: boolean; arrivedAt: number; segment?: number }

export function toPerfTime(startTimeSec: number, audioStartPerf: number): number {
  return audioStartPerf + startTimeSec * 1000
}

// Callers pass the utterance's items each call; `seen` makes re-sent partials fire once.
export function detectPointerWords(items: WordItem[], seen: Set<string>, audioStartPerf: number | null): WordEvent[] {
  const events: WordEvent[] = []
  const counts = new Map<string, number>()
  for (const it of items) {
    const word = it.content.toLowerCase().replace(/[^a-z]/g, '')
    if (!(POINTER_WORDS as readonly string[]).includes(word)) continue
    const ck = it.segment !== undefined ? `${it.segment}.${word}` : word
    const n = counts.get(ck) ?? 0
    counts.set(ck, n + 1)
    const nk = it.segment !== undefined ? `${it.segment}.${n}` : `${n}`
    const timed = it.startTime !== undefined && audioStartPerf !== null
    const b = it.startTime !== undefined ? Math.round(it.startTime * 10) : 0
    const key = it.startTime !== undefined ? `${word}@${b}` : `${word}#${nk}`
    // Neighbouring buckets absorb start-time revisions across a 0.1 s boundary; cost: two same-word
    // utterances <0.2 s apart merge. A timed word also matches its earlier untimed occurrence.
    const dup = it.startTime !== undefined
      ? [b - 1, b, b + 1].some(x => seen.has(`${word}@${x}`)) || seen.has(`${word}#${nk}`)
      : seen.has(key)
    if (dup) continue
    seen.add(key)
    events.push({ word, t: timed ? toPerfTime(it.startTime!, audioStartPerf!) : it.arrivedAt, isPointer: true })
  }
  return events
}

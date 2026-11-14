import { POINTER_WORDS } from '../core/config'
import type { Resolution } from '../core/types'

export type Segment = { text: string; t0: number; t1: number; resolutions: Resolution[]; bookmarked?: boolean }

const SLACK_MS = 250 // Finals arrive after their utterance's resolutions; t0/t1 are on the performance.now() clock (see finalTimes)

export function createTranscript() {
  let segs: Segment[] = []
  let pending: Resolution[] = []
  let bookmarks: number[] = []
  // A bookmark marks the last sentence that had started by then: the one being spoken, or in a pause the one
  // just heard. Before anything was said it marks the first. Worked out on read, so a bookmark pressed
  // mid-sentence moves onto that sentence once its final arrives.
  const markedAt = (b: number) => {
    let i = segs.length - 1
    while (i > 0 && segs[i].t0 > b) i--
    return Math.max(0, i)
  }
  return {
    // "I didn't understand this" (t: performance.now()). Returns how many bookmarks there are now.
    addBookmark(t: number): number { bookmarks.push(t); return bookmarks.length },
    // Usually a resolution comes before its sentence's final and waits in `pending`. A held "this" can be
    // whispered after its sentence ended: it then joins that segment (true = an existing segment changed).
    addResolution(r: Resolution): boolean {
      const i = segs.findIndex(s => r.word.t >= s.t0 - SLACK_MS && r.word.t <= s.t1 + SLACK_MS)
      if (i < 0) { pending.push(r); return false }
      const s = segs[i]
      segs[i] = { ...s, resolutions: [...s.resolutions, r].sort((a, b) => a.word.t - b.word.t) }
      return true
    },
    addFinal(text: string, t0: number, t1: number) {
      const limit = t1 + SLACK_MS
      const resolutions = pending.filter(r => r.word.t <= limit).sort((a, b) => a.word.t - b.word.t)
      pending = pending.filter(r => r.word.t > limit)
      segs.push({ text, t0, t1, resolutions })
    },
    segments: (): Segment[] => {
      const marked = new Set(bookmarks.map(markedAt))
      return segs.map((s, i) => ({ ...s, bookmarked: marked.has(i) }))
    },
    clear() { segs = []; pending = []; bookmarks = [] },
  }
}

// "this one" / "these ones" are replaced as a whole, so the phrase doesn't leave a stray "one".
const POINTER_RE = new RegExp(`(?<![\\w'\u2019])(${POINTER_WORDS.join('|')})(?:\\s+ones?)?(?![\\w'\u2019])`, 'gi')

export type Part = { text: string; hit: boolean }

// Meant text split into plain runs and substituted phrases (hit), so the UI can highlight them.
export function substituteParts(text: string, resolutions: Resolution[]): Part[] {
  const parts: Part[] = []
  let i = 0
  let last = 0
  for (const m of text.matchAll(POINTER_RE)) {
    const terms = resolutions[i++]?.terms
    if (!terms?.length) continue
    const offset = m.index!
    let phrase = terms.map(t => t.phrase).join(' and ')
    if (/(^|[.!?]\s+)$/.test(text.slice(0, offset))) phrase = phrase[0].toUpperCase() + phrase.slice(1)
    if (offset > last) parts.push({ text: text.slice(last, offset), hit: false })
    parts.push({ text: phrase, hit: true })
    last = offset + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false })
  return parts
}

export function substitute(text: string, resolutions: Resolution[]): string {
  return substituteParts(text, resolutions).map(p => p.text).join('')
}

export function toPlainText(segs: Segment[]): string {
  return segs.map(s => `${s.bookmarked ? 'Marked: did not understand\n' : ''}Said: ${s.text}\nMeant: ${substitute(s.text, s.resolutions)}\n`).join('\n')
}

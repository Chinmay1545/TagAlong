import { POINTER_WORDS } from '../core/config'
import type { Resolution } from '../core/types'

export type Segment = { text: string; t0: number; t1: number; resolutions: Resolution[] }

const SLACK_MS = 250 // Finals arrive after their utterance's resolutions; t0/t1 are on the performance.now() clock (see finalTimes)

export function createTranscript() {
  let segs: Segment[] = []
  let pending: Resolution[] = []
  return {
    addResolution(r: Resolution) { pending.push(r) },
    addFinal(text: string, t0: number, t1: number) {
      const limit = t1 + SLACK_MS
      const resolutions = pending.filter(r => r.word.t <= limit).sort((a, b) => a.word.t - b.word.t)
      pending = pending.filter(r => r.word.t > limit)
      segs.push({ text, t0, t1, resolutions })
    },
    segments: () => segs.slice(),
    clear() { segs = []; pending = [] },
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
  return segs.map(s => `Said: ${s.text}\nMeant: ${substitute(s.text, s.resolutions)}\n`).join('\n')
}

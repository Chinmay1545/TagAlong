import type { Segment } from './store'
import { median } from '../ui/judgeHelpers'

export type ReportCard = {
  pointerWords: number; resolved: number; silent: number; resolvedPct: number
  medianLatencyMs: number | null
  topTerms: { phrase: string; count: number }[]
  correct: number; marked: number
  tips: string[]
}

// Counts only resolutions already attached to a final segment (not pending ones).
// latencies = played whispers only; marks = cumulative Y/N tally.
export function reportCard({ segments, latencies, marks }: { segments: Segment[]; latencies: number[]; marks: { correct: number; total: number } }): ReportCard {
  const all = segments.flatMap(s => s.resolutions)
  const pointerWords = all.length
  const silent = all.filter(r => !r.terms.length).length
  const resolved = pointerWords - silent
  const counts = new Map<string, number>() // Map keeps first-seen order, so the stable sort breaks ties by first seen
  for (const r of all) for (const t of r.terms) counts.set(t.phrase, (counts.get(t.phrase) ?? 0) + 1)
  const topTerms = [...counts].map(([phrase, count]) => ({ phrase, count })).sort((a, b) => b.count - a.count).slice(0, 3)
  const medianLatencyMs = latencies.length ? median(latencies) : null
  const repeated = segments.some(s => {
    const ids = s.resolutions.flatMap(r => r.terms.map(t => t.id))
    return new Set(ids).size < ids.length
  })
  const tips: string[] = []
  if (silent / Math.max(pointerWords, 1) > 0.25) tips.push("Touch the term or point within a hand's width when you say 'this'.")
  if (repeated) tips.push("Name the second term out loud, e.g. 'this 2x'.")
  if (medianLatencyMs !== null && medianLatencyMs > 1000) tips.push("Pause briefly after 'this'.")
  return {
    pointerWords, resolved, silent,
    resolvedPct: pointerWords ? Math.round((resolved / pointerWords) * 100) : 0,
    medianLatencyMs, topTerms, correct: marks.correct, marked: marks.total,
    tips: tips.length ? tips.slice(0, 3) : ['Clear pointing throughout.'],
  }
}

export const reportText = (c: ReportCard): string => [
  'Report card',
  `Resolved: ${c.resolved} of ${c.pointerWords} pointer words (${c.resolvedPct}%)`,
  `Median latency: ${c.medianLatencyMs === null ? 'none yet' : `${(c.medianLatencyMs / 1000).toFixed(2)} s`}`,
  `Marked correct: ${c.correct} of ${c.marked}`,
  ...(c.topTerms.length ? ['Most pointed terms:', ...c.topTerms.map(t => `- ${t.phrase} (${t.count})`)] : []),
  'Tips:', ...c.tips.map(t => `- ${t}`),
].join('\n')

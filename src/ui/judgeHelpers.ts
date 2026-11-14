import { substitute, type Segment } from '../transcript/store'

export type Mark = 'y' | 'n'
export type Row = { id: number; line: string; mark?: Mark }
export type Notes = { rewrite: string[]; summary: string[] }

export const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// rows are newest-first; marks the newest row that has no mark yet
export const markNewest = (rows: Row[], mark: Mark): Row[] => {
  const i = rows.findIndex(r => !r.mark)
  return i < 0 ? rows : rows.map((r, j) => (j === i ? { ...r, mark } : r))
}

export const marksOf = (rows: Row[]) => ({
  correct: rows.filter(r => r.mark === 'y').length,
  total: rows.filter(r => r.mark).length,
})

export type Tally = { correct: number; total: number }

// Cumulative counters survive the log cap: evicting a marked row never changes the tally.
export const applyMark = (rows: Row[], tally: Tally, mark: Mark): { rows: Row[]; tally: Tally } => {
  const next = markNewest(rows, mark)
  if (next === rows) return { rows, tally }
  return { rows: next, tally: { correct: tally.correct + (mark === 'y' ? 1 : 0), total: tally.total + 1 } }
}

// Final times must be on the performance.now() clock (Transcribe sends stream-relative seconds, Web Speech sends none).
export const finalTimes = (source: 'web' | 'transcribe', t0: number, t1: number, audioStartPerf: number | null, nowPerf: number): [number, number] =>
  source === 'transcribe' && audioStartPerf !== null ? [audioStartPerf + t0 * 1000, audioStartPerf + t1 * 1000] : [nowPerf, nowPerf]

export const notesPayload = (segs: Segment[]) => ({
  segments: segs.slice(-200).map(s => ({ said: s.text.slice(0, 1000), meant: substitute(s.text, s.resolutions).slice(0, 1000) })),
})

export const notesText = (segs: Segment[], n: Notes): string => {
  const list = (xs: string[]) => xs.map(x => `- ${x}`).join('\n')
  const said = segs.map(s => `Said: ${s.text}\nMeant: ${substitute(s.text, s.resolutions)}`).join('\n\n')
  return `${said}\n\nRewrite\n${list(n.rewrite)}\n\nSummary\n${list(n.summary)}\n`
}

export type LineKind = 'played' | 'muted' | 'silent' | 'plain'
// Splits a log line ("this → x squared · 0.42 s") into parts for display; the line text itself is unchanged.
export const parseLine = (line: string): { head: string; body: string; tail: string; kind: LineKind } => {
  const a = line.indexOf(' → ')
  if (a < 0) return { head: line, body: '', tail: '', kind: 'plain' }
  const head = line.slice(0, a), rest = line.slice(a + 3)
  if (rest === 'silent') return { head, body: '', tail: 'silent', kind: 'silent' }
  const b = rest.lastIndexOf(' · ')
  if (b < 0) return { head, body: rest, tail: '', kind: 'plain' }
  const tail = rest.slice(b + 3)
  return { head, body: rest.slice(0, b), tail, kind: tail === 'muted' ? 'muted' : 'played' }
}

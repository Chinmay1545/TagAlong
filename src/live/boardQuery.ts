import type { Term } from '../core/types'

const ROW_TOL = 0.08
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()

export const isBoardQuery = (text: string): boolean => {
  const n = norm(text)
  // Web Speech often hears "board" as road/bored/bord.
  return /\b(what(s| is) on|read) the (board|road|bored|bord)\b/.test(n)
}

// Rows by box centre y (within ROW_TOL of the row's first term), then left to right.
export function readingOrder<T extends { box: Term["box"] }>(terms: T[]): T[] {
  const cy = (t: T) => t.box.y + t.box.h / 2
  const rows: T[][] = []
  for (const t of [...terms].sort((a, b) => cy(a) - cy(b))) {
    const row = rows[rows.length - 1]
    if (row && cy(t) - cy(row[0]) < ROW_TOL) row.push(t)
    else rows.push([t])
  }
  return rows.flatMap(r => r.sort((a, b) => a.box.x - b.box.x))
}

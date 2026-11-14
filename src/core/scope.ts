import { MAX_DIST } from './config'
import type { Term } from './types'

// Groups are phrased `the ${KIND}: ...` (see the phrase contract).
const GROUP = /^the (top|bottom|fraction|left side|right side|equation|brackets): /
export const groupKind = (phrase: string): string | null => GROUP.exec(phrase)?.[1] ?? null

// Words said right after "this" that choose a group. 'whole' means the largest group under the aim.
const SCOPE: Record<string, string> = {
  top: 'top', numerator: 'top', upper: 'top',
  bottom: 'bottom', denominator: 'bottom', lower: 'bottom',
  fraction: 'fraction', equation: 'equation', side: 'side',
  bracket: 'brackets', brackets: 'brackets', parentheses: 'brackets',
}

// `after`: the words that follow the pointer word, already cut to the ones close enough (live.ts).
// "whole" counts only as "whole thing" (the largest group); alone it is skipped, so "this whole top part" is top.
export function scopeFrom(after: string[]): string | null {
  const ws = after.map(w => w.toLowerCase().replace(/[^a-z]/g, ''))
  for (let i = 0; i < ws.length; i++) {
    if (ws[i] === 'whole') { if (ws[i + 1] === 'thing') return 'whole'; continue }
    if (SCOPE[ws[i]]) return SCOPE[ws[i]]
  }
  return null
}

const area = (t: Term) => t.box.w * t.box.h
const grow = (t: Term, p: { x: number; y: number }, m: number) =>
  p.x >= t.box.x - m && p.x <= t.box.x + t.box.w + m && p.y >= t.box.y - m && p.y <= t.box.y + t.box.h + m
const smallest = (ts: Term[]) => ts.reduce<Term | null>((b, t) => (!b || area(t) < area(b) ? t : b), null)
const largest = (ts: Term[]) => ts.reduce<Term | null>((b, t) => (!b || area(t) > area(b) ? t : b), null)

// The group a scope word picks for an aim, or null (the caller keeps its normal answer).
export function groupFor(terms: Term[], aim: { x: number; y: number }, scope: string, maxDist = MAX_DIST): Term | null {
  const groups = terms.filter(t => groupKind(t.phrase) && grow(t, aim, maxDist))
  const kind = (...ks: string[]) => groups.filter(g => ks.includes(groupKind(g.phrase)!))
  if (scope === 'whole') return largest(groups)
  if (scope === 'side') return smallest(kind('left side', 'right side'))
  const direct = smallest(kind(scope))
  if (direct || (scope !== 'top' && scope !== 'bottom')) return direct
  // Finger on the fraction bar saying "top": that fraction's own top (or bottom) group.
  const frac = smallest(kind('fraction'))
  if (!frac) return null
  const inside = terms.filter(t => groupKind(t.phrase) === scope && grow(frac, { x: t.box.x + t.box.w / 2, y: t.box.y + t.box.h / 2 }, 0))
  return smallest(inside)
}

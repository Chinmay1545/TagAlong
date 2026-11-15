import { MAX_DIST } from './config'
import type { Term } from './types'

// Groups are phrased `the ${PLACE}: ...` (see the phrase contract). The one place that recognises them.
export const GROUP = /^the (top of the fraction|bottom of the fraction|fraction|left side of the equation|right side of the equation|equation|brackets): /
const KIND_OF: Record<string, string> = {
  'top of the fraction': 'top', 'bottom of the fraction': 'bottom',
  'left side of the equation': 'left side', 'right side of the equation': 'right side',
}
export const groupKind = (phrase: string): string | null => {
  const m = GROUP.exec(phrase)?.[1]
  return m ? KIND_OF[m] ?? m : null
}

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
  const ws = after.slice(0, 3).map(w => w.toLowerCase().replace(/[^a-z]/g, ''))
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
  // A group the aim is really inside beats one that is only near (neighbouring brackets are a few hundredths apart).
  const kind = (...ks: string[]) => {
    const all = groups.filter(g => ks.includes(groupKind(g.phrase)!))
    const exact = all.filter(g => grow(g, aim, 0))
    return exact.length ? exact : all
  }
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

// Open hand without a scope word: the top-level group (a box inside no other group) the aim is on, grown by
// maxDist. Two qualify: the one whose box centre is nearest the aim. None: null (the caller reads a single term).
export function topGroupAt(terms: Term[], aim: { x: number; y: number }, maxDist = MAX_DIST): Term | null {
  const groups = terms.filter(t => groupKind(t.phrase))
  const inside = (a: Term, b: Term) =>
    area(a) < area(b) && a.box.x >= b.box.x && a.box.y >= b.box.y && a.box.x + a.box.w <= b.box.x + b.box.w && a.box.y + a.box.h <= b.box.y + b.box.h
  const near = groups.filter(g => grow(g, aim, maxDist) && !groups.some(o => inside(g, o)))
  const d = (g: Term) => Math.hypot(g.box.x + g.box.w / 2 - aim.x, g.box.y + g.box.h / 2 - aim.y)
  return near.reduce<Term | null>((b, g) => (!b || d(g) < d(b) ? g : b), null)
}

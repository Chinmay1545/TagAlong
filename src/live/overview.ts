import type { Term } from '../core/types'
import { readingOrder } from './boardQuery'

const GROUP = /^the (top|bottom|fraction|left side|right side|equation|brackets): /
const TOL = 0.01
type Box = Term['box']
const inside = (a: Box, b: Box) => a.x >= b.x - TOL && a.y >= b.y - TOL && a.x + a.w <= b.x + b.w + TOL && a.y + a.h <= b.y + b.h + TOL
const area = (b: Box) => b.w * b.h

// The short overview of a board: groups that are not inside another group, and single terms in no group,
// in reading order. "Inside" is by box, so it works for whatever phrases the reader produced.
export function topLevel(terms: Term[]): Term[] {
  const groups = terms.filter(t => GROUP.test(t.phrase))
  // Two groups with the same box: the lower id is the outer one, so only one of them survives.
  const covers = (g: Term, t: Term) => g !== t && inside(t.box, g.box) && (!GROUP.test(t.phrase) || area(g.box) > area(t.box) || g.id < t.id)
  return readingOrder(terms.filter(t => !groups.some(g => covers(g, t))))
}
export const overview = (terms: Term[]): string[] => topLevel(terms).map(t => t.phrase)

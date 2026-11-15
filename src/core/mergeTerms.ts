import { MATCH_DIST } from './config'
import type { Box, Term } from './types'

// spacing and braces around a single character (x^{3}, x_{1}) are spelling, not meaning
const key = (latex: string) => latex.replace(/\s+/g, '').replace(/([\^_])\{(\w)\}/g, '$1$2')
const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
const dist = (a: Box, b: Box) => { const p = centre(a), q = centre(b); return Math.hypot(p.x - q.x, p.y - q.y) }
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// Folds a new board read into the terms on screen, so a wobbly camera or paper does not re-create every box.
// A new term with the same LaTeX (spacing ignored) whose centre is within `tol` of an old one IS the old one:
// the old object (id, box, phrase) is kept. Pairs are matched closest first, so two equal terms ("2x" on top
// and "2x" below) each keep their own box. Other new terms get fresh ids above every old id.
// dropMissing: true (a finished read) drops old terms the read no longer has; false (a read still streaming)
// keeps them, except an old term a new term is drawn over (it is being replaced).
// Order: surviving old terms in their old order, then new ones.
export function mergeTerms(prev: Term[], next: Term[], { dropMissing, tol = MATCH_DIST }: { dropMissing: boolean; tol?: number }): Term[] {
  const pairs: { p: number; n: number; d: number }[] = []
  prev.forEach((p, i) => next.forEach((n, j) => {
    if (key(p.latex) !== key(n.latex)) return
    const d = dist(p.box, n.box)
    if (d <= tol) pairs.push({ p: i, n: j, d })
  }))
  pairs.sort((a, b) => a.d - b.d || a.p - b.p || a.n - b.n)
  const matchedPrev = new Set<number>(), matchedNext = new Set<number>()
  for (const { p, n } of pairs) {
    if (matchedPrev.has(p) || matchedNext.has(n)) continue
    matchedPrev.add(p)
    matchedNext.add(n)
  }
  let id = prev.reduce((m, t) => Math.max(m, t.id), 0)
  const added = next.filter((_, j) => !matchedNext.has(j)).map(t => ({ ...t, id: ++id }))
  const kept = prev.filter((t, i) => matchedPrev.has(i) || (!dropMissing && !added.some(a => overlaps(a.box, t.box))))
  return [...kept, ...added]
}

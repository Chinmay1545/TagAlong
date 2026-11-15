import { GROUP, groupKind } from './scope'
import { readingOrder } from '../live/boardQuery'
import { speakMath } from './speakMath'
import type { Box } from './types'

// The board reader no longer writes a phrase: it is built here from the LaTeX and the box, so the model's
// reply stays short (fewer output tokens = a faster read). Pure.

// LaTeX -> the plain math notation speakMath understands ("\frac{a}{b}" -> "(a)/(b)").
// Commands said as words (speakMath leaves words alone). Anything else drops its backslash (\alpha -> alpha).
const WORDS: Record<string, string> = {
  cdot: '*', times: '*', div: ' divided by ', pm: ' plus or minus ', mp: ' minus or plus ',
  le: ' less than or equal to ', leq: ' less than or equal to ', ge: ' greater than or equal to ', geq: ' greater than or equal to ',
  ne: ' not equal to ', neq: ' not equal to ', lt: ' less than ', gt: ' greater than ', approx: ' approximately ', infty: 'infinity',
}
const ORDINALS: Record<string, string> = { 2: 'square', 3: 'cube', 4: 'fourth', 5: 'fifth', 6: 'sixth', 7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth', n: 'nth' }
const ordinal = (n: string) => (Object.hasOwn(ORDINALS, n) ? ORDINALS[n] : `${n}th`)

export function latexToPlain(latex: string): string {
  let s = latex.trim()
    .replace(/\\(left|right)\s*/g, '')
    .replace(/\\\{/g, '(').replace(/\\\}/g, ')') // set braces
    .replace(/\\[,;:!]/g, ' ') // spacing commands
  for (let i = 0; i < 4; i++) { // innermost first, so nested fractions, roots and powers unwrap
    s = s
      .replace(/\^\{([^{}]*)\}/g, (_, e: string) => (/^\w+$/.test(e) ? `^${e}` : ` to the (${e})`))
      .replace(/_\{([^{}]*)\}/g, ' sub $1')
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
      .replace(/\\[dt]?frac\s*(\d)\s*(\d)/g, '($1)/($2)')
      .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, (_, n: string, x: string) => `the ${ordinal(n.trim())} root of (${x})`)
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)')
  }
  return s
    .replace(/_(\w)/g, ' sub $1')
    .replace(/\\([a-zA-Z]+)/g, (_, c: string) => (Object.hasOwn(WORDS, c) ? WORDS[c] : c))
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Where a box sits in the frame. Thresholds: thirds across; the top band is wider because a
// tripod camera usually leaves empty wall below the writing.
export function positionWords(b: Box): string {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2
  const v = cy < 0.4 ? 'top' : cy > 0.55 ? 'bottom' : 'middle'
  const h = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : ''
  if (v === 'top') return h ? `on top ${h}` : 'on top'
  if (v === 'bottom') return h ? `on the bottom ${h}` : 'on the bottom'
  return h ? `on the ${h}` : 'in the middle'
}

const PLACE: Record<string, string> = {
  top: 'top of the fraction', bottom: 'bottom of the fraction', power: 'in the power',
  left: 'left side of the equation', right: 'right side of the equation', bracket: 'in the brackets',
}
const KIND: Record<string, string> = {
  numerator: 'top of the fraction', denominator: 'bottom of the fraction', fraction: 'fraction', lhs: 'left side of the equation',
  rhs: 'right side of the equation', equation: 'equation', group: 'brackets',
}

// Spoken math + where it lives in the MATH (never where it sits on screen). `_box` is kept for callers.
// "2x" stays "2x" here: the phone's speech step (speakMath) spaces it for the voice.
export function phraseFor(latex: string, _box: Box, tag?: string): string {
  const spoken = speakMath(latexToPlain(latex)).replace(/(\d) (?=[a-z]\b)/gi, '$1')
  if (tag && Object.hasOwn(KIND, tag)) return `the ${KIND[tag]}: ${spoken}`
  return tag && Object.hasOwn(PLACE, tag) ? `${spoken}, ${PLACE[tag]}` : spoken
}

// Phrases come from position bands in the frame, so two terms can get the same one (a 2x numerator and a 2x
// denominator mid-board are both "the 2 x in the middle"). The whisper player drops a phrase that is already
// sounding, so "this cancels with that" would play once. Fix: within each set of equal phrases, tell the members
// apart by the MATH (never by screen words): the top / bottom / side group they sit in, the brackets they sit in,
// the equation or fraction they belong to ("in equation 2"); only if that still leaves twins, by their order
// along the axis they are spread on.
// Names are always derived from each term's ORIGINAL phrase, never from an earlier renamed one, so they stay
// right across reads (a third twin written above a pair, or one of a pair erased). Term (src/core/types.ts) is
// frozen, so the original phrase of every term this function returns is remembered here, keyed by object.
// Returns new objects only where the phrase changes; ids, boxes and order are unchanged except that exact twins
// (see tidyTerms) are dropped; the input is not mutated.
const ORDER = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']
const norm = (p: string) => p.trim().replace(/\s+/g, ' ').toLowerCase()
const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
const withAdjective = (phrase: string, adj: string) => {
  const p = phrase.trim().replace(/\s+/g, ' ')
  return /^the\s/i.test(p) ? `${p.slice(0, 3)} ${adj} ${p.slice(4)}` : `the ${adj} ${p}`
}

const TOL = 0.01
const inside = (a: Box, b: Box) => a.x >= b.x - TOL && a.y >= b.y - TOL && a.x + a.w <= b.x + b.w + TOL && a.y + a.h <= b.y + b.h + TOL
const area = (b: Box) => b.w * b.h
const sameBox = (a: Box, b: Box) => inside(a, b) && inside(b, a)
const GROUP_HEAD = /^the [a-z ]+: /

// The reader's tagging varies: a bracket inside a numerator can come back tagged "numerator" too. A top/bottom
// group lying strictly inside a larger group of the same kind is really the brackets. Exact twins (same phrase,
// same box: the reader listed one thing twice) are dropped, the first one stays. Pure and idempotent.
export function tidyTerms<T extends { phrase: string; box: Box }>(terms: T[]): T[] {
  const renamed = terms.map(t => {
    const k = groupKind(t.phrase)
    if (k !== 'top' && k !== 'bottom') return t
    const nested = terms.some(o => o !== t && groupKind(o.phrase) === k && inside(t.box, o.box) && area(o.box) > area(t.box))
    return nested ? { ...t, phrase: t.phrase.replace(GROUP, 'the brackets: ') } : t
  })
  return renamed.filter((t, i) => !renamed.slice(0, i).some(o => norm(o.phrase) === norm(t.phrase) && sameBox(o.box, t.box)))
}

const original = new WeakMap<object, string>()
const originalOf = (t: { phrase: string }) => original.get(t) ?? t.phrase

const SIDE_PLACE: Record<string, string> = { top: 'top of the fraction', bottom: 'bottom of the fraction', 'left side': 'left side of the equation', 'right side': 'right side of the equation' }

export function uniquePhrases<T extends { phrase: string; box: Box }>(input: T[]): T[] {
  // Work from original phrases, so the result does not depend on an earlier call's renames.
  const restored = input.map(t => (originalOf(t) === t.phrase ? t : { ...t, phrase: originalOf(t) }))
  const back = new Map<object, T>(restored.map((r, i) => [r, input[i]]))
  const terms = tidyTerms(restored).map(r => back.get(r) ?? r)
  const base = terms.map(originalOf)
  const kinds = base.map(groupKind)
  // The smallest group around term i (not itself, not a same-box twin) that `ok` accepts, or -1.
  const smallestAround = (i: number, ok: (j: number) => boolean) => {
    let best = -1
    terms.forEach((o, j) => {
      if (j !== i && ok(j) && inside(terms[i].box, o.box) && !sameBox(terms[i].box, o.box) && (best < 0 || area(o.box) < area(terms[best].box))) best = j
    })
    return best
  }
  // A top-level group sits inside no other group (of two same-box twins, the first one is the outer).
  const tops = terms.map((_, j) => j).filter(j => !!kinds[j] && !terms.some((o, k) =>
    k !== j && !!kinds[k] && inside(terms[j].box, o.box) && (area(o.box) > area(terms[j].box) || (sameBox(o.box, terms[j].box) && k < j))))

  // Each stage gives a member's extra words, or null. A stage that cannot tell them apart changes nothing.
  type Stage = (i: number, cur: string) => string | null
  const stages: Stage[] = [
    (i, cur) => { // the top / bottom / side group it sits in
      const j = smallestAround(i, k => !!kinds[k] && Object.hasOwn(SIDE_PLACE, kinds[k]!))
      const place = j < 0 ? null : SIDE_PLACE[kinds[j]!]
      return place && !norm(cur).includes(place) ? `, ${place}` : null
    },
    i => { // the brackets it sits in, named by their own math
      const j = smallestAround(i, k => kinds[k] === 'brackets')
      return j < 0 ? null : `, in the brackets ${base[j].replace(GROUP_HEAD, '')}`
    },
    i => { // the equation or fraction it belongs to, numbered in reading order among those of its kind
      const j = smallestAround(i, k => tops.includes(k) && (kinds[k] === 'equation' || kinds[k] === 'fraction'))
      if (j < 0) return null
      const same = readingOrder(tops.filter(k => kinds[k] === kinds[j]).map(k => terms[k]))
      return same.length < 2 ? null : `, in ${kinds[j]} ${same.indexOf(terms[j]) + 1}`
    },
  ]

  const cur = [...base]
  const bySet = (idx: number[]) => {
    const m = new Map<string, number[]>()
    idx.forEach(i => { const k = norm(cur[i]); m.set(k, [...(m.get(k) ?? []), i]) })
    return [...m.values()].filter(s => s.length > 1)
  }
  let sets = bySet(cur.map((_, i) => i))
  for (const stage of stages) {
    const next: number[][] = []
    for (const set of sets) {
      const add = set.map(i => stage(i, cur[i]))
      set.forEach((i, n) => { if (add[n]) cur[i] = `${cur[i]}${add[n]}` })
      next.push(...bySet(set))
    }
    sets = next
  }
  // Still equal: their order along the axis they are spread on.
  for (const idx of sets) {
    const pts = idx.map(i => centre(terms[i].box))
    const spread = (a: 'x' | 'y') => Math.max(...pts.map(p => p[a])) - Math.min(...pts.map(p => p[a]))
    const axis: 'x' | 'y' = spread('y') >= spread('x') ? 'y' : 'x'
    const sorted = [...idx].sort((a, b) => centre(terms[a].box)[axis] - centre(terms[b].box)[axis] || a - b)
    sorted.forEach((i, rank) => {
      const p = cur[i]
      // A group phrase keeps `the KIND: ` at the front (groupKind needs it), so it always takes the suffix form.
      if (sorted.length === 2 && !kinds[i]) cur[i] = withAdjective(p, axis === 'y' ? (rank ? 'lower' : 'upper') : (rank ? 'right' : 'left'))
      else cur[i] = `${p.trim().replace(/\s+/g, ' ')}, ${ORDER[rank] ?? `number ${rank + 1}`} from the ${axis === 'y' ? 'top' : 'left'}`
    })
  }
  return terms.map((t, i) => {
    const out = cur[i] === t.phrase ? t : { ...t, phrase: cur[i] }
    original.set(out, base[i])
    return out
  })
}

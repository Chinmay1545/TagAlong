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
  top: 'in the top', bottom: 'in the bottom', power: 'in the power',
  left: 'on the left side', right: 'on the right side', bracket: 'in the brackets',
}
const KIND: Record<string, string> = {
  numerator: 'top', denominator: 'bottom', fraction: 'fraction', lhs: 'left side',
  rhs: 'right side', equation: 'equation', group: 'brackets',
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
// sounding, so "this cancels with that" would play once. Fix: within each group of equal phrases, name the
// terms relative to each other along the axis they are spread on ("the upper 2 x in the middle").
// Names are always derived from each term's ORIGINAL phrase, never from an earlier renamed one, so they stay
// right across reads (a third twin written above a pair, or one of a pair erased). Term (src/core/types.ts) is
// frozen, so the original phrase of every term this function returns is remembered here, keyed by object.
// Returns new objects only where the phrase changes; ids, boxes and order are unchanged; the input is not mutated.
const ORDER = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']
const norm = (p: string) => p.trim().replace(/\s+/g, ' ').toLowerCase()
const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
const withAdjective = (phrase: string, adj: string) => {
  const p = phrase.trim().replace(/\s+/g, ' ')
  return /^the\s/i.test(p) ? `${p.slice(0, 3)} ${adj} ${p.slice(4)}` : `the ${adj} ${p}`
}

const original = new WeakMap<object, string>()
const originalOf = (t: { phrase: string }) => original.get(t) ?? t.phrase

export function uniquePhrases<T extends { phrase: string; box: Box }>(terms: T[]): T[] {
  const groups = new Map<string, number[]>()
  terms.forEach((t, i) => { const k = norm(originalOf(t)); groups.set(k, [...(groups.get(k) ?? []), i]) })
  const renamed = new Map<number, string>()
  for (const idx of groups.values()) {
    if (idx.length < 2) continue
    const pts = idx.map(i => centre(terms[i].box))
    const spread = (a: 'x' | 'y') => Math.max(...pts.map(p => p[a])) - Math.min(...pts.map(p => p[a]))
    const axis: 'x' | 'y' = spread('y') >= spread('x') ? 'y' : 'x'
    const sorted = [...idx].sort((a, b) => centre(terms[a].box)[axis] - centre(terms[b].box)[axis] || a - b)
    sorted.forEach((i, rank) => {
      const p = originalOf(terms[i])
      if (sorted.length === 2) renamed.set(i, withAdjective(p, axis === 'y' ? (rank ? 'lower' : 'upper') : (rank ? 'right' : 'left')))
      else renamed.set(i, `${p.trim().replace(/\s+/g, ' ')}, ${ORDER[rank] ?? `number ${rank + 1}`} from the ${axis === 'y' ? 'top' : 'left'}`)
    })
  }
  return terms.map((t, i) => {
    const base = originalOf(t)
    const phrase = renamed.get(i) ?? base // a term no longer in a group gets its plain phrase back
    const out = phrase === t.phrase ? t : { ...t, phrase }
    original.set(out, base)
    return out
  })
}

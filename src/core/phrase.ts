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

export function phraseFor(latex: string, box: Box): string {
  const spoken = speakMath(latexToPlain(latex))
  return `${/^the\b/i.test(spoken) ? '' : 'the '}${spoken} ${positionWords(box)}`
}

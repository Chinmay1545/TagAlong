import { speakMath } from './speakMath'
import type { Box } from './types'

// The board reader no longer writes a phrase: it is built here from the LaTeX and the box, so the model's
// reply stays short (fewer output tokens = a faster read). Pure.

// LaTeX -> the plain math notation speakMath understands ("\frac{a}{b}" -> "(a)/(b)").
export function latexToPlain(latex: string): string {
  let s = latex.trim()
  for (let i = 0; i < 4; i++) { // innermost first, so nested fractions and roots unwrap
    s = s
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)')
  }
  return s
    .replace(/\\(left|right)\s*/g, '')
    .replace(/\\(cdot|times)/g, '*')
    .replace(/\^\{([^{}]*)\}/g, '^$1')
    .replace(/_\{([^{}]*)\}/g, ' sub $1')
    .replace(/_(\w)/g, ' sub $1')
    .replace(/\\([a-zA-Z]+)/g, '$1')
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

export const phraseFor = (latex: string, box: Box): string => `the ${speakMath(latexToPlain(latex))} ${positionWords(box)}`

import type { Term } from '../src/core/types'
import { phraseFor } from '../src/core/phrase'

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0

// One raw term -> a clean Term, or null if it is unusable. Boxes are clamped to the frame. A term with
// no phrase (the compact format never has one) gets it built from its LaTeX and position; a phrase that
// is present but blank is treated as a broken term, as before.
export function toTerm(t: any, id: number): Term | null {
  const bx = t?.box
  const phraseGiven = t?.phrase !== undefined
  if (!str(t?.latex) || (phraseGiven && !str(t.phrase)) || !bx || !num(bx.x) || !num(bx.y) || !num(bx.w) || !num(bx.h)) return null
  const x = Math.min(1, Math.max(0, bx.x)), y = Math.min(1, Math.max(0, bx.y))
  const w = Math.min(bx.w, 1 - x), h = Math.min(bx.h, 1 - y)
  if (w <= 0 || h <= 0) return null
  const latex = t.latex.trim()
  if (!latex) return null
  const box = { x, y, w, h }
  const phrase = phraseGiven ? t.phrase.trim() : phraseFor(latex, box, t.tag)
  if (!phrase) return null
  return { id, latex, phrase, box }
}

const NUM = /^\s*-?\d+(\.\d+)?\s*$/

// Compact format, one item per line: latex|tag|x|y|w|h (box in thousandths, 0-1000), or the older
// latex|x|y|w|h. The last four fields are the box, so a "|" inside the LaTeX (absolute value) survives.
// A word of 3+ letters right before the box is the tag (an unknown one means none); 0-1 decimals work too.
export function lineTerm(line: string, id: number): Term | null {
  const f = line.trim().split('|')
  if (f.length < 5) return null
  const nums = f.slice(-4)
  if (!nums.every(n => NUM.test(n))) return null
  const hasTag = f.length >= 6 && /^[a-z]{3,}$/i.test(f[f.length - 5].trim())
  const tag = hasTag ? f[f.length - 5].trim().toLowerCase() : undefined
  const v = nums.map(Number)
  const scale = v.every(n => n <= 1) && nums.some(n => n.includes('.')) ? 1 : 1000
  const [x, y, w, h] = v.map(n => n / scale)
  return toTerm({ latex: f.slice(0, hasTag ? -5 : -4).join('|'), tag, box: { x, y, w, h } }, id)
}

function parseLines(text: string): Term[] {
  const out: Term[] = []
  for (const line of text.split('\n')) {
    const term = lineTerm(line, out.length + 1)
    if (term) out.push(term)
  }
  return out
}

// Accepts the compact line format and the older JSON format ({"terms":[{latex, phrase?, box}]}).
export function parseBoardResponse(text: string): Term[] {
  try {
    const a = text.indexOf('{'), b = text.lastIndexOf('}')
    if (a < 0 || b < a) return parseLines(text)
    const terms = JSON.parse(text.slice(a, b + 1))?.terms
    if (!Array.isArray(terms)) return parseLines(text)
    const out: Term[] = []
    for (const t of terms) {
      const term = toTerm(t, out.length + 1)
      if (term) out.push(term)
    }
    return out
  } catch {
    return parseLines(text)
  }
}

import type { Term } from '../src/core/types'

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0

export function parseBoardResponse(text: string): Term[] {
  try {
    const a = text.indexOf('{'), b = text.lastIndexOf('}')
    if (a < 0 || b < a) return []
    const terms = JSON.parse(text.slice(a, b + 1))?.terms
    if (!Array.isArray(terms)) return []
    const out: Term[] = []
    for (const t of terms) {
      const bx = t?.box
      if (!str(t?.latex) || !str(t?.phrase) || !bx || !num(bx.x) || !num(bx.y) || !num(bx.w) || !num(bx.h)) continue
      const x = Math.min(1, Math.max(0, bx.x)), y = Math.min(1, Math.max(0, bx.y))
      const w = Math.min(bx.w, 1 - x), h = Math.min(bx.h, 1 - y)
      if (w <= 0 || h <= 0) continue
      const latex = t.latex.trim(), phrase = t.phrase.trim()
      if (!latex || !phrase) continue
      out.push({ id: out.length + 1, latex, phrase, box: { x, y, w, h } })
    }
    return out
  } catch {
    return []
  }
}

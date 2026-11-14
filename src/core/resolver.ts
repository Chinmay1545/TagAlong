import { MAX_DIST, TIP_WINDOW_MS } from './config'
import type { TipBuffer } from './tipBuffer'
import type { Box, Resolution, Term, TipSample, WordEvent } from './types'

const EPS = 1e-9

export function boxDistance(box: Box, x: number, y: number): number {
  const dx = Math.max(box.x - x, 0, x - (box.x + box.w))
  const dy = Math.max(box.y - y, 0, y - (box.y + box.h))
  return Math.hypot(dx, dy)
}

export function termAt(terms: Term[], x: number, y: number, maxDist = MAX_DIST): Term | null {
  let best: Term | null = null
  let bestD = Infinity
  for (const term of terms) {
    const d = boxDistance(term.box, x, y)
    if (d > maxDist) continue
    if (d < bestD - EPS || (Math.abs(d - bestD) <= EPS && best && term.id < best.id)) {
      best = term
      bestD = d
    }
  }
  return best
}

export function steadiestTip(
  track: TipSample[],
  t: number,
  windowMs = TIP_WINDOW_MS,
): { x: number; y: number } | null {
  const s = track.filter(p => Math.abs(p.t - t) <= windowMs)
  let best: TipSample | null = null
  let bestSpeed = Infinity
  s.forEach((p, i) => {
    const o = i < s.length - 1 ? s[i + 1] : s[i - 1]
    const speed = o ? Math.hypot(o.x - p.x, o.y - p.y) : 0
    if (speed < bestSpeed || (speed === bestSpeed && best && Math.abs(p.t - t) < Math.abs(best.t - t))) {
      best = p
      bestSpeed = speed
    }
  })
  return best ? { x: (best as TipSample).x, y: (best as TipSample).y } : null
}

export function termsAlongPath(
  terms: Term[],
  track: TipSample[],
  t0: number,
  t1: number,
  maxDist = MAX_DIST,
): Term[] {
  const out: Term[] = []
  for (const p of track) {
    if (p.t < t0 || p.t > t1) continue
    const term = termAt(terms, p.x, p.y, maxDist)
    if (term && !out.includes(term)) out.push(term)
  }
  return out
}

export function resolvePointer(word: WordEvent, terms: Term[], tips: TipBuffer): Resolution {
  if (!word.isPointer) return { word, terms: [] }
  const { t } = word
  const w = word.word.toLowerCase().replace(/[^a-z]/g, '')
  if (w === 'these' || w === 'those') {
    return { word, terms: termsAlongPath(terms, tips.window(t - 1000, t + 1000), t - 1000, t + 1000) }
  }
  const tip = steadiestTip(tips.window(t - TIP_WINDOW_MS, t + TIP_WINDOW_MS), t)
  const term = tip ? termAt(terms, tip.x, tip.y) : null
  return { word, terms: term ? [term] : [] }
}

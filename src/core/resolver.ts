import { DWELL_MS, DWELL_RADIUS, MAX_DIST, NEST_SNAP, TIP_WINDOW_MS } from './config'
import type { TipBuffer } from './tipBuffer'
import type { Box, Resolution, Term, TipSample, WordEvent } from './types'

// Pointer points come from any source (finger, stick, laser, mouse); tips.lead() keeps only the one that wins.

const EPS = 1e-9

export function boxDistance(box: Box, x: number, y: number): number {
  const dx = Math.max(box.x - x, 0, x - (box.x + box.w))
  const dy = Math.max(box.y - y, 0, y - (box.y + box.h))
  return Math.hypot(dx, dy)
}

// The term the point is on. Inside more than one box (a bracket group and a term in it): the smallest box wins,
// so pointing at y inside (2x+y) gives y. Inside none: the nearest box within maxDist. Ties go to the lowest id.
// Near miss: a pointer inside a group box and within `snap` of a smaller term that sits in that group means
// the smaller term (a fingertip is not tracked more exactly than that). Pass snap = 0 for the plain rule.
export function termAt(terms: Term[], x: number, y: number, maxDist = MAX_DIST, snap = NEST_SNAP): Term | null {
  let best: Term | null = null
  let bestD = Infinity
  let bestArea = Infinity
  for (const term of terms) {
    const d = boxDistance(term.box, x, y)
    if (d > maxDist) continue
    const area = term.box.w * term.box.h
    const sameD = Math.abs(d - bestD) <= EPS
    const inside = d <= EPS
    const better =
      d < bestD - EPS ||
      (sameD && inside && area < bestArea - EPS) ||
      (sameD && (!inside || Math.abs(area - bestArea) <= EPS) && best !== null && term.id < best.id)
    if (better) {
      best = term
      bestD = d
      bestArea = area
    }
  }
  if (!best || bestD > EPS) return best
  // The pointer is inside `best`. Look for a smaller term inside it that the pointer only just misses.
  const reach = Math.min(snap, maxDist)
  let pick: Term | null = null
  let pickD = Infinity
  let pickArea = Infinity
  for (const term of terms) {
    const area = term.box.w * term.box.h
    if (term === best || area >= bestArea - EPS) continue
    const d = boxDistance(term.box, x, y)
    if (d > reach) continue
    if (boxDistance(best.box, term.box.x + term.box.w / 2, term.box.y + term.box.h / 2) > EPS) continue // not in the group
    const sameD = Math.abs(d - pickD) <= EPS
    if (d < pickD - EPS || (sameD && area < pickArea - EPS) || (sameD && Math.abs(area - pickArea) <= EPS && pick !== null && term.id < pick.id)) {
      pick = term
      pickD = d
      pickArea = area
    }
  }
  return pick ?? best
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

// Where the pointer rested around time t: the middle of a run of points that stayed within `radius` of each
// other for at least `dwellMs`. The middle smooths a shaky laser. Null if the pointer never rested (a hand
// passing by, or nothing in view). With more than one rest, the one nearest t wins, then the longer one.
export function dwellPoint(
  track: TipSample[],
  t: number,
  windowMs = TIP_WINDOW_MS,
  dwellMs = DWELL_MS,
  radius = DWELL_RADIUS,
): { x: number; y: number } | null {
  const s = track.filter(p => Math.abs(p.t - t) <= windowMs)
  let best: { x: number; y: number } | null = null
  let bestGap = Infinity
  let bestSpan = 0
  for (let i = 0; i < s.length; i++) {
    let sx = s[i].x, sy = s[i].y, n = 1
    let j = i
    while (j + 1 < s.length && Math.hypot(s[j + 1].x - sx / n, s[j + 1].y - sy / n) <= radius) {
      j++
      sx += s[j].x
      sy += s[j].y
      n++
    }
    const span = s[j].t - s[i].t
    if (span < dwellMs) continue
    const gap = t < s[i].t ? s[i].t - t : t > s[j].t ? t - s[j].t : 0
    if (gap < bestGap || (gap === bestGap && span > bestSpan)) {
      best = { x: sx / n, y: sy / n }
      bestGap = gap
      bestSpan = span
    }
  }
  return best
}

// Why a pointer word found no term: nothing was really pointing, or it pointed at a spot with no box.
// Only the second can be "ink not read yet" (live.ts holds it); the first must stay silent.
export type PointerMiss = 'not-pointing' | 'empty-space'
export type PointerRead = { resolution: Resolution; aim: { x: number; y: number } | null; miss: PointerMiss | null }

// when: the moment to look at and how far either side of it. By default the word's own time and
// TIP_WINDOW_MS; live.ts looks earlier and wider for words that arrive late (browser speech).
export type When = { at: number; windowMs: number }

export function readPointer(word: WordEvent, terms: Term[], tips: TipBuffer, when?: When): PointerRead {
  const none = (miss: PointerMiss, aim: PointerRead['aim'] = null): PointerRead => ({ resolution: { word, terms: [] }, aim, miss })
  if (!word.isPointer) return none('not-pointing')
  const t = when?.at ?? word.t
  const windowMs = when?.windowMs ?? TIP_WINDOW_MS
  const w = word.word.toLowerCase().replace(/[^a-z]/g, '')
  if (w === 'these' || w === 'those') {
    // A sweep across several terms: no rest needed.
    const track = tips.lead(t - 1000, t + 1000)
    const found = termsAlongPath(terms, track, t - 1000, t + 1000)
    return found.length ? { resolution: { word, terms: found }, aim: null, miss: null } : none(track.length ? 'empty-space' : 'not-pointing')
  }
  // this / that / here: whisper only if the pointer (of any kind) rested on one spot around the word.
  // The pointer that counts is the one seen around the word itself (a laser put away a moment ago does not).
  const aim = dwellPoint(tips.leadAt(t, windowMs), t, windowMs)
  if (!aim) return none('not-pointing')
  const term = termAt(terms, aim.x, aim.y)
  return term ? { resolution: { word, terms: [term] }, aim, miss: null } : none('empty-space', aim)
}

export function resolvePointer(word: WordEvent, terms: Term[], tips: TipBuffer): Resolution {
  return readPointer(word, terms, tips).resolution
}

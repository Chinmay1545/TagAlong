import type { TipSample } from '../core/types'

// One shape for everything that can point at the board. Board coordinates 0..1, raw (never mirrored).
// 'mouse' is the demo-mode pointer on the saved photo.
export type PointerKind = 'finger' | 'stick' | 'laser' | 'mouse'
export type PointerPoint = { kind: PointerKind; x: number; y: number; confidence: number; t: number }

// What the buffer and the resolver accept: a pointer point, or a plain fingertip sample (counts as a finger).
export type AnyPoint = TipSample | PointerPoint

export const kindOf = (s: AnyPoint): PointerKind => ('kind' in s ? s.kind : 'finger')
export const toPointer = (s: AnyPoint): PointerPoint =>
  'kind' in s ? s : { kind: 'finger', x: s.x, y: s.y, confidence: 1, t: s.t }

// Things that physically cover the board, so a board read should wait for them to leave. A laser never does.
export const coversBoard = (kind: PointerKind): boolean => kind === 'finger' || kind === 'stick'

export const pointerLabel = (kind: PointerKind): string => kind

// Who wins when more than one pointer is seen at once. A hand that holds a laser or a stick is in the
// picture too, so the tool beats the finger. The mouse only exists in demo mode and is always on purpose.
const PRIORITY: PointerKind[] = ['mouse', 'laser', 'stick', 'finger']
// A laser or stick needs this many points in the window before it takes over (one false dot must not).
export const MIN_TOOL_POINTS = 3
const POINTER_FRESH_MS = 500

// The samples of the winning kind, in time order.
export function leading<T extends AnyPoint>(samples: T[]): T[] {
  if (!samples.length) return []
  const count = new Map<PointerKind, number>()
  for (const s of samples) count.set(kindOf(s), (count.get(kindOf(s)) ?? 0) + 1)
  const need = (k: PointerKind) => (k === 'laser' || k === 'stick' ? MIN_TOOL_POINTS : 1)
  const kind = PRIORITY.find(k => (count.get(k) ?? 0) >= need(k)) ?? PRIORITY.find(k => count.has(k))!
  return samples.filter(s => kindOf(s) === kind)
}

// The pointer to draw right now: the newest fresh point of the winning kind, or null.
export function activePointer(samples: AnyPoint[], now: number, freshMs = POINTER_FRESH_MS): PointerPoint | null {
  const lead = leading(samples.filter(s => now - s.t < freshMs))
  return lead.length ? toPointer(lead[lead.length - 1]) : null
}

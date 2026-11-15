import type { PointerPoint } from './pointer'

type Pt = { x: number; y: number }

// A finger counts as out when its tip is this much farther from the wrist than its middle joint. Strict on
// purpose: a relaxed pointing hand (others half curled, about 1.1) must not read as open, or a single-term
// point would whisper the whole equation.
export const OPEN_RATIO = 1.25
const TIPS = [8, 12, 16, 20]
const PIPS = [6, 10, 14, 18]

// All four fingers (index to pinky) clearly extended. x is scaled by aspect so distances are true at any frame shape.
export function isOpenHand(landmarks: Pt[] | undefined, aspect: number): boolean {
  if (!landmarks || landmarks.length < 21) return false
  const w = landmarks[0]
  const d = (p: Pt) => Math.hypot((p.x - w.x) * aspect, p.y - w.y)
  return TIPS.every((tip, i) => d(landmarks[tip]) > OPEN_RATIO * d(landmarks[PIPS[i]]))
}

// The middle of the fingers (knuckles and fingertips): that is what lies on the writing.
export function palmCentre(landmarks: Pt[]): Pt {
  const ids = [5, 9, 13, 17, ...TIPS]
  return { x: ids.reduce((s, i) => s + landmarks[i].x, 0) / ids.length, y: ids.reduce((s, i) => s + landmarks[i].y, 0) / ids.length }
}

// What the hand tracker pushes for one frame: the palm for an open hand (when the gesture is on), else the fingertip.
export function handPoint(landmarks: Pt[] | undefined, aspect: number, confidence: number, t: number, gesture: boolean): PointerPoint | null {
  const tip = landmarks?.[8]
  if (!landmarks || !tip) return null
  if (gesture && isOpenHand(landmarks, aspect)) return { kind: 'palm', ...palmCentre(landmarks), confidence, t }
  return { kind: 'finger', x: tip.x, y: tip.y, confidence, t }
}

// Synthetic MediaPipe landmarks (21 points, normalised 0..1) for a hand, built in true units (height = 1)
// and then squeezed into the frame's aspect, so tests can use 16:9 and any rotation.
type Pt = { x: number; y: number }
// reach: wrist-to-tip distance for each finger [index, middle, ring, pinky]; the PIP joint is always 0.15 out.
export function hand(reach: number[], opts: { angle?: number; aspect?: number; at?: Pt } = {}): Pt[] {
  const { angle = 0, aspect = 1, at = { x: 0.5, y: 0.5 } } = opts
  const lateral = [-0.045, -0.015, 0.015, 0.045]
  const pts: Pt[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }))
  const put = (i: number, along: number, side: number) => { pts[i] = { x: side, y: -along } } // up is -y
  put(0, 0, 0)
  ;[1, 2, 3, 4].forEach((i, k) => put(i, 0.04 + k * 0.03, -0.06 - k * 0.015)) // thumb off to the side
  ;[5, 9, 13, 17].forEach((b, f) => {
    put(b, 0.1, lateral[f])
    put(b + 1, 0.15, lateral[f]) // PIP
    put(b + 2, (0.15 + reach[f]) / 2, lateral[f]) // DIP
    put(b + 3, reach[f], lateral[f]) // tip
  })
  const c = Math.cos(angle), s = Math.sin(angle)
  return pts.map(p => ({ x: at.x + (p.x * c - p.y * s) / aspect, y: at.y + (p.x * s + p.y * c) }))
}
export const OPEN = [0.26, 0.28, 0.26, 0.22]
export const POINT = [0.26, 0.1, 0.1, 0.1]
export const FIST = [0.1, 0.1, 0.1, 0.1]
export const RELAXED = [0.26, 0.165, 0.165, 0.16] // others half curled, ratio about 1.1

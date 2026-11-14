import { LASER_COLOURS, LASER_STATIC_MS, LASER_STATIC_WEAK_MS } from '../core/config'
import type { Frame } from './frame'
import type { PointerPoint } from './pointer'

// Laser dot detector: plain image processing, no model. A laser dot is a small, round, very bright spot,
// red or green at the rim and often white in the middle. It is brighter than the board around it (ink is
// darker), far smaller than glare or clothing, and it shows up for more than one frame.

export type LaserColour = 'red' | 'green'
export type LaserOptions = {
  colours: readonly LaserColour[]
  minBright: number // the laser's own channel must be at least this bright (0..255)
  minColour: number // and this far above the other two channels
  maxSize: number // biggest dot, as a fraction of the frame width (bigger = glare, reflection, clothing)
  minPixels: number
  minGlow: number // the dot must be this much brighter than the board around it
}
export const LASER_DEFAULTS: LaserOptions = {
  colours: LASER_COLOURS,
  minBright: 200,
  minColour: 40,
  maxSize: 0.035,
  minPixels: 2,
  minGlow: 20,
}

// x, y: centre in frame coordinates 0..1. strong: clearly brighter than its surroundings. ageMs: how long
// its pixels have looked like this without a break (only known to the tracker).
export type LaserDot = { x: number; y: number; confidence: number; colour: LaserColour; pixels: number; strong: boolean; ageMs: number }

const RED = 1, GREEN = 2
const MAX_BLOBS = 40 // more coloured specks than this is a busy scene, not a laser
const MAX_DOTS = 6

// Marks every pixel that has a laser's colour: 0 none, 1 red, 2 green.
function classify(frame: Frame, o: LaserOptions, out: Uint8Array): number {
  const { data } = frame
  const red = o.colours.includes('red'), green = o.colours.includes('green')
  let n = 0
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2]
    let c = 0
    if (red && r >= o.minBright && r - g >= o.minColour && r - b >= o.minColour) c = RED
    else if (green && g >= o.minBright && g - r >= o.minColour && g - b >= o.minColour * 0.75) c = GREEN
    out[i] = c
    if (c) n++
  }
  return n
}

function dotsFrom(frame: Frame, cls: Uint8Array, count: number, o: LaserOptions, ages: Float32Array | null): LaserDot[] {
  const { data, width: W, height: H } = frame
  if (count === 0 || count > W * H * 0.05) return [] // nothing, or a red/green wall
  const maxDim = Math.max(4, Math.round(o.maxSize * W))
  const seen = new Uint8Array(cls.length)
  const stack: number[] = []
  const dots: LaserDot[] = []
  let blobs = 0
  for (let start = 0; start < cls.length; start++) {
    if (!cls[start] || seen[start]) continue
    if (++blobs > MAX_BLOBS) return []
    // Grow the blob. Pixels up to 2 apart join, so a rim broken by its white centre stays one dot.
    const c = cls[start]
    const ch = c === RED ? 0 : 1
    let n = 0, sx = 0, sy = 0, sum = 0, age = 0
    let x0 = W, y0 = H, x1 = -1, y1 = -1
    seen[start] = 1
    stack.push(start)
    while (stack.length) {
      const i = stack.pop()!
      const x = i % W, y = (i - x) / W
      n++; sx += x; sy += y; sum += data[i * 4 + ch]
      if (ages) age += ages[i]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= H) continue
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= W) continue
          const j = yy * W + xx
          if (cls[j] === c && !seen[j]) { seen[j] = 1; stack.push(j) }
        }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1
    const long = Math.max(bw, bh), short = Math.min(bw, bh)
    if (n < o.minPixels || long > maxDim) continue // a speck of noise, or glare / a reflection / clothing
    if (long > 3 && long / short > 3) continue // a streak, not a dot
    // The board around the dot: a band a few pixels outside its box.
    const pad = Math.max(3, long)
    let ring = 0, rn = 0
    for (let y = Math.max(0, y0 - pad); y <= Math.min(H - 1, y1 + pad); y++) {
      for (let x = Math.max(0, x0 - pad); x <= Math.min(W - 1, x1 + pad); x++) {
        if (x >= x0 - 2 && x <= x1 + 2 && y >= y0 - 2 && y <= y1 + 2) continue
        ring += data[(y * W + x) * 4 + ch]
        rn++
      }
    }
    const around = rn ? ring / rn : 0
    const glow = sum / n - around
    const strong = glow >= o.minGlow
    // On an over-exposed board nothing can be brighter than its surroundings. Accept the dot as "weak":
    // one frame cannot tell it from ink, so the tracker drops it if it never moves.
    if (!strong && !(around >= 225 && sum / n >= 245)) continue
    dots.push({
      x: (sx / n + 0.5) / W,
      y: (sy / n + 0.5) / H,
      confidence: strong ? 0.6 + 0.4 * Math.min(1, glow / 100) : 0.4,
      colour: c === RED ? 'red' : 'green',
      pixels: n,
      strong,
      ageMs: ages ? age / n : 0,
    })
  }
  if (dots.length > MAX_DOTS) return []
  return dots.sort((a, b) => b.confidence - a.confidence || a.ageMs - b.ageMs || b.pixels - a.pixels)
}

// Every laser-like dot in one frame, best first. Pure: same frame in, same dots out.
export function findLaserDots(frame: Frame, options: Partial<LaserOptions> = {}): LaserDot[] {
  const o = { ...LASER_DEFAULTS, ...options }
  const cls = new Uint8Array(frame.width * frame.height)
  return dotsFrom(frame, cls, classify(frame, o, cls), o, null)
}

const MIN_FRAMES = 2 // seen this many frames in a row before it counts
const LOST_MS = 200 // not seen for this long: the track is over
const MAX_JUMP = 0.12 // furthest a dot can move between frames and still be the same dot

// Follows the dot across frames. Call update with each frame; it returns a laser pointer point or null.
export function createLaserTracker(options: Partial<LaserOptions> = {}) {
  const o = { ...LASER_DEFAULTS, ...options }
  let cls = new Uint8Array(0)
  let ages = new Float32Array(0) // per pixel: how long it has had a laser colour without a break
  let lastT: number | null = null
  let track: { x: number; y: number; hits: number; t: number } | null = null
  return {
    update(frame: Frame, t: number): PointerPoint | null {
      const size = frame.width * frame.height
      if (cls.length !== size) { cls = new Uint8Array(size); ages = new Float32Array(size); lastT = null }
      const dt = lastT === null ? 0 : Math.min(100, Math.max(0, t - lastT))
      lastT = t
      const count = classify(frame, o, cls)
      for (let i = 0; i < size; i++) ages[i] = cls[i] ? ages[i] + dt : 0
      // A dot whose pixels have not changed for a long time is ink or a fixed light, not a hand-held laser.
      const dots = dotsFrom(frame, cls, count, o, ages).filter(d => d.ageMs <= (d.strong ? LASER_STATIC_MS : LASER_STATIC_WEAK_MS))
      if (track && t - track.t > LOST_MS) track = null
      let pick: LaserDot | null = null
      if (track) {
        let best = MAX_JUMP
        for (const d of dots) {
          const dist = Math.hypot(d.x - track.x, d.y - track.y)
          if (dist <= best) { best = dist; pick = d }
        }
      }
      if (pick) track = { x: pick.x, y: pick.y, hits: track!.hits + 1, t }
      else if (dots.length) { pick = dots[0]; track = { x: pick.x, y: pick.y, hits: 1, t } }
      if (!pick || track!.hits < MIN_FRAMES) return null
      return { kind: 'laser', x: pick.x, y: pick.y, confidence: pick.confidence, t }
    },
    reset() { track = null; lastT = null; ages.fill(0) },
  }
}

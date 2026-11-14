import type { Frame } from './frame'
import type { PointerPoint } from './pointer'

// Stick / ruler tip detector for a plain stick with no tape on it. Plain image processing, no model.
//
// How it works: it keeps a slowly updated picture of the board (the background). Anything that differs
// from it is "new" (a person, an arm, a stick). A stick is the part of the new stuff that is long, thin
// and straight, and that is held: one end is at the hand, on the arm, or at the edge of the picture.
// The other end is the tip. Ink already on the board is background, so an old line is never a stick. A line
// just drawn, with the hand still on its end, looks held too; but its far end never moves, and a stick's tip
// does. So a stick only counts once its tip has been seen to move.

// What the hand tracker knows about the hand. x, y: centre (0..1). r: hand radius as a fraction of the
// frame width. (fx, fy): unit vector in pixel space from the knuckles toward the elbow (where the arm leaves).
export type HandInfo = { x: number; y: number; r: number; fx: number; fy: number; t: number }

// From MediaPipe's 21 hand landmarks (0 = wrist, 9 = middle knuckle). aspect = frame width / height.
export function handInfo(landmarks: { x: number; y: number }[] | undefined, aspect: number, t: number): HandInfo | null {
  if (!landmarks || landmarks.length < 21) return null
  let x = 0, y = 0
  for (const p of landmarks) { x += p.x; y += p.y }
  x /= landmarks.length
  y /= landmarks.length
  let r = 0
  for (const p of landmarks) r = Math.max(r, Math.hypot(p.x - x, (p.y - y) / aspect))
  const dx = landmarks[0].x - landmarks[9].x, dy = (landmarks[0].y - landmarks[9].y) / aspect
  const d = Math.hypot(dx, dy) || 1
  return { x, y, r, fx: dx / d, fy: dy / d, t }
}

export type StickOptions = {
  shrink: number // the frame is shrunk by this factor first (noise averages out, and it is fast)
  minDiff: number // a pixel is "new" when its colour differs from the background by more than this (sum of r, g, b)
  maxWidth: number // thickest stick, as a fraction of the frame width (an arm is thicker)
  minLength: number // shortest stick, as a fraction of the frame width (a finger or a pen is shorter)
  learnMs: number // how fast the background follows the board where nothing is new
  forgetMs: number // how fast something new that stays put becomes background (a stick left lying, a ghost)
}
export const STICK_DEFAULTS: StickOptions = { shrink: 2, minDiff: 60, maxWidth: 0.02, minLength: 0.12, learnMs: 500, forgetMs: 15000 }

const MIN_FRAMES = 2 // seen this many frames in a row before it counts
const LOST_MS = 400
const MIN_MOVE = 0.03 // the tip must have travelled this far (fraction of the frame) since it was first seen
const MAX_JUMP = 0.2 // furthest the tip can move between frames and still be the same stick
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]] as const

type Segment = { tx: number; ty: number; bx: number; by: number; length: number; score: number }

export function createStickTracker(options: Partial<StickOptions> = {}) {
  const o = { ...STICK_DEFAULTS, ...options }
  let w = 0, h = 0
  let cur = new Float32Array(0) // shrunk frame, rgb
  let bg = new Float32Array(0) // background, rgb
  let fg = new Uint8Array(0) // 1 = new, 2 = new and thin
  let seen = new Uint8Array(0)
  let diff = new Float32Array(0)
  let lastT: number | null = null
  // x, y: the tip now. ox, oy: where the tip was first seen. moved: it has travelled since, so it is not ink.
  let track: { x: number; y: number; ox: number; oy: number; moved: boolean; hits: number; t: number } | null = null

  // Average shrink x shrink blocks of the frame into `cur`.
  function shrinkInto(frame: Frame) {
    const s = o.shrink, W = frame.width, d = frame.data, k = 1 / (s * s)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
        const p = ((y * s + dy) * W + x * s + dx) * 4
        r += d[p]; g += d[p + 1]; b += d[p + 2]
      }
      const i = (y * w + x) * 3
      cur[i] = r * k; cur[i + 1] = g * k; cur[i + 2] = b * k
    }
  }

  // Long, thin, straight pieces of the new stuff, each with its two ends, best first.
  function segments(hand: HandInfo | null): Segment[] {
    const maxW = Math.max(3, Math.round(o.maxWidth * w))
    const handR = hand ? hand.r * w : 0
    const minLen = Math.max(o.minLength * w, 1.6 * handR)
    // Thin: the run of new pixels through this pixel is short in at least one direction.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!fg[i]) continue
      for (const [dx, dy] of DIRS) {
        const cap = dx && dy ? Math.max(2, Math.round(maxW / Math.SQRT2)) : maxW
        let run = 1
        for (const sgn of [1, -1]) {
          let xx = x + dx * sgn, yy = y + dy * sgn
          while (run <= cap && xx >= 0 && yy >= 0 && xx < w && yy < h && fg[yy * w + xx]) { run++; xx += dx * sgn; yy += dy * sgn }
        }
        if (run <= cap) { fg[i] = 2; break }
      }
    }
    // How much thick new stuff (hand, arm, body) is right next to a point.
    const thickNear = (px: number, py: number) => {
      let n = 0
      const R = maxW + 3
      for (let y = Math.max(0, Math.round(py - R)); y <= Math.min(h - 1, Math.round(py + R)); y++)
        for (let x = Math.max(0, Math.round(px - R)); x <= Math.min(w - 1, Math.round(px + R)); x++)
          if (fg[y * w + x] === 1) n++
      return n
    }
    const atEdge = (px: number, py: number) => px < 4 || py < 4 || px > w - 5 || py > h - 5

    seen.fill(0)
    const out: Segment[] = []
    const stack: number[] = []
    const xs: number[] = [], ys: number[] = []
    for (let start = 0; start < fg.length; start++) {
      if (fg[start] !== 2 || seen[start]) continue
      xs.length = ys.length = 0
      let contrast = 0
      seen[start] = 1
      stack.push(start)
      while (stack.length) {
        const i = stack.pop()!
        const x = i % w, y = (i - x) / w
        xs.push(x); ys.push(y); contrast += diff[i]
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { // pixels up to 2 apart join: bridges small gaps
          const xx = x + dx, yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const j = yy * w + xx
          if (fg[j] === 2 && !seen[j]) { seen[j] = 1; stack.push(j) }
        }
      }
      const n = xs.length
      if (n < minLen) continue
      // Best-fit line through the pixels (principal axis).
      let mx = 0, my = 0
      for (let k = 0; k < n; k++) { mx += xs[k]; my += ys[k] }
      mx /= n; my /= n
      let sxx = 0, syy = 0, sxy = 0
      for (let k = 0; k < n; k++) { const dx = xs[k] - mx, dy = ys[k] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy }
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy)
      const ux = Math.cos(ang), uy = Math.sin(ang)
      let lo = Infinity, hi = -Infinity, off = 0
      for (let k = 0; k < n; k++) {
        const dx = xs[k] - mx, dy = ys[k] - my
        const along = dx * ux + dy * uy, across = dy * ux - dx * uy
        if (along < lo) lo = along
        if (along > hi) hi = along
        off += across * across
      }
      const length = hi - lo
      const spread = Math.sqrt(off / n) // how far the pixels sit from the line
      if (length < minLen) continue
      if (spread > Math.max(1.2, maxW * 0.45)) continue // bent or blobby, not a straight stick
      if (n < length * 0.6) continue // mostly gaps
      const ends = [{ x: mx + lo * ux, y: my + lo * uy }, { x: mx + hi * ux, y: my + hi * uy }]
      // Which end is held? The one at the hand; else the one on the arm or body; else the one at the edge.
      let base = -1
      if (hand) {
        const d = ends.map(e => Math.hypot(e.x - hand.x * w, e.y - hand.y * h))
        const b = d[0] <= d[1] ? 0 : 1
        if (d[b] <= handR * 1.5 + maxW + 3) base = b
      }
      if (base < 0) {
        const thick = ends.map(e => thickNear(e.x, e.y))
        const need = maxW * 2
        if (thick[0] >= need && thick[1] < need / 2) base = 0
        else if (thick[1] >= need && thick[0] < need / 2) base = 1
        else if (thick[0] < need / 2 && thick[1] < need / 2) {
          const e = ends.map(p => atEdge(p.x, p.y))
          if (e[0] !== e[1]) base = e[0] ? 0 : 1
        }
      }
      if (base < 0) continue // not held by anything: a drawn line, a shadow, a ghost
      const tip = ends[1 - base], held = ends[base]
      if (hand) {
        // The forearm (a thin arm seen from far away) also starts at the hand, but leaves the way the arm does.
        const dx = tip.x - held.x, dy = tip.y - held.y
        const cos = (dx * hand.fx + dy * hand.fy) / (Math.hypot(dx, dy) || 1)
        if (cos > 0.75) continue
      }
      out.push({ tx: tip.x, ty: tip.y, bx: held.x, by: held.y, length, score: length * (contrast / n) })
    }
    return out.sort((a, b) => b.score - a.score)
  }

  return {
    // frame: the camera picture. hand: the tracked hand right now, or null. Returns the stick tip or null.
    update(frame: Frame, t: number, hand: HandInfo | null): PointerPoint | null {
      const nw = Math.floor(frame.width / o.shrink), nh = Math.floor(frame.height / o.shrink)
      const first = nw !== w || nh !== h || lastT === null
      if (nw !== w || nh !== h) {
        w = nw; h = nh
        cur = new Float32Array(w * h * 3); bg = new Float32Array(w * h * 3)
        fg = new Uint8Array(w * h); seen = new Uint8Array(w * h); diff = new Float32Array(w * h)
      }
      shrinkInto(frame)
      const dt = lastT === null ? 0 : Math.min(200, Math.max(0, t - lastT))
      lastT = t
      if (first) { bg.set(cur); track = null; return null }

      let count = 0
      for (let i = 0, p = 0; i < fg.length; i++, p += 3) {
        const d = Math.abs(cur[p] - bg[p]) + Math.abs(cur[p + 1] - bg[p + 1]) + Math.abs(cur[p + 2] - bg[p + 2])
        diff[i] = d
        fg[i] = d > o.minDiff ? 1 : 0
        if (fg[i]) count++
      }
      if (count > fg.length * 0.35) { // the lights changed or the camera moved: start again from this picture
        bg.set(cur)
        track = null
        return null
      }
      // The background follows the board quickly where nothing is new, and very slowly where something is.
      const learn = 1 - Math.exp(-dt / o.learnMs), forget = 1 - Math.exp(-dt / o.forgetMs)
      for (let i = 0, p = 0; i < fg.length; i++, p += 3) {
        const a = fg[i] ? forget : learn
        bg[p] += (cur[p] - bg[p]) * a
        bg[p + 1] += (cur[p + 1] - bg[p + 1]) * a
        bg[p + 2] += (cur[p + 2] - bg[p + 2]) * a
      }

      const found = count ? segments(hand) : []
      if (track && t - track.t > LOST_MS) track = null
      let pick: Segment | null = null
      if (track) {
        let best = MAX_JUMP
        for (const s of found) {
          const d = Math.hypot(s.tx / w - track.x, s.ty / h - track.y)
          if (d <= best) { best = d; pick = s }
        }
      }
      if (pick) {
        const x = pick.tx / w, y = pick.ty / h
        const moved = track!.moved || Math.hypot(x - track!.ox, (y - track!.oy) * (h / w)) >= MIN_MOVE
        track = { ...track!, x, y, moved, hits: track!.hits + 1, t }
      } else if (found.length) {
        pick = found[0]
        track = { x: pick.tx / w, y: pick.ty / h, ox: pick.tx / w, oy: pick.ty / h, moved: false, hits: 1, t }
      }
      if (!pick || track!.hits < MIN_FRAMES || !track!.moved) return null
      const clamp = (v: number) => Math.min(1, Math.max(0, v))
      return {
        kind: 'stick',
        x: clamp((pick.tx + 0.5) / w),
        y: clamp((pick.ty + 0.5) / h),
        confidence: clamp(0.4 + 0.6 * (pick.length / (0.35 * w))),
        t,
      }
    },
    reset() { lastT = null; track = null },
  }
}

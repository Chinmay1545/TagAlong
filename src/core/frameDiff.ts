import { FRAME_DIFF_THRESHOLD, MIN_CHANGED_CELLS } from './config'
import type { Box } from './types'

const W = 64, H = 36

// Downscale to 64x36 luma by AVERAGING each cell (not one sample per cell, which misses thin marker
// strokes that fall between sample points). Strided for speed: ~8x8 samples per cell, every pixel on
// small frames, so a stroke a few pixels wide always lands on samples.
export function toGraySmall(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(W * H)
  const step = Math.max(1, Math.floor(Math.min(w / W, h / H) / 8))
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor((y * h) / H), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / H))
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * w) / W), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / W))
      let sum = 0, n = 0
      for (let sy = y0; sy < y1 && sy < h; sy += step) for (let sx = x0; sx < x1 && sx < w; sx += step) {
        const i = (sy * w + sx) * 4
        sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
        n++
      }
      out[y * W + x] = n ? Math.round(sum / n) : 0
    }
  }
  return out
}

// Hides pointer dots (a laser) from the change check, in place: the cells around each point (0..1 frame
// coords) take the value they had in `prev`, as if the dot was never there. With no `prev` (first frame)
// they take the average of the cells just outside the hidden square.
export function hideCells(gray: Uint8Array, prev: Uint8Array | null, points: { x: number; y: number }[], radius = 1): Uint8Array {
  for (const p of points) {
    const cx = Math.min(W - 1, Math.max(0, Math.floor(p.x * W))), cy = Math.min(H - 1, Math.max(0, Math.floor(p.y * H)))
    const x0 = Math.max(0, cx - radius), x1 = Math.min(W - 1, cx + radius)
    const y0 = Math.max(0, cy - radius), y1 = Math.min(H - 1, cy + radius)
    let fill = 0
    if (!prev || prev.length !== gray.length) {
      let sum = 0, n = 0
      for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H || (x >= x0 && x <= x1 && y >= y0 && y <= y1)) continue
        sum += gray[y * W + x]
        n++
      }
      fill = n ? Math.round(sum / n) : 0
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x
      gray[i] = prev && prev.length === gray.length ? prev[i] : fill
    }
  }
  return gray
}

const CELL_DIFF = 24 // a 64x36 cell whose brightness moved more than this counts as changed (ink, not noise)

// Bounding box (0..1, raw frame coords) of the cells that changed between two small frames; null if none.
export function changedRegion(a: Uint8Array, b: Uint8Array, cellDiff = CELL_DIFF): Box | null {
  if (a.length !== b.length) return { x: 0, y: 0, w: 1, h: 1 }
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (Math.abs(a[i] - b[i]) <= cellDiff) continue
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return x1 < 0 ? null : { x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H }
}

// Changed if the whole picture moved (average change above `threshold`: a person, the camera, the lights)
// OR at least MIN_CHANGED_CELLS cells changed locally by more than CELL_DIFF (new ink: "x = 5" and "x = 6"
// on a big board move the average by ~1 but darken ~10 cells). The local count first removes the frame's
// median shift, so camera auto-exposure brightening everything a little does not count as ink.
export function frameChanged(a: Uint8Array, b: Uint8Array, threshold = FRAME_DIFF_THRESHOLD, minCells = MIN_CHANGED_CELLS): boolean {
  if (a.length !== b.length) return true
  const d = new Int16Array(a.length)
  let sum = 0
  for (let i = 0; i < a.length; i++) { d[i] = b[i] - a[i]; sum += Math.abs(d[i]) }
  if (sum / a.length > threshold) return true
  const shift = Int16Array.from(d).sort()[d.length >> 1]
  let cells = 0
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i] - shift) > CELL_DIFF && ++cells >= minCells) return true
  return false
}

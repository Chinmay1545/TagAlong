import { FRAME_DIFF_THRESHOLD } from './config'

const W = 64, H = 36

// Nearest-neighbour downscale to 64x36 luma.
export function toGraySmall(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / H))
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / W))
      const i = (sy * w + sx) * 4
      out[y * W + x] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2])
    }
  }
  return out
}

export function frameChanged(a: Uint8Array, b: Uint8Array, threshold = FRAME_DIFF_THRESHOLD): boolean {
  if (a.length !== b.length) return true
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length > threshold
}

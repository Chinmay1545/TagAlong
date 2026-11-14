// Synthetic camera frames for the pointer detectors: plain RGBA buffers, no DOM and no camera.
export type RGB = [number, number, number]
export type TestFrame = { data: Uint8ClampedArray; width: number; height: number }

export const W = 480, H = 270
export const BOARD: RGB = [205, 205, 200] // a whiteboard at normal exposure
export const BLOWN: RGB = [255, 255, 255] // an over-exposed whiteboard
export const DARK: RGB = [35, 40, 38] // a blackboard or a dark slide
export const RED_INK: RGB = [190, 50, 55]
export const BLACK_INK: RGB = [40, 40, 45]
export const SKIN: RGB = [200, 150, 125]

export function makeFrame(bg: RGB = BOARD, width = W, height = H): TestFrame {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4)
  return { data, width, height }
}

export const clone = (f: TestFrame): TestFrame => ({ data: new Uint8ClampedArray(f.data), width: f.width, height: f.height })

export function setPx(f: TestFrame, x: number, y: number, c: RGB) {
  x = Math.round(x); y = Math.round(y)
  if (x < 0 || y < 0 || x >= f.width || y >= f.height) return
  f.data.set([c[0], c[1], c[2], 255], (y * f.width + x) * 4)
}

export function disc(f: TestFrame, cx: number, cy: number, r: number, c: RGB) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if (Math.hypot(x - cx, y - cy) <= r) setPx(f, x, y, c)
}

export function rect(f: TestFrame, x0: number, y0: number, w: number, h: number, c: RGB) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPx(f, x, y, c)
}

// A straight line of the given thickness (in pixels) from (x0, y0) to (x1, y1).
export function line(f: TestFrame, x0: number, y0: number, x1: number, y1: number, thick: number, c: RGB) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2)
  for (let i = 0; i <= n; i++) disc(f, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, thick / 2, c)
}

// A laser dot as a camera sees it: a coloured halo with a white, saturated centre.
export function laserDot(f: TestFrame, cx: number, cy: number, colour: 'red' | 'green' = 'red', r = 3) {
  disc(f, cx, cy, r, colour === 'red' ? [255, 90, 100] : [110, 255, 120])
  disc(f, cx, cy, r / 2.5, [255, 255, 255])
}

// Camera noise: every channel moves by up to +-amp, the same way for the same seed.
export function addNoise(f: TestFrame, amp: number, seed = 1) {
  let s = seed >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < f.data.length; i++) if (i % 4 !== 3) f.data[i] = f.data[i] + Math.round((rnd() * 2 - 1) * amp)
  return f
}

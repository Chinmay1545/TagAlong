import { pointerLabel, type PointerKind, type PointerPoint } from '../vision/pointer'

// Dot colour per kind, so the judge can see at a glance what the app thinks is pointing.
const FILL: Record<PointerKind, string> = { finger: '#fafafa', palm: '#fafafa', stick: '#fbbf24', laser: '#f87171', mouse: '#93c5fd' }
const INK = '#09090b'
const CHIP = 'rgba(9,9,11,0.78)'

// The pointer dot with a small label (finger / stick / laser / mouse). flipX maps a raw x (0..1) to the
// displayed x, because the live picture can be mirrored. Sets ctx.font; call it last in a frame.
export function drawPointerDot(ctx: CanvasRenderingContext2D, p: PointerPoint, W: number, H: number, flipX: (x: number) => number) {
  const x = flipX(p.x) * W, y = p.y * H
  ctx.fillStyle = FILL[p.kind]
  ctx.strokeStyle = INK
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x, y, p.kind === 'palm' ? 14 : 6, 0, Math.PI * 2) // an open hand is drawn as a larger ring
  if (p.kind !== 'palm') ctx.fill()
  ctx.stroke()

  const text = pointerLabel(p.kind)
  ctx.font = '10px "Geist Mono", monospace'
  const w = ctx.measureText(text).width + 8, h = 14
  const lx = Math.max(0, Math.min(W - w, x + 10))
  const ly = Math.max(0, Math.min(H - h, y - h - 6))
  ctx.fillStyle = CHIP
  ctx.beginPath()
  ctx.roundRect(lx, ly, w, h, 3)
  ctx.fill()
  ctx.fillStyle = FILL[p.kind]
  ctx.fillText(text, lx + 4, ly + h - 4)
}

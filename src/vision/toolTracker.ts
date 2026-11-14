import { HAND_RECENT_MS } from '../core/config'
import { createLaserTracker } from './laser'
import { createStickTracker, type HandInfo } from './stick'
import type { Frame } from './frame'
import type { PointerPoint } from './pointer'

// The detectors look at a small copy of each camera frame: a few milliseconds per frame, next to MediaPipe.
export const DETECT_WIDTH = 480

// Runs the laser dot and stick tip detectors on every new camera frame and reports their points, in raw,
// unmirrored frame coordinates 0..1 like the fingertip. getHand: the hand the hand tracker sees, if any
// (the stick detector uses it to tell which end of a stick is held).
export function startToolTracker(
  video: HTMLVideoElement,
  onPoint: (p: PointerPoint) => void,
  getHand: () => HandInfo | null = () => null,
): () => void {
  const canvas = document.createElement('canvas')
  const laser = createLaserTracker()
  const stick = createStickTracker()
  let raf = 0
  let lastTime = -1
  const loop = () => {
    if (video.readyState >= 2 && video.videoWidth && video.currentTime !== lastTime) {
      lastTime = video.currentTime
      try {
        const w = DETECT_WIDTH
        const h = Math.max(1, Math.round((DETECT_WIDTH * video.videoHeight) / video.videoWidth))
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(video, 0, 0, w, h)
        const frame: Frame = ctx.getImageData(0, 0, w, h)
        const now = performance.now()
        const dot = laser.update(frame, now)
        if (dot) onPoint(dot)
        const hand = getHand()
        const tip = stick.update(frame, now, hand && now - hand.t <= HAND_RECENT_MS ? hand : null)
        if (tip) onPoint(tip)
      } catch (e) {
        console.warn('pointer detectors failed, skipping frame:', (e as Error).message) // one bad frame must not kill tracking
      }
    }
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  return () => cancelAnimationFrame(raf)
}

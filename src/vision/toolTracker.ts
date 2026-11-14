import { createLaserTracker } from './laser'
import type { Frame } from './frame'
import type { PointerPoint } from './pointer'

// The detectors look at a small copy of each camera frame: a few milliseconds per frame, next to MediaPipe.
export const DETECT_WIDTH = 480

// Runs the pointer detectors that need no hand model (the laser dot) on every new camera frame and reports
// their points. Points are in raw, unmirrored frame coordinates 0..1, like the fingertip.
export function startToolTracker(video: HTMLVideoElement, onPoint: (p: PointerPoint) => void): () => void {
  const canvas = document.createElement('canvas')
  const laser = createLaserTracker()
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
      } catch (e) {
        console.warn('pointer detectors failed, skipping frame:', (e as Error).message) // one bad frame must not kill tracking
      }
    }
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  return () => cancelAnimationFrame(raf)
}

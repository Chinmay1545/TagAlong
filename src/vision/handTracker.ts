import { HandLandmarker } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import type { TipSample } from '../core/types'

const create = (delegate: 'GPU' | 'CPU') =>
  HandLandmarker.createFromOptions(
    { wasmLoaderPath, wasmBinaryPath },
    { baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate }, runningMode: 'VIDEO', numHands: 1 },
  )

export async function startHandTracker(
  video: HTMLVideoElement,
  onTip: (s: TipSample) => void,
): Promise<() => void> {
  let landmarker: HandLandmarker
  try {
    landmarker = await create('GPU')
  } catch {
    landmarker = await create('CPU')
  }
  let raf = 0
  let lastTime = -1
  const loop = () => {
    if (video.readyState >= 2 && video.currentTime !== lastTime) {
      lastTime = video.currentTime
      try {
        const now = performance.now()
        const tip = landmarker.detectForVideo(video, now).landmarks[0]?.[8]
        if (tip) onTip({ t: now, x: tip.x, y: tip.y }) // unmirrored, never flip
      } catch (e) {
        console.warn('detectForVideo failed, skipping frame:', (e as Error).message) // one bad frame must not kill tracking
      }
    }
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  return () => {
    cancelAnimationFrame(raf)
    landmarker.close()
  }
}

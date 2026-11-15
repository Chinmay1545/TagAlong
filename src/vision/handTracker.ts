import { HandLandmarker } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import type { PointerPoint } from './pointer'
import { handPoint } from './palm'
import { handInfo, type HandInfo } from './stick'

const create = (delegate: 'GPU' | 'CPU') =>
  HandLandmarker.createFromOptions(
    { wasmLoaderPath, wasmBinaryPath },
    { baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate }, runningMode: 'VIDEO', numHands: 1 },
  )

export async function startHandTracker(
  video: HTMLVideoElement,
  onTip: (p: PointerPoint) => void,
  onHand: (h: HandInfo | null) => void = () => {}, // the whole hand, for the stick detector
  openRatio?: number, // how far out a finger must be to count as open (?openratio=)
  gesture: () => boolean = () => true, // open-hand gesture on? (read every frame, so a key can switch it at runtime)
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
        const res = landmarker.detectForVideo(video, now)
        const confidence = res.handedness?.[0]?.[0]?.score ?? 1
        const aspect = video.videoWidth / video.videoHeight
        onHand(handInfo(res.landmarks[0], aspect, now))
        const p = handPoint(res.landmarks[0], aspect, confidence, now, gesture(), openRatio) // fingertip, or the palm for an open hand; unmirrored, never flip
        if (p) onTip(p)
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

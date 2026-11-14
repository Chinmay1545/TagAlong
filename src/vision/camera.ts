// Only the <video> preview is mirrored (CSS); all coordinates stay in the raw frame.
export const toRawX = (displayX: number, mirrored: boolean): number => (mirrored ? 1 - displayX : displayX)

export async function startCamera(video: HTMLVideoElement): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('No camera found')
  let stream: MediaStream
  try {
    // Rear camera on phones (tripod facing the board); "ideal" so laptops still open their only camera.
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: { ideal: 'environment' } }, audio: false })
  } catch (e) {
    const name = (e as DOMException).name
    if (name === 'NotFoundError') throw new Error('No camera found')
    if (name === 'NotAllowedError') throw new Error('Camera permission denied')
    throw new Error(`Camera error: ${(e as Error).message}`)
  }
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
}

// One still of what the camera sees (or the saved demo photo) as a JPEG, for "what is happening?".
export function grabJpeg(src: HTMLVideoElement | HTMLImageElement): Promise<Blob | null> {
  const w = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth
  const h = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight
  if (!w || !h) return Promise.resolve(null)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(src, 0, 0, w, h)
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
}

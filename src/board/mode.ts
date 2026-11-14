// Demo mode (?demo=1 or ?fixture=1) and live mode are kept apart: the saved boxes only ever sit on the
// saved photo, and live mode only ever shows boxes read from the camera.
export type BoardMode = 'demo' | 'live'
export const DEMO_PHOTO = '/fixtures/board-fraction.jpg'

export const boardMode = (search: string): BoardMode => {
  const q = new URLSearchParams(search)
  return q.get('demo') === '1' || q.get('fixture') === '1' ? 'demo' : 'live'
}

export type Stage = { photo: string | null; fixtureTerms: boolean; boardLoop: boolean; mirror: boolean }

// What the stage shows. Demo: the saved photo under its saved boxes, no camera board reads, never mirrored.
// Live: the camera picture, boxes only from board reads, mirrored only when asked (?mirror=1).
export const stageFor = (mode: BoardMode, mirrorParam = false): Stage =>
  mode === 'demo'
    ? { photo: DEMO_PHOTO, fixtureTerms: true, boardLoop: false, mirror: false }
    : { photo: null, fixtureTerms: false, boardLoop: true, mirror: mirrorParam }

type Rect = { left: number; top: number; width: number; height: number }

// Mouse position over the stage -> board coords 0..1 (null outside). In demo mode the mouse can point at the photo.
export function mouseToBoard(clientX: number, clientY: number, r: Rect): { x: number; y: number } | null {
  const x = (clientX - r.left) / r.width, y = (clientY - r.top) / r.height
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y }
}

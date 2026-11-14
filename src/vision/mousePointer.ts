import { mouseToBoard } from '../board/mode'
import type { PointerPoint } from './pointer'

type Rect = { left: number; top: number; width: number; height: number }
const REPEAT_MS = 33 // about the camera's frame rate

// Demo mode: the mouse points at the saved photo. A mouse that rests on a term sends no move events,
// so the last position is repeated while the mouse stays over the stage (a resting mouse keeps pointing).
export function createMousePointer(push: (p: PointerPoint) => void) {
  let at: { x: number; y: number } | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  const send = () => { if (at) push({ kind: 'mouse', x: at.x, y: at.y, confidence: 1, t: performance.now() }) }
  const leave = () => {
    at = null
    if (timer !== null) clearInterval(timer)
    timer = null
  }
  return {
    move(clientX: number, clientY: number, rect: Rect) {
      const p = mouseToBoard(clientX, clientY, rect)
      if (!p) { leave(); return }
      at = p
      send()
      if (timer === null) timer = setInterval(send, REPEAT_MS)
    },
    leave,
    stop: leave,
  }
}

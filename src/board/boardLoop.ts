import type { Box, Term } from '../core/types'
import type { TipBuffer } from '../core/tipBuffer'
import { BOARD_INTERVAL_MS, EMPTY_READS_TO_CLEAR, HAND_RECENT_MS, LASER_MASK_MS, SETTLE_MS } from '../core/config'
import { changedRegion, frameChanged, hideCells, toGraySmall } from '../core/frameDiff'
import { kindOf } from '../vision/pointer'
import { readBoard } from './boardClient'
import { mergeTerms } from '../core/mergeTerms'
import { uniquePhrases } from '../core/phrase'

// Strict >: a hand seen exactly HAND_RECENT_MS ago still counts as recent. "Hand" means anything that
// covers the board (finger or stick); a laser dot covers nothing and never blocks a read.
export function shouldReadBoard(now: number, lastTipAt: number | null, changed: boolean): boolean {
  return changed && (lastTipAt === null || now - lastTipAt > HAND_RECENT_MS)
}

// Counted in checks (not wall time) so it is exact under any clock: still for at least SETTLE_MS.
export const isSettled = (stillTicks: number, intervalMs = BOARD_INTERVAL_MS, settleMs = SETTLE_MS): boolean =>
  stillTicks * intervalMs >= settleMs

// stop/reset as before; pendingRegion: the area that changed since the last good read and is not read yet
// (or is being read right now), null when the boxes on screen are up to date. Used to hold a "this".
export type BoardLoop = { stop(): void; reset(): void; pendingRegion(): Box | null }

const FULL: Box = { x: 0, y: 0, w: 1, h: 1 }

export function startBoardLoop(video: HTMLVideoElement, tips: TipBuffer, onTerms: (terms: Term[]) => void): BoardLoop {
  const canvas = document.createElement('canvas')
  let lastRead: Uint8Array | null = null
  let inFlight = false
  let stopped = false
  let emptyReads = 0
  let generation = 0 // bumped by reset: a read started before it is ignored
  let current: Term[] = [] // what was last handed to onTerms
  let lastSeen: Uint8Array | null = null // previous check's frame
  let stillTicks = 0 // checks in a row with no change
  let reading: Box | null = null // changed area of the read in flight
  // Every box gets its own phrase: the whisper player drops a phrase that is already sounding.
  const show = (terms: Term[]) => { current = uniquePhrases(terms); onTerms(current) }

  const tick = () => {
    if (inFlight || video.readyState < 2 || !video.videoWidth) return
    const { videoWidth: w, videoHeight: h } = video
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(video, 0, 0, w, h)
    // A laser dot is light, not ink: hide it, or it would count as a change that is never read (and a
    // "this" said at an empty spot would be held instead of going silent).
    const now = performance.now()
    const lasers = tips.window(now - LASER_MASK_MS, now).filter(p => kindOf(p) === 'laser')
    const gray = hideCells(toGraySmall(ctx.getImageData(0, 0, w, h).data, w, h), lastSeen, lasers)
    // Settle: count checks the picture has stayed still, so a read never starts mid-stroke or on a moving camera.
    stillTicks = lastSeen !== null && !frameChanged(lastSeen, gray) ? stillTicks + 1 : 0
    lastSeen = gray
    if (!isSettled(stillTicks)) return
    const changed = lastRead === null || frameChanged(lastRead, gray)
    if (!shouldReadBoard(now, tips.lastCoverAt(), changed)) return
    inFlight = true
    reading = (lastRead && changedRegion(lastRead, gray)) || FULL
    const gen = generation
    const before = current
    const received: Term[] = []
    const live = () => !stopped && gen === generation
    canvas.toBlob(async blob => {
      try {
        if (!blob) throw new Error('toBlob returned null')
        const terms = await readBoard(blob, term => {
          if (!live()) return
          received.push(term)
          show(mergeTerms(before, received, { dropMissing: false })) // draw each box as soon as it is read
        })
        if (!live()) return
        emptyReads = terms.length ? 0 : emptyReads + 1
        if (emptyReads > 0 && emptyReads < EMPTY_READS_TO_CLEAR) return // lastRead untouched, so the next tick re-reads to confirm
        lastRead = gray
        show(mergeTerms(before, terms, { dropMissing: true })) // same term, same box: no re-drawn boxes on a wobble
      } catch (e) {
        if (!live()) return
        console.warn('board read failed, keeping last terms:', (e as Error).message)
        if (received.length) show(before) // undo the half-drawn read
      } finally {
        inFlight = false
        reading = null
      }
    }, 'image/jpeg', 0.85)
  }

  const id = setInterval(tick, BOARD_INTERVAL_MS)
  return {
    stop: () => { stopped = true; clearInterval(id) },
    // Reset button: clear the boxes now and forget the last frame, so the next tick reads the board from scratch.
    reset: () => { generation++; lastRead = null; emptyReads = 0; show([]) },
    pendingRegion: () => reading ?? (lastSeen === null ? null : lastRead === null ? FULL : changedRegion(lastRead, lastSeen)),
  }
}

import type { Box, Term } from '../core/types'
import type { TipBuffer } from '../core/tipBuffer'
import { EMPTY_READS_TO_CLEAR, HAND_RECENT_MS, IDLE_REREAD_MS, LASER_MASK_MS } from '../core/config'
import { changedRegion, frameChanged, hideCells, toGraySmall } from '../core/frameDiff'
import { kindOf } from '../vision/pointer'
import { readBoard, termsFromSquare } from './boardClient'
import { mergeTerms } from '../core/mergeTerms'
import { uniquePhrases } from '../core/phrase'
import { GROUP } from '../core/scope'

// Strict >: a hand seen exactly HAND_RECENT_MS ago still counts as recent. Only a hand counts:
// a laser dot covers nothing, and a stick covers too little to be worth the risk of a false detection.
export function shouldReadBoard(now: number, lastTipAt: number | null, changed: boolean): boolean {
  return changed && (lastTipAt === null || now - lastTipAt > HAND_RECENT_MS)
}

export const BOARD_TICK_MS = 500 // how often the board is checked (cheap 64x36 diff; a read only starts when it changed)
export const READ_SETTLE_MS = 600 // a changed picture must stay still this long before it is read
const MAX_SIDE = 1024 // the photo sent is scaled to this long side: boxes are normalised, so nothing else changes

// Smaller photo, faster read. Never enlarges.
export function scaleToMax(w: number, h: number, max: number): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h))
  return { w: Math.round(w * k), h: Math.round(h * k) }
}

// Counted in checks (not wall time) so it is exact under any clock: still for at least SETTLE_MS.
export const isSettled = (stillTicks: number, intervalMs = BOARD_TICK_MS, settleMs = READ_SETTLE_MS): boolean =>
  stillTicks * intervalMs >= settleMs

// stop/reset as before; pendingRegion: the area that changed since the last good read and is not read yet
// (or is being read right now), null when the boxes on screen are up to date (and always while locked: no
// read will come, so a "this" must not wait). lock: freeze the boxes as they are; reset unlocks.
// reading: a read is in flight.
export type BoardLoop = { stop(): void; reset(): void; pendingRegion(): Box | null; lock(on: boolean): void; locked(): boolean; reading(): boolean }

const inside = (b: Box, x: number, y: number) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
// New ink: a single term whose centre lies outside every single-term box already shown (a group's box
// does not hide small ink written inside it, like a minus sign or an exponent).
const foundNewInk = (shown: Term[], read: Term[]): boolean =>
  read.some(t => !GROUP.test(t.phrase) && !shown.some(o => !GROUP.test(o.phrase) && inside(o.box, t.box.x + t.box.w / 2, t.box.y + t.box.h / 2)))

const FULL: Box = { x: 0, y: 0, w: 1, h: 1 }

export function startBoardLoop(video: HTMLVideoElement, tips: TipBuffer, onTerms: (terms: Term[]) => void): BoardLoop {
  const canvas = document.createElement('canvas')
  const small = document.createElement('canvas') // what is sent
  let lockedOn = false
  let lastRead: Uint8Array | null = null
  let inFlight = false
  let stopped = false
  let emptyReads = 0
  let generation = 0 // bumped by reset: a read started before it is ignored
  let current: Term[] = [] // what was last handed to onTerms
  let lastSeen: Uint8Array | null = null // previous check's frame
  let stillTicks = 0 // checks in a row with no change
  let reading: Box | null = null // changed area of the read in flight
  let confirm = false // an empty read must be confirmed by a second read, whether or not the picture changes again
  let ticksSinceRead = 0 // counted in checks (exact under any clock), for the idle safety re-read
  // Every box gets its own phrase: the whisper player drops a phrase that is already sounding.
  const show = (terms: Term[]) => { current = uniquePhrases(terms); onTerms(current) }

  const tick = () => {
    if (lockedOn || inFlight || video.readyState < 2 || !video.videoWidth) return
    ticksSinceRead++
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
    const idle = ticksSinceRead * BOARD_TICK_MS >= IDLE_REREAD_MS // nothing read for a while: read anyway
    const changed = lastRead === null || confirm || idle || frameChanged(lastRead, gray)
    if (!shouldReadBoard(now, tips.lastCoverAt(), changed)) return
    // Started by the timer alone (nothing changed, not a confirmation): the reader's detail varies between
    // reads of the same board, so such a read is used only when it found new ink, and shows nothing while streaming.
    const idleOnly = idle && !confirm && lastRead !== null && !frameChanged(lastRead, gray)
    inFlight = true
    confirm = false
    ticksSinceRead = 0
    reading = (lastRead && changedRegion(lastRead, gray)) || FULL
    const gen = generation
    const before = current
    const received: Term[] = []
    const live = () => !stopped && gen === generation
    const to = scaleToMax(w, h, MAX_SIDE)
    // Square photo: the reader measures boxes right on a square, but squashes y on a wide photo.
    const side = Math.max(to.w, to.h)
    small.width = side
    small.height = side
    const sctx = small.getContext('2d')!
    sctx.fillStyle = '#000'
    sctx.fillRect(0, 0, side, side)
    sctx.drawImage(canvas, 0, 0, to.w, to.h)
    const fix = (terms: Term[]) => termsFromSquare(terms, to.w, to.h)
    small.toBlob(async blob => {
      try {
        if (!blob) throw new Error('toBlob returned null')
        const terms = fix(await readBoard(blob, term => {
          if (!live()) return
          received.push(...fix([term]))
          if (idleOnly) return
          show(mergeTerms(before, received, { dropMissing: false })) // draw each box as soon as it is read
        }))
        if (!live()) return
        emptyReads = terms.length ? 0 : emptyReads + 1
        if (emptyReads > 0 && emptyReads < EMPTY_READS_TO_CLEAR) { confirm = true; return } // re-read on the next settled check to confirm
        if (idleOnly && terms.length && !foundNewInk(before, terms)) return // keeps the old baseline: the ink it skipped can still count as a change
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
    }, 'image/jpeg', 0.8)
  }

  const id = setInterval(tick, BOARD_TICK_MS)
  return {
    stop: () => { stopped = true; clearInterval(id) },
    // Reset button: clear the boxes now and forget the last frame, so the next tick reads the board from scratch.
    reset: () => { generation++; lockedOn = false; lastRead = null; emptyReads = 0; confirm = false; show([]) },
    lock: on => { lockedOn = on; if (on) generation++ }, // a read in flight is dropped: the boxes must not change once locked
    locked: () => lockedOn,
    reading: () => inFlight && !lockedOn,
    pendingRegion: () => lockedOn ? null : reading ?? (lastSeen === null ? null : lastRead === null ? FULL : changedRegion(lastRead, lastSeen)),
  }
}

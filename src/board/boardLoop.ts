import type { Term } from '../core/types'
import type { TipBuffer } from '../core/tipBuffer'
import { BOARD_INTERVAL_MS, EMPTY_READS_TO_CLEAR, HAND_RECENT_MS } from '../core/config'
import { frameChanged, toGraySmall } from '../core/frameDiff'
import { readBoard } from './boardClient'

// Strict >: a hand seen exactly HAND_RECENT_MS ago still counts as recent.
export function shouldReadBoard(now: number, lastTipAt: number | null, changed: boolean): boolean {
  return changed && (lastTipAt === null || now - lastTipAt > HAND_RECENT_MS)
}

const overlaps = (a: Term['box'], b: Term['box']) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// While a read streams in: the previous board minus anything a new term covers, plus the new terms so far
// (ids moved above the old ones so the two sets never clash).
export function overlay(prev: Term[], received: Term[]): Term[] {
  const top = prev.reduce((m, t) => Math.max(m, t.id), 0)
  const kept = prev.filter(p => !received.some(r => overlaps(p.box, r.box)))
  return [...kept, ...received.map((t, i) => ({ ...t, id: top + i + 1 }))]
}

export type BoardLoop = { stop(): void; reset(): void }

export function startBoardLoop(video: HTMLVideoElement, tips: TipBuffer, onTerms: (terms: Term[]) => void): BoardLoop {
  const canvas = document.createElement('canvas')
  let lastRead: Uint8Array | null = null
  let inFlight = false
  let stopped = false
  let emptyReads = 0
  let generation = 0 // bumped by reset: a read started before it is ignored
  let current: Term[] = [] // what was last handed to onTerms
  const show = (terms: Term[]) => { current = terms; onTerms(terms) }

  const tick = () => {
    if (inFlight || video.readyState < 2 || !video.videoWidth) return
    const { videoWidth: w, videoHeight: h } = video
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(video, 0, 0, w, h)
    const gray = toGraySmall(ctx.getImageData(0, 0, w, h).data, w, h)
    const changed = lastRead === null || frameChanged(lastRead, gray)
    if (!shouldReadBoard(performance.now(), tips.lastAt(), changed)) return
    inFlight = true
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
          show(overlay(before, received)) // draw each box as soon as it is read
        })
        if (!live()) return
        emptyReads = terms.length ? 0 : emptyReads + 1
        if (emptyReads > 0 && emptyReads < EMPTY_READS_TO_CLEAR) return // lastRead untouched, so the next tick re-reads to confirm
        lastRead = gray
        show(terms)
      } catch (e) {
        if (!live()) return
        console.warn('board read failed, keeping last terms:', (e as Error).message)
        if (received.length) show(before) // undo the half-drawn read
      } finally {
        inFlight = false
      }
    }, 'image/jpeg', 0.85)
  }

  const id = setInterval(tick, BOARD_INTERVAL_MS)
  return {
    stop: () => { stopped = true; clearInterval(id) },
    // Reset button: clear the boxes now and forget the last frame, so the next tick reads the board from scratch.
    reset: () => { generation++; lastRead = null; emptyReads = 0; show([]) },
  }
}

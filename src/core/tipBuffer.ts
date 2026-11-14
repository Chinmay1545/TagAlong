import { TIP_BUFFER_MS } from './config'
import { coversBoard, kindOf, leading, leadingAt, type AnyPoint } from '../vision/pointer'

// Holds the last few seconds of pointer points from every source (finger, stick, laser, mouse).
// ponytail: plain array, linear scans. Fine at ~30 Hz per source over a 3 s window.
export class TipBuffer {
  private samples: AnyPoint[] = []

  constructor(private readonly keepMs = TIP_BUFFER_MS) {}

  push(s: AnyPoint): void {
    this.samples.push(s)
    const cutoff = s.t - this.keepMs
    let i = 0
    while (i < this.samples.length && this.samples[i].t < cutoff) i++
    if (i > 0) this.samples.splice(0, i)
  }

  // Every point in the window, whatever pointed.
  window(t0: number, t1: number): AnyPoint[] {
    return this.samples.filter((s) => s.t >= t0 && s.t <= t1)
  }

  // Only the points of the pointer that wins in the window (laser, then stick, then finger).
  lead(t0: number, t1: number): AnyPoint[] {
    return leading(this.window(t0, t1))
  }

  // For a word said at t: the points (within windowMs of t) of the pointer that was pointing at that moment.
  leadAt(t: number, windowMs: number): AnyPoint[] {
    return leadingAt(this.window(t - windowMs, t + windowMs), t)
  }

  all(): AnyPoint[] {
    return [...this.samples]
  }

  lastAt(): number | null {
    return this.samples.length ? this.samples[this.samples.length - 1].t : null
  }

  // Last time a hand was seen in front of the board. A stick, a laser or the mouse does not count.
  lastCoverAt(): number | null {
    for (let i = this.samples.length - 1; i >= 0; i--) if (coversBoard(kindOf(this.samples[i]))) return this.samples[i].t
    return null
  }
}

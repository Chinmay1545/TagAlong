import { TIP_BUFFER_MS } from './config'
import type { TipSample } from './types'

// ponytail: plain array, linear scans. Fine at ~30 Hz over a 3 s window.
export class TipBuffer {
  private samples: TipSample[] = []

  constructor(private readonly keepMs = TIP_BUFFER_MS) {}

  push(s: TipSample): void {
    this.samples.push(s)
    const cutoff = s.t - this.keepMs
    let i = 0
    while (i < this.samples.length && this.samples[i].t < cutoff) i++
    if (i > 0) this.samples.splice(0, i)
  }

  window(t0: number, t1: number): TipSample[] {
    return this.samples.filter((s) => s.t >= t0 && s.t <= t1)
  }

  all(): TipSample[] {
    return [...this.samples]
  }

  lastAt(): number | null {
    return this.samples.length ? this.samples[this.samples.length - 1].t : null
  }
}

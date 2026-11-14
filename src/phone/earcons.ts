// Short tones for connection events only (joined, dropped, back, class started). Never played for a whisper.
export type EarconKind = 'join' | 'start' | 'drop' | 'back'

const NOTES: Record<EarconKind, number[]> = {
  join: [660, 880],
  start: [523, 659, 784],
  drop: [330, 247],
  back: [440, 660],
}
const LEN = 0.12
const GAP = 0.04

export function createEarcons(make?: () => AudioContext): { unlock(): void; play(kind: EarconKind): void } {
  let ctx: AudioContext | null = null
  return {
    unlock() {
      try {
        if (!ctx) ctx = make ? make() : typeof AudioContext !== 'undefined' ? new AudioContext() : null
        void ctx?.resume?.()
      } catch {
        ctx = null
      }
    },
    play(kind) {
      const c = ctx
      if (!c) return
      try {
        NOTES[kind].forEach((freq, i) => {
          const t = c.currentTime + i * (LEN + GAP)
          const osc = c.createOscillator()
          const gain = c.createGain()
          osc.type = 'sine'
          osc.frequency.value = freq
          gain.gain.setValueAtTime(0.08, t)
          gain.gain.linearRampToValueAtTime(0, t + LEN)
          osc.connect(gain)
          gain.connect(c.destination)
          osc.start(t)
          osc.stop(t + LEN)
        })
      } catch {
        // audio failure must never break the app
      }
    },
  }
}

import { WHISPER_GAP_MS, TTS_MAX_CHARS, MAX_QUEUE_WAIT_MS } from '../core/config'
import { speakMath } from '../core/speakMath'
import type { Resolution, Term } from '../core/types'

export class WhisperQueue {
  private free = 0
  constructor(private gapMs = WHISPER_GAP_MS) {}
  next(now: number): number { return Math.max(now, this.free) }
  reset() { this.free = 0 }
  schedule(now: number, durationMs: number): number {
    const start = Math.max(now, this.free)
    this.free = start + durationMs + this.gapMs
    return start
  }
}

type Opts = {
  fetchTts?: (text: string) => Promise<ArrayBuffer>
  ctx?: AudioContext
  speak?: (text: string) => void
  now?: () => number // shared app clock, default performance.now
  cancelSpeech?: () => void // stop the phone's own voice (default speechSynthesis.cancel)
  speaking?: () => boolean // is the phone's own voice talking (default speechSynthesis.speaking)
}

const defaultFetch = async (text: string) => {
  const r = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!r.ok) throw new Error(`tts ${r.status}`)
  return r.arrayBuffer()
}

const defaultSpeak = (text: string) => {
  const u = new SpeechSynthesisUtterance(speakMath(text))
  const v = speechSynthesis.getVoices?.().find(v => v.lang === 'en-US' && /Samantha|Google US English|Natural/.test(v.name))
  if (v) u.voice = v
  u.rate = 1.1
  speechSynthesis.speak(u)
}

type Active = { key: string; src: AudioBufferSourceNode; gain: GainNode; startMs: number; endMs: number; soft: boolean }
const FADE_S = 0.03
const FLUSH_LEAD_MS = 80

export function createWhisperPlayer(opts: Opts = {}) {
  const fetchTts = opts.fetchTts ?? defaultFetch
  const speak = opts.speak ?? defaultSpeak
  const nowPerf = opts.now ?? (() => performance.now())
  const speaking = opts.speaking ?? (() => typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking)
  const cancelSpeech = opts.cancelSpeech ?? (() => speechSynthesis.cancel())
  let softSpeech = false // the phone voice is (or was) saying a soft item
  let ctx = opts.ctx
  const getCtx = () => (ctx ??= new AudioContext())
  const bufs = new Map<string, AudioBuffer>() // missing = unprepared or failed -> speech fallback; failures are retried by prepare
  const pending = new Map<string, Promise<void>>()
  const queue = new WhisperQueue()
  let active: Active[] = []
  let on = true
  let silent = false // classroom mode: the whisper goes to the students' phones, this device stays quiet

  const clip = (p: string) => p.trim().slice(0, TTS_MAX_CHARS)
  const unlock = () => { const c = getCtx(); if (c.state === 'suspended') void c.resume() }

  return {
    async prepare(terms: Term[]) {
      await Promise.all(terms.map(t => {
        const key = clip(t.phrase)
        if (!key) return
        if (!bufs.has(key) && !pending.has(key)) {
          pending.set(key, fetchTts(key)
            .then(ab => getCtx().decodeAudioData(ab))
            .then(b => { bufs.set(key, b); pending.delete(key) }, () => { pending.delete(key) }))
        }
        return pending.get(key)
      }))
    },
    unlock,
    // When everything scheduled so far has finished sounding (performance.now clock); <= now means quiet.
    quietAt(): number {
      const now = nowPerf()
      if (speaking()) return now + FLUSH_LEAD_MS // the phone voice has no known end: ask again soon
      const c = ctx
      if (!c) return 0
      const nowMs = c.currentTime * 1000
      const outMs = (c.outputLatency ?? c.baseLatency ?? 0) * 1000
      return active.reduce((end, a) => Math.max(end, now + (a.endMs - nowMs) + outMs), 0)
    },
    // soft: background audio (the board overview) that any later non-soft whisper cuts off at once.
    play(r: Resolution, o: { soft?: boolean } = {}): { startedAt: number } | null {
      if (!on || r.terms.length === 0) return null
      if (silent) return { startedAt: nowPerf() } // delivered (to the room), nothing sounds here
      if (!o.soft && softSpeech) { softSpeech = false; if (speaking()) cancelSpeech() } // a whisper cuts a spoken overview too
      let first: number | null = null
      let c: AudioContext | null = null
      for (const t of r.terms) {
        const key = clip(t.phrase)
        if (!key) continue
        const buf = bufs.get(key)
        if (!buf) { speak(key); softSpeech = !!o.soft; first ??= nowPerf(); continue }
        c ??= getCtx()
        const nowMs = c.currentTime * 1000
        const outMs = (c.outputLatency ?? c.baseLatency ?? 0) * 1000
        const toPerf = (ms: number) => nowPerf() + (ms - nowMs) + outMs
        if (c.state === 'suspended') void c.resume()
        active = active.filter(a => a.endMs > nowMs)
        const dup = active.find(a => a.key === key)
        if (dup) { first ??= Math.max(toPerf(dup.startMs), nowPerf()); continue } // already sounding: the student hears it from now
        let base = nowMs
        const cutsSoft = !o.soft && active.some(a => a.soft)
        if (first === null && (cutsSoft || queue.next(nowMs) - nowMs > MAX_QUEUE_WAIT_MS)) {
          // latest wins: fade out what is sounding, drop what has not started
          for (const a of active) {
            if (a.startMs <= nowMs) {
              a.gain.gain.setValueAtTime(1, c.currentTime)
              a.gain.gain.linearRampToValueAtTime(0, c.currentTime + FADE_S)
              a.src.stop(c.currentTime + FADE_S)
            } else a.src.stop()
          }
          active = []
          queue.reset()
          base = nowMs + FLUSH_LEAD_MS
        }
        const startMs = queue.schedule(base, buf.duration * 1000)
        const src = c.createBufferSource()
        src.buffer = buf
        const gain = c.createGain()
        const cx = t.box.x + t.box.w / 2
        src.connect(gain)
        if (c.createStereoPanner) {
          const pan = c.createStereoPanner()
          pan.pan.value = Math.max(-1, Math.min(1, cx * 2 - 1))
          gain.connect(pan).connect(c.destination)
        } else gain.connect(c.destination)
        src.start(startMs / 1000)
        active.push({ key, src, gain, startMs, endMs: startMs + buf.duration * 1000, soft: !!o.soft })
        first ??= toPerf(startMs)
      }
      return first === null ? null : { startedAt: first }
    },
    setEnabled(v: boolean) { on = v },
    setSilent(v: boolean) { silent = v },
    enabled: () => on,
  }
}

import type { Resolution } from '../core/types'

export type Msg =
  | { type: 'resolution'; word: string; phrase: string | null; latencyMs: number | null; muted: boolean }
  | { type: 'final'; said: string; meant: string }
  | { type: 'board'; phrases: string[] }
  | { type: 'mode'; withoutApp: boolean }
  | { type: 'hello' }

export type Channel = { postMessage(m: unknown): void; close(): void; onmessage: ((e: { data: unknown }) => void) | null }

const NAME = 'this-and-that'
const open = (): Channel | null => (typeof BroadcastChannel === 'undefined' ? null : (new BroadcastChannel(NAME) as Channel))

export const resolutionMsg = (r: Resolution, latencyMs: number | null, withoutApp: boolean): Msg => ({
  type: 'resolution',
  word: r.word.word,
  phrase: r.terms.length ? r.terms.map(t => t.phrase).join(' and ') : null,
  latencyMs,
  muted: withoutApp && r.terms.length > 0,
})
export const finalMsg = (said: string, meant: string): Msg => ({ type: 'final', said, meant })
export const boardMsg = (r: Resolution): Msg => ({ type: 'board', phrases: r.terms.map(t => t.phrase) })
export const modeMsg = (withoutApp: boolean): Msg => ({ type: 'mode', withoutApp })

export const helloMsg = (): Msg => ({ type: 'hello' })

export function createBroadcaster(channel: Channel | null = open()) {
  return { send: (m: Msg) => channel?.postMessage(m), close: () => channel?.close() }
}

export function subscribe(onMsg: (m: Msg) => void, channel: Channel | null = open()): () => void {
  if (channel) channel.onmessage = e => onMsg(e.data as Msg)
  return () => channel?.close()
}

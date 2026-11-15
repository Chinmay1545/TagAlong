import type { Resolution } from '../core/types'
import { topLevel } from './overview'

export type Msg =
  | { type: 'resolution'; word: string; phrase: string | null; latencyMs: number | null; muted: boolean }
  | { type: 'final'; said: string; meant: string }
  | { type: 'board'; phrases: string[] }
  | { type: 'mode'; withoutApp: boolean }
  | { type: 'hello' }
  // student -> judge: "I didn't understand this" and "what is happening right now?"
  | { type: 'bookmark' }
  | { type: 'ask' }
  // judge -> student: bookmark confirmed, the answer to "ask", and an alert worth hearing (class ending)
  | { type: 'marked'; count: number }
  | { type: 'assist'; text: string }
  | { type: 'notice'; text: string }

export type Channel = { postMessage(m: unknown): void; close(): void; onmessage: ((e: { data: unknown }) => void) | null }

const NAME = 'tagalong'
const open = (): Channel | null => (typeof BroadcastChannel === 'undefined' ? null : (new BroadcastChannel(NAME) as Channel))

export const resolutionMsg = (r: Resolution, latencyMs: number | null, withoutApp: boolean): Msg => ({
  type: 'resolution',
  word: r.word.word,
  phrase: r.terms.length ? r.terms.map(t => t.phrase).join(' and ') : null,
  latencyMs,
  muted: withoutApp && r.terms.length > 0,
})
export const finalMsg = (said: string, meant: string): Msg => ({ type: 'final', said, meant })
export const boardMsg = (r: Resolution): Msg => ({ type: 'board', phrases: topLevel(r.terms).map(t => t.phrase) })
export const modeMsg = (withoutApp: boolean): Msg => ({ type: 'mode', withoutApp })

export const helloMsg = (): Msg => ({ type: 'hello' })
export const bookmarkMsg = (): Msg => ({ type: 'bookmark' })
export const askMsg = (): Msg => ({ type: 'ask' })
export const markedMsg = (count: number): Msg => ({ type: 'marked', count })
export const assistMsg = (text: string): Msg => ({ type: 'assist', text })
export const noticeMsg = (text: string): Msg => ({ type: 'notice', text })

export function createBroadcaster(channel: Channel | null = open()) {
  return { send: (m: Msg) => channel?.postMessage(m), close: () => channel?.close() }
}

export function subscribe(onMsg: (m: Msg) => void, channel: Channel | null = open()): () => void {
  if (channel) channel.onmessage = e => onMsg(e.data as Msg)
  return () => channel?.close()
}

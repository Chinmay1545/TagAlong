import type { Resolution } from '../core/types'

// Classroom relay: ONE camera device publishes into a room (one per course, e.g. "math201"), the server
// fans out to every student phone in that room. One way only: students listen, nothing flows back.
// Shared by the browser (camera + student pages) and the server (which validates every camera message).

export const MAX_ROOM_LEN = 40
export const MAX_PHRASE = 200 // same cap as TTS_MAX_CHARS: a phrase the student fetches audio for
export const MAX_WORD = 20
export const MAX_ITEMS = 8
export const MAX_BOARD_PHRASES = 80
export const MAX_NOTICE = 300

export type WhisperItem = { phrase: string; x: number } // x: horizontal centre 0..1, for left/right panning
export type CameraMsg =
  | { type: 'whisper'; word: string; items: WhisperItem[] }
  | { type: 'board'; phrases: string[]; overview?: string[] } // reading order; the latest one is kept for students who join late. overview: the top-level items only (old cameras omit it)
  | { type: 'notice'; text: string } // an alert worth hearing ("class is ending")
  | { type: 'status'; open: boolean } // class opened / closed by the camera device
export type ServerToStudent =
  | Extract<CameraMsg, { type: 'whisper' | 'board' | 'notice' }>
  | { type: 'status'; live: boolean } // live = a camera is connected and the class is open
export type ServerToCamera = { type: 'listeners'; count: number }

export const isRoomName = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && s.length <= MAX_ROOM_LEN && /^[a-z0-9-]+$/.test(s)

const str = (v: unknown, max: number, min = 1): v is string => typeof v === 'string' && v.length >= min && v.length <= max

// Validates and rebuilds a camera message (unknown fields are dropped, so nothing extra reaches students).
export function parseCameraMsg(raw: string): CameraMsg | null {
  let m: unknown
  try { m = JSON.parse(raw) } catch { return null }
  if (!m || typeof m !== 'object') return null
  const o = m as Record<string, unknown>
  switch (o.type) {
    case 'whisper': {
      if (!str(o.word, MAX_WORD) || !Array.isArray(o.items) || o.items.length < 1 || o.items.length > MAX_ITEMS) return null
      const items: WhisperItem[] = []
      for (const it of o.items as Record<string, unknown>[]) {
        if (!it || !str(it.phrase, MAX_PHRASE) || typeof it.x !== 'number' || !(it.x >= 0 && it.x <= 1)) return null
        items.push({ phrase: it.phrase, x: it.x })
      }
      return { type: 'whisper', word: o.word, items }
    }
    case 'board': {
      const list = (v: unknown) => Array.isArray(v) && v.length <= MAX_BOARD_PHRASES && v.every(p => str(p, MAX_PHRASE))
      if (!list(o.phrases) || (o.overview !== undefined && !list(o.overview))) return null
      const phrases = [...(o.phrases as string[])]
      return o.overview === undefined ? { type: 'board', phrases } : { type: 'board', phrases, overview: [...(o.overview as string[])] }
    }
    case 'notice':
      return str(o.text, MAX_NOTICE) ? { type: 'notice', text: o.text } : null
    case 'status':
      return typeof o.open === 'boolean' ? { type: 'status', open: o.open } : null
    default:
      return null
  }
}

// Clip the same way the server and TTS do (trim, then MAX_PHRASE), so one long equation cannot get a whole message dropped.
export const clipPhrase = (p: string) => p.trim().slice(0, MAX_PHRASE)

export function whisperFromResolution(r: Resolution): CameraMsg | null {
  if (!r.terms.length) return null
  return { type: 'whisper', word: r.word.word, items: r.terms.slice(0, MAX_ITEMS).map(t => ({ phrase: clipPhrase(t.phrase), x: t.box.x + t.box.w / 2 })) }
}

export const studentLinkPath = (room: string, token: string) => `/?student&room=${room}&t=${token}`

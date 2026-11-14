import { useEffect, useRef, useState } from 'react'
import type { Resolution, Term, WordEvent } from '../core/types'
import { createWhisperPlayer } from '../audio/whisper'
import { keepScreenAwake } from '../vision/wakeLock'
import { connectRoom, roomSocketUrl, type RoomState } from '../live/roomClient'
import type { ServerToStudent, WhisperItem } from '../live/roomProtocol'
import './student.css'

// A blind student's own phone in a classroom: opened from the saved course link (?student&room=..&t=..).
// One tap to start (phones block sound until a tap), then it only listens: whispers are voiced on this
// phone (server voice, cached per phrase; the phone's own voice if that fails), panned left/right by where
// the term is on the board. Status goes to the screen reader. Nothing is sent back to the teacher.

// The server voice for this room: the room token stands in for the access key, and only phrases the
// camera published in this room are voiced.
export const roomTts = (room: string, token: string) => async (text: string): Promise<ArrayBuffer> => {
  const r = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-room': room, 'x-room-token': token },
    body: JSON.stringify({ text }),
  })
  if (!r.ok) throw new Error(`tts ${r.status}`)
  return r.arrayBuffer()
}

type Player = Pick<ReturnType<typeof createWhisperPlayer>, 'unlock' | 'play' | 'prepare'>
type Deps = {
  connect: (url: string, on: { onMessage(m: unknown): void; onState?(s: RoomState): void }) => { close(): void }
  player: Player
  keepAwake: () => () => void
  location: { protocol: string; host: string }
}

// Terms rebuilt from relayed phrases: only the phrase and the horizontal centre (for panning) matter here.
const asTerms = (items: WhisperItem[]): Term[] => items.map((it, i) => ({ id: i + 1, latex: '', phrase: it.phrase, box: { x: it.x, y: 0, w: 0, h: 0 } }))
const asResolution = (word: string, items: WhisperItem[]): Resolution => ({ word: { word, t: performance.now() } as WordEvent, terms: asTerms(items) })

export function RoomStudentView({ room, token, deps }: { room: string; token: string; deps?: Partial<Deps> }) {
  const d = useRef<Deps | null>(null)
  if (!d.current) d.current = {
    connect: deps?.connect ?? ((url, on) => connectRoom(url, on)),
    player: deps?.player ?? createWhisperPlayer({ fetchTts: roomTts(room, token) }),
    keepAwake: deps?.keepAwake ?? keepScreenAwake,
    location: deps?.location ?? window.location,
  }
  const [started, setStarted] = useState(false)
  const [phrase, setPhrase] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [said, setSaidRaw] = useState('')
  // A live region only speaks when its text changes, so a repeat gets an invisible zero-width space toggled on.
  const setSaid = (t: string) => setSaidRaw(prev => (prev === t ? t + '​' : t))
  const board = useRef<string[]>([])
  const last = useRef<Resolution | null>(null)
  const wasOpen = useRef(false)
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])

  const start = () => {
    const { player, connect, keepAwake, location } = d.current!
    player.unlock()
    const release = keepAwake()
    setStarted(true)
    setSaid(`Joining ${room}.`)
    const conn = connect(roomSocketUrl(location, { role: 'student', room, token }), {
      onMessage: raw => {
        const m = raw as ServerToStudent
        if (m.type === 'status') { setLive(m.live); setSaid(m.live ? `Connected to ${room}.` : `Waiting for ${room} to start.`) }
        else if (m.type === 'board') { board.current = m.phrases; void player.prepare(asTerms(m.phrases.map(p => ({ phrase: p, x: 0.5 })))) }
        else if (m.type === 'whisper') {
          const r = asResolution(m.word, m.items)
          last.current = r
          player.play(r)
          setPhrase(m.items.map(i => i.phrase).join(' and '))
        } else if (m.type === 'notice') setSaid(m.text)
      },
      onState: s => {
        if (s === 'reconnecting') { setSaid('Reconnecting…'); setLive(false) }
        else if (s === 'open') { if (wasOpen.current) setSaid('Back.'); wasOpen.current = true }
      },
    })
    stop.current = () => { conn.close(); release() }
  }

  const repeat = () => {
    if (last.current) d.current!.player.play({ ...last.current, word: { ...last.current.word, t: performance.now() } })
    else setSaid('Nothing to repeat yet.')
  }
  const readBoard = () => {
    if (!board.current.length) { setSaid('The board is empty.'); return }
    d.current!.player.play(asResolution('board', board.current.map(p => ({ phrase: p, x: 0.5 }))))
  }

  if (!started) {
    return (
      <main className="student room-start">
        <button type="button" className="room-start-btn" onClick={start}>Start listening to {room}</button>
      </main>
    )
  }
  return (
    <main className="student">
      <header className="s-head mono">
        <span><span className="dot" aria-hidden="true" />{room}</span>
        <span>{live ? 'live' : 'waiting'}</span>
      </header>
      <section className="s-stage">
        {phrase ? <p className="s-phrase">{phrase}</p> : <p className="s-empty">{live ? 'Listening.' : `Waiting for ${room} to start.`}</p>}
        <p className="sr" aria-live="assertive" aria-atomic="true">{said}</p>
      </section>
      <section className="s-actions" aria-label="Listen">
        <button type="button" className="s-btn" onClick={repeat}>Repeat</button>
        <button type="button" className="s-btn" onClick={readBoard}>What's on the board?</button>
      </section>
    </main>
  )
}

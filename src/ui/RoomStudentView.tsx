import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Resolution, Term, WordEvent } from '../core/types'
import { createWhisperPlayer } from '../audio/whisper'
import { keepScreenAwake } from '../vision/wakeLock'
import { createEarcons } from '../phone/earcons'
import { unlockVoice } from '../phone/voice'
import { connectRoom, roomSocketUrl, type RoomState } from '../live/roomClient'
import type { ServerToStudent, WhisperItem } from '../live/roomProtocol'
import './student.css'
import '../phone/phone.css'

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
  earcons: ReturnType<typeof createEarcons>
  unlockVoice: () => void
  keepAwake: () => () => void
  location: { protocol: string; host: string }
  voiceWaitMs: number
}

// One voice per whisper, the server voice (ElevenLabs) first: a phrase whose audio is not ready yet waits up
// to this long for it. Only if it fails or is slower does the phone's own voice say it, and only once.
const VOICE_WAIT_MS = 1500

// Terms rebuilt from relayed phrases: only the phrase and the horizontal centre (for panning) matter here.
const asTerms = (items: WhisperItem[]): Term[] => items.map((it, i) => ({ id: i + 1, latex: '', phrase: it.phrase, box: { x: it.x, y: 0, w: 0, h: 0 } }))
const asResolution = (word: string, items: WhisperItem[]): Resolution => ({ word: { word, t: performance.now() } as WordEvent, terms: asTerms(items) })

// autoStart: the phone home already took the press (sound unlocked) and picked this class, so connect on
// mount. startedText is then what the screen reader hears first ("Math 201 started.").
export function RoomStudentView({ room, token, deps, autoStart, startedText, label }: { room: string; token: string; deps?: Partial<Deps>; autoStart?: boolean; startedText?: string; label?: string }) {
  const name = label ?? room
  const d = useRef<Deps | null>(null)
  if (!d.current) d.current = {
    connect: deps?.connect ?? ((url, on) => connectRoom(url, on)),
    player: deps?.player ?? createWhisperPlayer({ fetchTts: roomTts(room, token) }),
    earcons: deps?.earcons ?? createEarcons(),
    unlockVoice: deps?.unlockVoice ?? (() => unlockVoice()),
    keepAwake: deps?.keepAwake ?? keepScreenAwake,
    location: deps?.location ?? window.location,
    voiceWaitMs: deps?.voiceWaitMs ?? VOICE_WAIT_MS,
  }
  const [started, setStarted] = useState(false)
  // What the screen shows big: the last whisper (with the word that triggered it) or the board read out.
  const [shown, setShown] = useState<{ word: string; text: string; n: number } | null>(null)
  const [live, setLive] = useState(false)
  const [drop, setDrop] = useState(false)
  const [said, setSaidRaw] = useState('')
  // A live region only speaks when its text changes, so a repeat gets an invisible zero-width space toggled on.
  const setSaid = (t: string) => setSaidRaw(prev => (prev === t ? t + '​' : t))
  const board = useRef<string[]>([])
  const last = useRef<Resolution | null>(null)
  const wasOpen = useRef(false)
  // Connection tones: one for joining, one when a class we waited for starts. Never for whispers.
  const chimed = useRef(!!startedText) // the phone home already played the start tone
  const waited = useRef(false)
  const quiet = useRef(!!startedText) // the first live status must not talk over the started announcement
  const dropped = useRef(false) // the client reports 'reconnecting' on every retry: one drop tone per outage
  const stop = useRef<(() => void) | null>(null)
  // Whispers play strictly in order; each one first waits (bounded) for its server voice.
  const chain = useRef<Promise<void>>(Promise.resolve())
  const say = (r: Resolution) => {
    const { player, voiceWaitMs } = d.current!
    const ready = player.prepare(r.terms).catch(() => {})
    chain.current = chain.current
      .then(() => Promise.race([ready, new Promise<void>(res => setTimeout(res, voiceWaitMs))]))
      .then(() => { player.play({ ...r, word: { ...r.word, t: performance.now() } }) })
  }
  useEffect(() => () => stop.current?.(), [])
  useEffect(() => { if (autoStart) start() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    const { player, connect, keepAwake, location, earcons } = d.current!
    // With autoStart the phone home took the press and unlocked everything already.
    if (!autoStart) { player.unlock(); earcons.unlock(); d.current!.unlockVoice() }
    const release = keepAwake()
    setStarted(true)
    setSaid(startedText ?? `Joining ${name}.`)
    const conn = connect(roomSocketUrl(location, { role: 'student', room, token }), {
      onMessage: raw => {
        const m = raw as ServerToStudent
        if (m.type === 'status') {
          if (!m.live) waited.current = true
          else if (waited.current) { waited.current = false; chimed.current = true; earcons.play('start') }
          else if (!chimed.current) { chimed.current = true; earcons.play('join') }
          setLive(m.live)
          const skip = quiet.current && m.live
          quiet.current = false
          if (!skip) setSaid(m.live ? `Connected to ${name}.` : `Waiting for ${name} to start.`) }
        else if (m.type === 'board') { board.current = m.phrases; void player.prepare(asTerms(m.phrases.map(p => ({ phrase: p, x: 0.5 })))) }
        else if (m.type === 'whisper') {
          const r = asResolution(m.word, m.items)
          last.current = r
          say(r)
          setShown(p => ({ word: m.word, text: m.items.map(i => i.phrase).join(' and '), n: (p?.n ?? 0) + 1 }))
        } else if (m.type === 'notice') setSaid(m.text)
      },
      onState: s => {
        if (s === 'reconnecting') { setSaid('Reconnecting…'); setLive(false); setDrop(true); if (!dropped.current) earcons.play('drop'); dropped.current = true }
        else if (s === 'open') { setDrop(false); if (wasOpen.current) { setSaid('Back.'); earcons.play('back') } wasOpen.current = true; dropped.current = false }
      },
    })
    stop.current = () => { conn.close(); release() }
  }

  const repeat = () => {
    if (last.current) say(last.current)
    else setSaid('Nothing to repeat yet.')
  }
  const readBoard = () => {
    if (!board.current.length) { setSaid('The board is empty.'); return }
    say(asResolution('board', board.current.map(p => ({ phrase: p, x: 0.5 }))))
    setShown(p => ({ word: 'On the board', text: board.current.join(', '), n: (p?.n ?? 0) + 1 }))
  }

  if (!started) {
    return (
      <main className="rs rs-start">
        <div className="rs-decor" aria-hidden="true">
          <span className="rs-kicker"><span className="rs-dot" />THIS &amp; THAT</span>
          <span className="rs-orb" />
          <span className="rs-hint">Each term the teacher points at is whispered here.</span>
        </div>
        <button type="button" className="rs-start-btn" onClick={start}>Start listening <span className="rs-to">to {name}</span></button>
      </main>
    )
  }
  const state = drop ? 'drop' : live ? 'live' : 'wait'
  return (
    <main className="rs rs-live" data-state={state}>
      <header className="rs-head">
        <span className="rs-chip"><span className="rs-dot" aria-hidden="true" />{name}</span>
        <span className="rs-state">{live ? 'live' : 'waiting'}</span>
      </header>
      {drop && <div className="rs-banner" aria-hidden="true">Reconnecting</div>}
      <section className="rs-stage">
        {shown ? (
          <div className="rs-now" key={shown.n}>
            <span className="rs-word" aria-hidden="true">{shown.word}</span>
            {/* The real text stays one plain node for the screen reader; the per-word copy on top only animates. */}
            <p className="rs-phrase">{shown.text}<span className="rs-words" aria-hidden="true">{words(shown.text)}</span></p>
          </div>
        ) : <p className="rs-empty">{live ? 'Listening.' : `Waiting for ${name} to start.`}</p>}
        <p className="sr" aria-live="assertive" aria-atomic="true">{said}</p>
      </section>
      <section className="rs-actions" aria-label="Listen">
        <button type="button" className="rs-btn rs-repeat" onClick={repeat}>Repeat</button>
        <button type="button" className="rs-btn" onClick={readBoard}>What's on the board?</button>
      </section>
    </main>
  )
}

// One span per word (spaces kept between them, so textContent is the phrase), each rising in turn.
const words = (text: string) => text.split(' ').flatMap((w, i) => [i ? ' ' : null, <span key={i} style={{ '--i': i } as CSSProperties}>{w}</span>])

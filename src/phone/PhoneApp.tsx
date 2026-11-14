import { useEffect, useRef, useState } from 'react'
import { createRelay, relayUrl, type RelayStatus } from '../live/relay'
import { helloMsg, bookmarkMsg, unmarkMsg, askMsg } from '../live/broadcast'
import { keepScreenAwake } from '../vision/wakeLock'
import { UNDO_MARK_MS } from '../core/config'
import { loadClasses, saveClass, type SavedClass } from './classes'
import { pickRoom, waitingText } from './pick'
import { createVoice, type VoiceMode } from './voice'
import { createEarcons } from './earcons'
import './phone.css'

const VOICE_KEY = 'tagalong:voice'
const TIP_KEY = 'tagalong:tip'
const TIP = 'Tip: a three-finger triple-tap turns on Screen Curtain to save battery. Listening keeps running.'
const STOP_ARM_MS = 4000

type Deps = {
  connect?: typeof createRelay
  storage?: Storage
  synth?: Parameters<typeof createVoice>[1]
  earcons?: ReturnType<typeof createEarcons>
  awake?: () => () => void
}
type Phase = 'idle' | 'wait' | 'choose' | 'joined'

const marked = (n: number, removed?: boolean) =>
  `${removed ? 'Mark removed' : 'Marked'}. ${n} moment${n === 1 ? '' : 's'} to go over later.`

export function PhoneApp({ token, name, deps = {} }: { token: string; name: string; deps?: Deps }) {
  const store = deps.storage ?? localStorage
  const [mode, setMode] = useState<VoiceMode | null>(() => {
    const v = store.getItem(VOICE_KEY)
    return v === 'screenreader' || v === 'speak' ? v : null
  })
  const [running, setRunning] = useState(false)
  const [said, setSaid] = useState('')
  const [big, setBig] = useState('')
  const [meant, setMeant] = useState('')
  const [rtt, setRtt] = useState<number | null>(null)
  const [choices, setChoices] = useState<SavedClass[] | null>(null)
  const [undo, setUndo] = useState(false)
  const [armed, setArmed] = useState(false)

  const r = useRef({
    relay: null as ReturnType<typeof createRelay> | null,
    release: null as (() => void) | null,
    voice: null as ReturnType<typeof createVoice> | null,
    earcons: deps.earcons ?? null,
    saved: [] as SavedClass[],
    names: {} as Record<string, string>,
    phase: 'idle' as Phase,
    joined: null as string | null,
    sent: false, // join sent on the current socket
    waited: false,
    dropped: false,
    mode: mode,
    last: '',
    undoT: undefined as ReturnType<typeof setTimeout> | undefined,
    armT: undefined as ReturnType<typeof setTimeout> | undefined,
  }).current
  const earcons = () => (r.earcons ??= createEarcons())

  useEffect(() => {
    r.saved = saveClass(store, { token, name })
    return () => {
      r.relay?.close()
      r.release?.()
      clearTimeout(r.undoT)
      clearTimeout(r.armT)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nameOf = (t: string) => r.names[t] ?? r.saved.find((c) => c.token === t)?.name ?? name
  // A live region only speaks when its text changes, so a repeat gets an invisible zero-width space toggled on.
  const announce = (text: string, remember = false) => {
    setSaid((prev) => (prev === text ? text + '​' : text))
    if (remember) r.last = text
    r.voice?.say(text)
  }
  const send = (m: object) => r.relay?.send(m)

  const join = (t: string, ended = '') => {
    send({ type: 'join', room: t })
    send(helloMsg())
    r.sent = true
    r.joined = t
    r.phase = 'joined'
    setChoices(null)
    const n = nameOf(t)
    if (r.waited) {
      r.waited = false
      earcons().play('start')
      announce(`${ended}${n} started.`)
      return
    }
    earcons().play('join')
    let text = `${ended}Connected to ${n}.`
    if (r.mode === 'screenreader') {
      try {
        if (!store.getItem(TIP_KEY)) {
          store.setItem(TIP_KEY, '1')
          text += ` ${TIP}`
        }
      } catch {
        // no storage: skip the tip
      }
    }
    announce(text)
  }

  const onRooms = (live: string[], names: Record<string, string>) => {
    r.names = { ...r.names, ...names }
    const saved = r.saved.map((c) => ({ ...c, name: r.names[c.token] ?? c.name }))
    let ended = ''
    if (r.joined && !live.includes(r.joined)) {
      r.joined = null
      r.phase = 'idle'
      ended = 'Class ended. '
    }
    if (r.joined) {
      if (!r.sent) { send({ type: 'join', room: r.joined }); send(helloMsg()); r.sent = true }
      return
    }
    const pick = pickRoom(live, saved, token)
    if (pick.kind === 'join') join(pick.token, ended)
    else if (pick.kind === 'choose') {
      if (r.phase !== 'choose') announce(`${ended}Choose a class.`)
      r.phase = 'choose'
      setChoices(pick.options)
    } else {
      setChoices(null)
      if (r.phase !== 'wait') announce(`${ended}${waitingText(saved)}`)
      r.phase = 'wait'
      r.waited = true
    }
  }

  const onMessage = (m: any) => {
    if (m.type === 'rooms') return onRooms(m.live ?? [], m.names ?? {})
    let text: string | null = null
    if (m.type === 'resolution') text = m.muted ? 'Without app: nothing whispered.' : m.phrase ?? 'nothing in reach'
    else if (m.type === 'board') text = (m.phrases ?? []).join(', ') || 'board is empty'
    else if (m.type === 'assist' || m.type === 'notice') text = m.text
    else if (m.type === 'marked') text = marked(m.count, m.removed)
    else if (m.type === 'final') setMeant(m.meant)
    if (text !== null) {
      setBig(text)
      announce(text, true)
    }
  }

  const onStatus = (s: RelayStatus) => {
    if (s === 'reconnecting') {
      r.dropped = true
      r.sent = false
      earcons().play('drop')
      announce('Reconnecting.')
    } else if (s === 'open' && r.dropped) {
      r.dropped = false
      earcons().play('back')
      announce('Back.')
    }
  }

  const start = (m: VoiceMode) => {
    if (r.relay) return
    r.dropped = false
    try { store.setItem(VOICE_KEY, m) } catch { /* no storage */ }
    r.mode = m
    r.voice = createVoice(m, deps.synth)
    earcons().unlock()
    r.voice.unlock()
    r.release = (deps.awake ?? keepScreenAwake)()
    r.phase = 'idle'
    r.joined = null
    r.sent = false
    r.waited = false
    r.relay = (deps.connect ?? createRelay)({
      url: relayUrl(location, { role: 'student', rooms: r.saved.map((c) => c.token).join(',') }),
      onMessage,
      onStatus,
      onRtt: setRtt,
    })
    setMode(m)
    setRunning(true)
  }

  const mark = () => {
    clearTimeout(r.undoT)
    if (undo) { send(unmarkMsg()); setUndo(false); return }
    send(bookmarkMsg())
    setUndo(true)
    r.undoT = setTimeout(() => setUndo(false), UNDO_MARK_MS)
  }

  const stop = () => {
    clearTimeout(r.armT)
    if (!armed) {
      setArmed(true)
      r.armT = setTimeout(() => setArmed(false), STOP_ARM_MS)
      return
    }
    r.relay?.close()
    r.relay = null
    r.release?.()
    r.release = null
    clearTimeout(r.undoT)
    r.voice?.cancel()
    r.phase = 'idle'
    r.joined = null
    setArmed(false)
    setUndo(false)
    setChoices(null)
    setBig('')
    setMeant('')
    setRunning(false)
    announce('Stopped.')
  }

  // Visual only: the chip and banner repeat what the live region already says, so they stay hidden from screen readers.
  const here = r.joined ? nameOf(r.joined) : name
  return (
    <main className={running ? 'phone live' : 'phone'}>
      <p className="sr" aria-live={mode === 'screenreader' ? 'assertive' : 'off'} aria-atomic="true">{said}</p>
      {!running && (mode ? (
        <button type="button" className="p-btn p-start" onClick={() => start(mode)}>
          <span className="p-orb" aria-hidden="true" />
          <span className="p-go">Start listening</span>{' '}<span className="sr">to</span>{' '}<span className="p-class">{name}</span>
        </button>
      ) : (
        <div className="p-choose">
          <div className="p-choice">
            <button type="button" className="p-btn" onClick={() => start('screenreader')}>I use VoiceOver or TalkBack</button>
            <span className="p-desc" aria-hidden="true">Your screen reader speaks each whisper.</span>
          </div>
          <div className="p-choice">
            <button type="button" className="p-btn" onClick={() => start('speak')}>Read whispers aloud for me</button>
            <span className="p-desc" aria-hidden="true">This phone says each whisper out loud.</span>
          </div>
        </div>
      ))}
      {running && (
        <>
          <div className={`p-chip${r.dropped ? ' off' : ''}`} aria-hidden="true"><span className="p-dot" />{here}</div>
          <div className="p-stage">
            {r.dropped && <div className="p-banner" aria-hidden="true">Reconnecting</div>}
            {choices?.map((c) => (
              <button key={c.token} type="button" className="p-btn p-join" onClick={() => join(c.token)}>{`Join ${r.names[c.token] ?? c.name}`}</button>
            ))}
            <p key={big} className="p-big" aria-hidden="true">{big}</p>
            {meant && <p className="p-meant">Meant: {meant}</p>}
          </div>
          <div className="p-controls">
            <button type="button" className="p-btn p-repeat" onClick={() => announce(r.last || 'Nothing to repeat yet.')}>Repeat last</button>
            <button type="button" className="p-btn" onClick={mark}>{undo ? 'Undo mark' : "Mark: I didn't get this"}</button>
            <button type="button" className="p-btn" onClick={() => { send(askMsg()); announce('Looking.') }}>What's happening?</button>
            <button type="button" className={`p-btn p-stop${armed ? ' armed' : ''}`} onClick={stop}>{armed ? 'Press again to stop' : 'Stop listening'}</button>
          </div>
          <p className="p-rtt">{rtt === null ? '' : `relay ${rtt} ms`}</p>
        </>
      )}
    </main>
  )
}

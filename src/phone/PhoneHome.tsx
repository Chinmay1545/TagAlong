import { useEffect, useRef, useState } from 'react'
import { createWhisperPlayer } from '../audio/whisper'
import { keepScreenAwake } from '../vision/wakeLock'
import { RoomStudentView, roomTts } from '../ui/RoomStudentView'
import { createEarcons } from './earcons'
import { unlockVoice } from './voice'
import { loadClasses, type SavedClass } from './classes'
import '../ui/student.css'

// The home-screen app (?classes). It only ever listens: it asks the server which saved classes are live
// (no sockets open until one is chosen), then hands the phone to that class's listening screen.

type RoomDeps = NonNullable<Parameters<typeof RoomStudentView>[0]['deps']>
type Deps = {
  storage: Pick<Storage, 'getItem'>
  fetch: typeof fetch
  pollMs: number
  player: NonNullable<RoomDeps['player']>
  earcons: NonNullable<RoomDeps['earcons']>
  unlockVoice: () => void
  keepAwake: () => () => void
  room: Omit<RoomDeps, 'player' | 'earcons' | 'unlockVoice'>
}

const POLL_MS = 5000
// A check that never answers counts as not live, so one hung request cannot stop the polling.
const CHECK_TIMEOUT_MS = 8000

const listText = (cs: SavedClass[]) => `Waiting. Your classes: ${cs.map(c => c.label).join(', ')}.`

export function PhoneHome({ deps }: { deps?: Partial<Deps> }) {
  const classes = useRef<SavedClass[] | null>(null)
  classes.current ??= loadClasses(deps?.storage ?? safeStorage())
  const all = classes.current
  // One player for every class, so the sound unlocked by the one press works whichever class is joined.
  const target = useRef<SavedClass | null>(null)
  const player = useRef(deps?.player ?? createWhisperPlayer({ fetchTts: text => roomTts(target.current!.room, target.current!.token)(text) }))
  const earcons = useRef(deps?.earcons ?? createEarcons())
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'choose' | 'joined'>('idle')
  const [live, setLive] = useState<SavedClass[]>([])
  const [joined, setJoined] = useState<SavedClass | null>(null)
  const [said, setSaid] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)
  const release = useRef<(() => void) | null>(null)
  const began = useRef(false)
  const firstJoin = useRef<HTMLButtonElement | null>(null)
  const letGo = () => { release.current?.(); release.current = null }
  useEffect(() => () => { alive.current = false; if (timer.current) clearTimeout(timer.current); letGo() }, [])
  useEffect(() => { if (phase === 'choose') firstJoin.current?.focus() }, [phase])

  const join = (c: SavedClass, announce: boolean) => {
    target.current = c
    letGo() // the class screen takes its own wake lock
    setJoined(c)
    setSaid(announce ? `${c.label} started.` : '')
    if (announce) earcons.current.play('start')
    setPhase('joined')
  }

  const check = async (first: boolean) => {
    const doFetch = deps?.fetch ?? fetch
    let rooms: string[] | null = null
    const ctl = new AbortController()
    let t: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<never>((_, rej) => { t = setTimeout(() => { ctl.abort(); rej(new Error('timeout')) }, CHECK_TIMEOUT_MS) })
    try {
      rooms = await Promise.race([
        doFetch('/api/room-status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rooms: all.map(c => ({ room: c.room, token: c.token })) }),
          signal: ctl.signal,
        }).then(async r => (r.ok ? ((await r.json()) as { live: string[] }).live : null)),
        timedOut,
      ])
    } catch { /* offline or too slow: keep waiting */ } finally { clearTimeout(t) }
    if (!alive.current) return
    const now = all.filter(c => rooms?.includes(c.room))
    if (now.length === 1) return join(now[0], true)
    if (now.length > 1) { setLive(now); setSaid('Choose a class.'); return setPhase('choose') }
    if (first) { setSaid(listText(all)); setPhase('waiting') }
    timer.current = setTimeout(() => void check(false), deps?.pollMs ?? POLL_MS)
  }

  const begin = () => {
    if (began.current) return
    began.current = true
    release.current = (deps?.keepAwake ?? keepScreenAwake)()
    player.current.unlock()
    earcons.current.unlock()
    ;(deps?.unlockVoice ?? unlockVoice)()
    void check(true)
  }

  if (all.length === 0) return <main className="student phone-home"><p className="s-empty">Open the class link from your disability office once.</p></main>
  if (all.length === 1) {
    return <RoomStudentView room={all[0].room} token={all[0].token} label={all[0].label} deps={{ ...deps?.room, ...(deps?.player && { player: deps.player }) }} />
  }
  // One live region for the whole flow: it stays mounted across the join so "started" is heard.
  return (
    <>
      <p className="sr" aria-live="assertive" aria-atomic="true">{said}</p>
      {phase === 'joined' && joined ? (
        <RoomStudentView room={joined.room} token={joined.token} label={joined.label} autoStart startedText={said || undefined} deps={{ ...deps?.room, player: player.current, earcons: earcons.current }} />
      ) : (
        <main className="student phone-home">
          {phase === 'idle' && <button type="button" className="room-start-btn phone-start-btn" onClick={begin}>Start listening</button>}
          {phase === 'waiting' && <p className="s-empty phone-waiting" aria-hidden="true">{said}</p>}
          {phase === 'choose' && (
            <>
              <h1 className="s-empty phone-choose-title">Choose a class.</h1>
              <section className="s-actions phone-choose" aria-label="Live classes">
                {live.map((c, i) => <button key={c.room} ref={i === 0 ? firstJoin : undefined} type="button" className="s-btn phone-join-btn" onClick={() => join(c, false)}>Join {c.label}</button>)}
              </section>
            </>
          )}
        </main>
      )}
    </>
  )
}

function safeStorage(): Pick<Storage, 'getItem'> {
  try { return window.localStorage } catch { return { getItem: () => null } }
}

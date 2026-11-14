import { useEffect, useRef, useState } from 'react'
import { createWhisperPlayer } from '../audio/whisper'
import { RoomStudentView, roomTts } from '../ui/RoomStudentView'
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
  room: Omit<RoomDeps, 'player'>
}

const POLL_MS = 5000

const listText = (cs: SavedClass[]) => `Waiting. Your classes: ${cs.map(c => c.label).join(', ')}.`

export function PhoneHome({ deps }: { deps?: Partial<Deps> }) {
  const classes = useRef<SavedClass[] | null>(null)
  classes.current ??= loadClasses(deps?.storage ?? safeStorage())
  const all = classes.current
  // One player for every class, so the sound unlocked by the one press works whichever class is joined.
  const target = useRef<SavedClass | null>(null)
  const player = useRef(deps?.player ?? createWhisperPlayer({ fetchTts: text => roomTts(target.current!.room, target.current!.token)(text) }))
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'choose' | 'joined'>('idle')
  const [live, setLive] = useState<SavedClass[]>([])
  const [joined, setJoined] = useState<SavedClass | null>(null)
  const [said, setSaid] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false; if (timer.current) clearTimeout(timer.current) }, [])

  const join = (c: SavedClass, announce: boolean) => {
    target.current = c
    setJoined(c)
    setSaid(announce ? `${c.label} started.` : '')
    setPhase('joined')
  }

  const check = async (first: boolean) => {
    const doFetch = deps?.fetch ?? fetch
    let rooms: string[] | null = null
    try {
      const r = await doFetch('/api/room-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rooms: all.map(c => ({ room: c.room, token: c.token })) }),
      })
      if (r.ok) rooms = ((await r.json()) as { live: string[] }).live
    } catch { /* offline: keep waiting */ }
    if (!alive.current) return
    const now = all.filter(c => rooms?.includes(c.room))
    if (now.length === 1) return join(now[0], true)
    if (now.length > 1) { setLive(now); setSaid('Choose a class.'); return setPhase('choose') }
    if (first) { setSaid(listText(all)); setPhase('waiting') }
    timer.current = setTimeout(() => void check(false), deps?.pollMs ?? POLL_MS)
  }

  const begin = () => {
    player.current.unlock()
    void check(true)
  }

  if (all.length === 0) return <main className="student phone-home"><p className="s-empty">Open the class link from your disability office once.</p></main>
  if (all.length === 1 && phase !== 'joined') {
    return <RoomStudentView room={all[0].room} token={all[0].token} deps={{ ...deps?.room, ...(deps?.player && { player: deps.player }) }} />
  }
  if (phase === 'joined' && joined) {
    return <RoomStudentView room={joined.room} token={joined.token} autoStart startedText={said || undefined} deps={{ ...deps?.room, player: player.current }} />
  }
  return (
    <main className="student phone-home">
      {phase === 'idle' && <button type="button" className="room-start-btn phone-start-btn" onClick={begin}>Start listening</button>}
      {phase === 'waiting' && <p className="s-empty phone-waiting">{said}</p>}
      {phase === 'choose' && (
        <section className="s-actions phone-choose" aria-label="Live classes">
          {live.map(c => <button key={c.room} type="button" className="s-btn phone-join-btn" onClick={() => join(c, false)}>Join {c.label}</button>)}
        </section>
      )}
      <p className="sr" aria-live="assertive" aria-atomic="true">{said}</p>
    </main>
  )
}

function safeStorage(): Pick<Storage, 'getItem'> {
  try { return window.localStorage } catch { return { getItem: () => null } }
}

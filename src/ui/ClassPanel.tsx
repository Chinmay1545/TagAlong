import { useEffect, useState } from 'react'
import { renderSVG } from 'uqr'
import type { Classroom } from '../live/classroom'
import type { RoomState } from '../live/roomClient'

// Camera device: open a class so student phones can listen. While the class is open this device stays
// quiet (the whispers go to the students' earbuds), and it shows the student link and how many are listening.
const STORE = 'tagalong-class'
const load = () => { try { return localStorage.getItem(STORE) ?? 'math201' } catch { return 'math201' } }
const save = (v: string) => { try { localStorage.setItem(STORE, v) } catch { /* private mode: not remembered */ } }

const STATE_TEXT: Record<RoomState, string> = { connecting: 'Connecting…', open: 'Live', reconnecting: 'Reconnecting…', closed: 'Closed' }

export function ClassPanel({ classroom, onLiveChange }: { classroom: Classroom; onLiveChange(live: boolean): void }) {
  const [name, setName] = useState(load)
  const [link, setLink] = useState<string | null>(null)
  const [state, setState] = useState<RoomState>('connecting')
  const [count, setCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const a = classroom.onListeners(setCount)
    const b = classroom.onState(setState)
    return () => { a(); b() }
  }, [classroom])

  const open = async () => {
    setError(null)
    try {
      const url = await classroom.open(name.trim())
      save(name.trim())
      setLink(url)
      setCount(0)
      onLiveChange(true)
    } catch (e) { setError((e as Error).message) }
  }
  const close = () => { classroom.close(); setLink(null); onLiveChange(false) }
  const copy = async () => {
    if (!link) return
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* the link is still shown */ }
  }

  return (
    <section className="class-panel mono" aria-label="Classroom">
      {link ? (
        <>
          <span className="class-state">{state === 'open' ? `Live · ${count} listening` : STATE_TEXT[state]}</span>
          <a href={link} target="_blank" rel="noreferrer">student link ({classroom.room()})</a>
          <div className="class-qr" role="img" aria-label={`QR code to join ${name.trim()}`} dangerouslySetInnerHTML={{ __html: renderSVG(link) }} />
          <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
          <button type="button" onClick={close}>Close class</button>
        </>
      ) : (
        <>
          <label>Class name <input value={name} onChange={e => setName(e.target.value)} size={10} spellCheck={false} /></label>
          <button type="button" onClick={open}>Open class</button>
          <span className="class-hint">students listen on their own phones</span>
        </>
      )}
      {error && <span role="alert" className="class-error">{error}</span>}
    </section>
  )
}

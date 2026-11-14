import { useEffect, useRef, useState } from 'react'
import { subscribe, createBroadcaster, helloMsg, bookmarkMsg, askMsg } from '../live/broadcast'
import './student.css'

type Cur = { id: number; word: string; phrase: string | null; muted: boolean }
const HISTORY = 5
const MEANT = 6

const marked = (n: number) => `Marked. ${n} moment${n === 1 ? '' : 's'} to go over later.`
const phraseOf = (c: Cur) => (c.muted ? 'Without app: nothing whispered.' : c.phrase ?? 'nothing in reach')

// Second screen: listens, plus two buttons (bookmark, what's happening). No camera, mic or audio in this tab.
export function StudentView() {
  const [cur, setCur] = useState<Cur | null>(null)
  const [hist, setHist] = useState<Cur[]>([])
  const [meant, setMeant] = useState<string[]>([])
  const [withoutApp, setWithoutApp] = useState(false)
  const [help, setHelp] = useState<string | null>(null) // the last answer or alert
  const [said, setSaidRaw] = useState('') // what the screen reader announces: one live region, newest first
  // A live region only speaks when its text changes, so a repeat gets an invisible zero-width space toggled on.
  const setSaid = (t: string) => setSaidRaw(prev => (prev === t ? t + '\u200b' : t))
  const bcRef = useRef<ReturnType<typeof createBroadcaster> | null>(null)

  useEffect(() => {
    let id = 0
    ;(window as unknown as { __tt: { student: boolean } }).__tt = { student: true }
    const off = subscribe(m => {
      if (m.type === 'mode') setWithoutApp(m.withoutApp)
      else if (m.type === 'final') setMeant(ms => [...ms, m.meant].slice(-MEANT))
      else if (m.type === 'marked') setSaid(marked(m.count))
      else if (m.type === 'assist' || m.type === 'notice') { setHelp(m.text); setSaid(m.text) }
      else if (m.type === 'resolution' || m.type === 'board') {
        const next: Cur = m.type === 'board'
          ? { id: ++id, word: 'board', phrase: m.phrases.join(', ') || 'board is empty', muted: false }
          : { id: ++id, word: m.word, phrase: m.phrase, muted: m.muted }
        setCur(prev => { if (prev) setHist(h => [prev, ...h].slice(0, HISTORY)); return next })
        setSaid(phraseOf(next))
      }
      // hello, bookmark and ask are for the judge tab
    })
    const bc = createBroadcaster()
    bcRef.current = bc
    bc.send(helloMsg()) // late open: ask the judge to re-send mode and board
    return () => { off(); bc.close(); delete (window as unknown as { __tt?: unknown }).__tt }
  }, [])

  return (
    <main className="student">
      <header className="s-head mono">
        <span><span className="dot" aria-hidden="true" />THIS &amp; THAT</span>
        <span>{withoutApp ? 'without app' : 'with app'}</span>
      </header>
      <section className="s-stage">
        {!cur ? <p className="s-empty">Waiting for the teacher to point.</p> : (
          <div className="s-now" key={cur.id}>
            <div className="s-word mono"><span className={cur.muted ? 'struck' : undefined}>{cur.word}</span></div>
            {cur.muted ? <p className="s-phrase s-muted">Without app: nothing whispered.</p>
              : <p className={`s-phrase${cur.phrase ? '' : ' s-quiet'}`}>{cur.phrase ?? 'nothing in reach'}</p>}
          </div>
        )}
        <p className="sr" aria-live="assertive" aria-atomic="true">{said}</p>
      </section>
      <section className="s-actions" aria-label="Ask">
        <button type="button" className="s-btn" onClick={() => bcRef.current?.send(bookmarkMsg())}>
          Mark: I didn't get this
        </button>
        <button type="button" className="s-btn" onClick={() => { setSaid('Looking.'); bcRef.current?.send(askMsg()) }}>
          What's happening?
        </button>
      </section>
      {help && <section className="s-help"><p>{help}</p></section>}
      {hist.length > 0 && (
        <ol className="s-hist" aria-label="Earlier">
          {hist.map((h, i) => (
            <li key={h.id} style={{ opacity: 0.7 - i * 0.13 }}>
              <span className="mono">{h.word}</span>
              <span className={h.muted ? 'struck' : undefined}>{h.phrase ?? 'nothing in reach'}</span>
            </li>
          ))}
        </ol>
      )}
      <footer className="s-meant">
        <h2 className="mono">Meant</h2>
        <p>{meant.length ? meant.join(' ') : 'The corrected transcript appears here.'}</p>
      </footer>
    </main>
  )
}

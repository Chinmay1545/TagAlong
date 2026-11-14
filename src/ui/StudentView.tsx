import { useEffect, useState } from 'react'
import { subscribe, createBroadcaster, helloMsg } from '../live/broadcast'
import './student.css'

type Cur = { id: number; word: string; phrase: string | null; muted: boolean }
const HISTORY = 5
const MEANT = 6

// Second screen: listens only; no camera, mic or audio in this tab.
export function StudentView() {
  const [cur, setCur] = useState<Cur | null>(null)
  const [hist, setHist] = useState<Cur[]>([])
  const [meant, setMeant] = useState<string[]>([])
  const [withoutApp, setWithoutApp] = useState(false)

  useEffect(() => {
    let id = 0
    ;(window as unknown as { __tt: { student: boolean } }).__tt = { student: true }
    const off = subscribe(m => {
      if (m.type === 'hello') return
      if (m.type === 'mode') setWithoutApp(m.withoutApp)
      else if (m.type === 'final') setMeant(ms => [...ms, m.meant].slice(-MEANT))
      else {
        const next: Cur = m.type === 'board'
          ? { id: ++id, word: 'board', phrase: m.phrases.join(', ') || 'board is empty', muted: false }
          : { id: ++id, word: m.word, phrase: m.phrase, muted: m.muted }
        setCur(prev => { if (prev) setHist(h => [prev, ...h].slice(0, HISTORY)); return next })
      }
    })
    const bc = createBroadcaster()
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
        <p className="sr" aria-live="assertive" aria-atomic="true">
          {cur ? (cur.muted ? 'Without app: nothing whispered.' : cur.phrase ?? 'nothing in reach') : ''}
        </p>
      </section>
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

import type { CSSProperties } from 'react'
import { parseLine, type Row, type Tally } from './judgeHelpers'

const idx = (i: number) => ({ '--i': i }) as CSSProperties

export function ModeSwitch({ withApp, onToggle }: { withApp: boolean; onToggle(): void }) {
  return (
    <button type="button" className={`mode${withApp ? '' : ' off'}`} aria-pressed={!withApp} aria-label="Without app" onClick={onToggle}>
      <span className="mode-thumb" aria-hidden="true" />
      <span className="mode-opt" data-on={withApp}>With app</span>
      <span className="mode-opt" data-on={!withApp}>Without app</span>
    </button>
  )
}

export type Last = { id: number; word: string; phrase: string; ms: number | null }

export function Readout({ last }: { last: Last | null }) {
  const silent = !last?.phrase
  return (
    <section className="readout" aria-label="Last pointer">
      <h2 className="label">Last pointer</h2>
      {!last ? <p className="readout-empty">Point and say “this”.</p> : <div className={`readout-in${last.ms === null ? ' quiet' : ''}`} key={last.id}>
        <div className="readout-main">
          <div className="readout-word">“{last.word}” <Arrow /></div>
          <div className="readout-phrase">{silent ? 'nothing in reach' : last.phrase}</div>
        </div>
        <div className="readout-lat">
          {last.ms === null
            ? <span className="readout-num dim">{silent ? 'silent' : 'muted'}</span>
            : <span className="readout-num">{(last.ms / 1000).toFixed(2)}<small>s</small></span>}
          <span className="readout-cap">{last.ms === null ? 'not whispered' : 'to whisper'}</span>
        </div>
      </div>}
    </section>
  )
}

const Arrow = () => (
  <svg className="arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

type Stat = [label: string, value: string, live?: boolean]

export function StatsStrip({ fps, boardAgo, terms, speech, listening, marks, medianMs }: {
  fps: number; boardAgo: string; terms: number; speech: string; listening: boolean; marks: Tally; medianMs: number | null
}) {
  const stats: Stat[] = [
    ['hand fps', String(fps)],
    ['board read', boardAgo],
    ['terms', String(terms)],
    ['speech', speech, listening],
    ['correct', `${marks.correct} of ${marks.total}`],
    ['median latency', medianMs === null ? '--' : `${(medianMs / 1000).toFixed(2)} s`],
  ]
  return (
    <dl className="stats">
      {stats.map(([label, value, live]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{live && <span className="breath" aria-hidden="true" />}{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function PointerLog({ rows }: { rows: Row[] }) {
  return (
    <section className="log" aria-label="Pointer log">
      <h2>Pointer log</h2>
      {rows.length === 0 ? (
        <p className="empty">No pointer events yet. Point at a term and press <kbd>P</kbd>.</p>
      ) : (
        <ul>{rows.map((r, i) => {
          const p = parseLine(r.line)
          return (
            <li key={r.id} className={`k-${p.kind}${r.mark === 'n' ? ' wrong' : ''}`} style={idx(Math.min(i, 4))}>
              <span className="log-text">
                <span className="log-word">{p.head}</span>
                <span className="log-arrow"> → </span>
                {p.body && <span className="log-phrase">{p.body}</span>}
                {p.body && p.tail && <span className="sr"> · </span>}
              </span>
              <span className="log-tags">
                {p.tail && <span className={`pill p-${p.kind}`}>{p.tail}</span>}
                {r.mark && <span className={`mark ${r.mark}`}>{r.mark === 'y' ? 'correct' : 'wrong'}</span>}
              </span>
            </li>
          )
        })}</ul>
      )}
    </section>
  )
}

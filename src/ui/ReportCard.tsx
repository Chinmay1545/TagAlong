import type { CSSProperties } from 'react'
import type { ReportCard as Card } from '../transcript/report'

const step = (i: number) => ({ '--i': i }) as CSSProperties

export function ReportCard({ card }: { card: Card }) {
  if (card.pointerWords === 0) return null
  const ms = card.medianLatencyMs
  return (
    <section className="report" aria-labelledby="report-h">
      <h2 id="report-h" className="label">Report card</h2>
      <dl className="report-nums">
        <div className="report-in" style={step(0)}><dt>Resolved</dt><dd>{card.resolvedPct}<small>%</small></dd></div>
        <div className="report-in" style={step(1)}><dt>Median</dt><dd>{ms === null ? '--' : (ms / 1000).toFixed(2)}<small>{ms === null ? '' : 's'}</small></dd></div>
        <div className="report-in" style={step(2)}><dt>Correct</dt><dd>{card.correct}<small>of {card.marked}</small></dd></div>
      </dl>
      {card.topTerms.length > 0 && (
        <ol className="report-terms">
          {card.topTerms.map((t, i) => <li key={t.phrase} className="report-in" style={step(3 + i)}><span>{t.phrase}</span><b className="mono">{t.count}</b></li>)}
        </ol>
      )}
      <ul className="report-tips">
        {card.tips.map((t, i) => <li key={t} className="report-in" style={step(6 + i)}>{t}</li>)}
      </ul>
    </section>
  )
}

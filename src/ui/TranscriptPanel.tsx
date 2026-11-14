import { substituteParts, type Segment } from '../transcript/store'

export function TranscriptPanel({ segs, open }: { segs: Segment[]; open: boolean }) {
  return (
    <details className="transcript" open={open}>
      <summary>Transcript</summary>
      {segs.length === 0 ? (
        <p className="empty">Say something while pointing. Final sentences appear here.</p>
      ) : (
        <div className="tr-rows">
          <div className="tr-head"><span>Said</span><span>Meant</span></div>
          {segs.map((s, i) => (
            <div className={`tr-row${s.bookmarked ? ' marked' : ''}`} key={i}>
              <span className="said">{s.bookmarked && <span className="tr-mark mono">Marked: student did not get this</span>}{s.text}</span>
              <span className="meant">{substituteParts(s.text, s.resolutions).map((p, j) => p.hit ? <mark key={j}>{p.text}</mark> : p.text)}</span>
            </div>
          ))}
        </div>
      )}
    </details>
  )
}

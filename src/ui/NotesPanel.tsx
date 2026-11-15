import { useEffect, useState } from 'react'
import type { Segment } from '../transcript/store'
import { reportText, type ReportCard } from '../transcript/report'
import { notesPayload, notesText, type Notes } from './judgeHelpers'

export function NotesPanel({ segs, report }: { segs: Segment[]; report?: ReportCard }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [notes, setNotes] = useState<Notes | null>(null)
  const [error, setError] = useState('')
  const [canShare, setCanShare] = useState(false)
  const [shareMsg, setShareMsg] = useState('')
  const [shareUrl, setShareUrl] = useState('')

  useEffect(() => {
    const ctl = new AbortController()
    fetch('/api/health', { signal: ctl.signal }).then((r) => r.json()).then((h: { share?: boolean }) => setCanShare(h.share === true)).catch(() => {})
    return () => ctl.abort()
  }, [])

  const make = async () => {
    setState('loading')
    try {
      const res = await fetch('/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(notesPayload(segs)) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(res.status === 503 ? 'Notes are not configured on this server.' : (body as { error?: string }).error ?? `Notes failed (${res.status}).`)
      setNotes(body as Notes)
      setState('done')
    } catch (e) {
      setError((e as Error).message)
      setState('error')
    }
  }

  const fullText = () => (notes ? notesText(segs, notes) + (report && report.pointerWords ? `\n${reportText(report)}\n` : '') : '')

  const share = async () => {
    setShareMsg('Making link...'); setShareUrl('')
    try {
      const res = await fetch('/api/share-notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: fullText() }) })
      const body = await res.json().catch(() => ({})) as { url?: string }
      if (!res.ok || !body.url) throw new Error()
      try {
        await navigator.clipboard.writeText(body.url)
        setShareMsg('Link copied. It works for 24 hours.')
      } catch {
        setShareUrl(body.url) // upload succeeded; let the user copy it by hand
        setShareMsg('Copy this link. It works for 24 hours.')
      }
    } catch { setShareMsg('Could not make a share link.') }
  }

  const download = () => {
    if (!notes) return
    const url = URL.createObjectURL(new Blob([fullText()], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'tagalong-notes.txt'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <div className="notes" role="status" aria-live="polite">
      <div className="controls notes-controls">
        <button type="button" disabled={state === 'loading' || segs.length === 0} onClick={make}>Make notes</button>
        {state === 'done' && <button type="button" onClick={download}>Download notes</button>}
        {state === 'done' && canShare && <button type="button" onClick={share}>Copy share link</button>}
        {shareMsg && <span>{shareMsg}</span>}
        {shareUrl && <input readOnly aria-label="Share link" value={shareUrl} onFocus={(e) => e.currentTarget.select()} />}
        {state === 'error' && <span className="inline-error" role="alert">{error}</span>}
      </div>
      {state === 'loading' && <div className="skeleton" aria-label="Making notes">{[92, 74, 86, 58].map(w => <i key={w} style={{ width: `${w}%` }} />)}</div>}
      {state === 'done' && notes && (
        <div className="notes-body">
          <h3>Rewrite</h3><ul>{notes.rewrite.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <h3>Summary</h3><ol>{notes.summary.map((x, i) => <li key={i}>{x}</li>)}</ol>
        </div>
      )}
    </div>
  )
}

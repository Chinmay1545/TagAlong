import { useEffect, useState } from 'react'

export type HealthLike = { ok: boolean; board: string; tts: boolean; notes: boolean; transcribe: string; share?: boolean; provider?: { board: string; notes: string } }

export function missingLines(h: HealthLike): string[] {
  const out: string[] = []
  if (h.board === 'missing') out.push('Board reader: not configured — using the saved demo board only.')
  if (!h.tts) out.push('Voice: no voice service configured — using the browser voice.')
  if (!h.notes) out.push('Notes: not configured.')
  if (h.transcribe === 'missing') out.push('Speech: browser recognition (Transcribe not configured).')
  return out
}

// Slim, dismissible, never blocks. Silent on fetch failure or when everything is configured.
export function Readiness() {
  const [lines, setLines] = useState<string[]>([])
  useEffect(() => {
    const ctl = new AbortController()
    fetch('/api/health', { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((h: HealthLike | null) => { if (h) setLines(missingLines(h)) })
      .catch(() => {})
    return () => ctl.abort()
  }, [])
  if (lines.length === 0) return null
  return (
    <aside className="readiness" role="status" aria-label="Setup status">
      <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
      <button type="button" onClick={() => setLines([])} aria-label="Dismiss setup status">Dismiss</button>
    </aside>
  )
}

import type { WordItem } from './words'

export function connectTranscribe(
  url: string,
  onItems: (items: WordItem[]) => void,
  onFinal: (text: string, t0: number, t1: number) => void,
  onError: (message: string) => void = () => {}, // e.g. SubscriptionRequiredException: caller falls back to Web Speech
): { send(pcm: Int16Array): void; close(): void; ready: Promise<void> } {
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  let opened = false
  let errored = false
  const ready = new Promise<void>((resolve, reject) => {
    ws.onopen = () => { opened = true; resolve() }
    ws.onerror = () => reject(new Error('transcribe socket failed'))
    ws.onclose = () => {
      reject(new Error('transcribe socket closed'))
      if (opened && !errored) onError('closed') // dropped mid-session: caller falls back
    }
  })
  ready.catch(() => {}) // callers that never await ready must not trigger unhandled rejections
  ws.onmessage = (e) => {
    let m: any
    try { m = JSON.parse(String(e.data)) } catch { return }
    if (m.type === 'items') onItems((m.items as WordItem[]).map((i) => ({ ...i, arrivedAt: performance.now() })))
    else if (m.type === 'final') onFinal(m.text, m.t0, m.t1)
    else if (m.type === 'error') { errored = true; onError(String(m.error)) }
  }
  return {
    ready,
    send: (pcm) => { if (ws.readyState === WebSocket.OPEN) ws.send(pcm as Int16Array<ArrayBuffer>) },
    close: () => ws.close(),
  }
}

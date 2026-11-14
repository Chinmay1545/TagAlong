import type http from 'node:http'
import { WebSocketServer } from 'ws'
import { StartStreamTranscriptionCommand, TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming'
import { PCM_RATE } from '../src/core/config'
import type { WordItem } from '../src/speech/words'

type Ev = { items: WordItem[]; final?: { text: string; t0: number; t1: number } }

export function transcriptEventToItems(ev: unknown, arrivedAt: number): Ev {
  const out: Ev = { items: [] }
  try {
    const results = (ev as any)?.TranscriptEvent?.Transcript?.Results
    if (!Array.isArray(results)) return out
    for (const r of results) {
      const alt = r?.Alternatives?.[0]
      if (!alt) continue
      const isPartial = r.IsPartial !== false
      for (const it of alt.Items ?? []) {
        if (it?.Type === 'punctuation' || typeof it?.Content !== 'string') continue
        out.items.push({ content: it.Content, startTime: it.StartTime, endTime: it.EndTime, isPartial, arrivedAt })
      }
      if (!isPartial && typeof alt.Transcript === 'string') out.final = { text: alt.Transcript, t0: r.StartTime ?? 0, t1: r.EndTime ?? 0 }
    }
  } catch { return { items: [] } }
  return out
}

export function startInput(audio: AsyncIterable<Uint8Array>, env: Record<string, string | undefined> = process.env) {
  return {
    LanguageCode: 'en-US' as const, MediaEncoding: 'pcm' as const, MediaSampleRateHertz: PCM_RATE,
    EnablePartialResultsStabilization: true,
    ...(env.TRANSCRIBE_VOCABULARY ? { VocabularyName: env.TRANSCRIBE_VOCABULARY } : {}),
    AudioStream: (async function* () { for await (const c of audio) yield { AudioEvent: { AudioChunk: c } } })(),
  }
}

// Credentials come only from the SDK default chain; nothing is logged.
export function transcribeStream(audio: AsyncIterable<Uint8Array>): AsyncIterable<unknown> {
  return (async function* () {
    const client = new TranscribeStreamingClient({ region: process.env.AWS_REGION })
    try {
      const res = await client.send(new StartStreamTranscriptionCommand(startInput(audio)))
      yield* res.TranscriptResultStream!
    } finally { client.destroy() }
  })()
}

const MAX_QUEUE_BYTES = 160000 // ~5 s (tolerates a slow Transcribe start-up) of 16 kHz 16-bit PCM; beyond this we error out (dropping audio would skew word timing)

export const originAllowed = (origin: string | undefined): boolean => {
  if (!origin) return true // non-browser clients send no Origin
  try { const h = new URL(origin).hostname; return h === 'localhost' || h === '127.0.0.1' } catch { return false }
}

export function attachTranscribe(server: http.Server, makeStream: (audio: AsyncIterable<Uint8Array>) => AsyncIterable<unknown> = transcribeStream): void {
  const wss = new WebSocketServer({ server, path: '/ws/transcribe', maxPayload: 64 * 1024, verifyClient: ({ origin, req }: { origin: string; req: { headers: { host?: string } } }) => originAllowed(origin) && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '') })
  wss.on('connection', (ws) => {
    let queue: Uint8Array[] = []
    let queued = 0
    let wake: (() => void) | undefined
    let ended = false
    const end = () => { ended = true; queue = []; queued = 0; wake?.() }
    ws.on('message', (d, isBinary) => {
      if (!isBinary || ended) return
      const c = d as Buffer
      queue.push(c); queued += c.length
      if (queued > MAX_QUEUE_BYTES) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', error: 'audio backlog' }))
        end(); ws.close()
        return
      }
      wake?.()
    })
    ws.on('close', end)
    ws.on('error', () => { end(); ws.terminate() })
    const audio = (async function* () {
      while (!ended || queue.length) {
        if (queue.length) { const c = queue.shift()!; queued -= c.length; yield c }
        else await new Promise<void>((r) => { wake = r })
      }
    })()
    ;(async () => {
      try {
        for await (const ev of makeStream(audio)) {
          if (ws.readyState !== ws.OPEN) break
          const { items, final } = transcriptEventToItems(ev, Date.now())
          if (items.length) ws.send(JSON.stringify({ type: 'items', items }))
          if (final) ws.send(JSON.stringify({ type: 'final', ...final }))
        }
      } catch (e) {
        // Short message only: raw AWS messages can contain account details.
        const name = (e as Error)?.name
        const error = name === 'SubscriptionRequiredException' ? 'transcribe not subscribed' : name || 'transcribe error'
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', error }))
      }
      end()
      ws.close()
    })()
  })
}

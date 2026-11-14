import express from 'express'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseBoardResponse } from './parseBoard'
import { createTermStream } from './boardStream'
import { anthropicStreamModelFromEnv, pickProvider } from './anthropic'
import { bedrockStreamModelFromEnv } from './bedrock'

export type CallModel = (jpeg: Buffer) => Promise<string>
export type StreamModel = (jpeg: Buffer) => AsyncIterable<string>

export const streamModelFromEnv = (env: Record<string, string | undefined>): StreamModel =>
  pickProvider(env) === 'anthropic' ? anthropicStreamModelFromEnv(env) : bedrockStreamModelFromEnv(env)

const wantsStream = (req: express.Request) => /application\/x-ndjson/i.test(req.get('accept') ?? '')

// NDJSON reply: {"type":"term","term":...} per term as soon as the model has written it, then
// {"type":"done","count","ms"}, or {"type":"error","error":"board read failed"} (detail stays server-side).
async function streamTerms(res: express.Response, chunks: () => AsyncIterable<string>, t0: number): Promise<void> {
  res.status(200).type('application/x-ndjson')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Accel-Buffering', 'no') // proxies must not hold lines back
  res.flushHeaders()
  const send = (o: unknown) => { if (!res.destroyed) res.write(JSON.stringify(o) + '\n') }
  const parser = createTermStream()
  let count = 0
  try {
    for await (const chunk of chunks()) {
      if (res.destroyed) break // client gave up (reset, page closed)
      for (const term of parser.push(chunk)) { count++; send({ type: 'term', term }) }
    }
    for (const term of parser.end()) { count++; send({ type: 'term', term }) }
    const ms = Math.round(performance.now() - t0)
    console.log(`read-board (stream): ${count} terms, ${ms} ms`)
    send({ type: 'done', count, ms })
  } catch (e) {
    console.error('read-board failed:', e instanceof Error ? e.message : String(e)) // detail stays server-side
    send({ type: 'error', error: 'board read failed' })
  }
  res.end()
}

// POST /api/read-board handler (body: raw image/jpeg). Streams NDJSON when the client accepts it;
// otherwise the one-shot JSON reply {terms, ms}. Without a stream model, streaming wraps the one-shot call.
export function readBoardHandler(callModel: CallModel, streamModel?: StreamModel): express.RequestHandler {
  return async (req, res) => {
    const jpeg = req.body
    if (!Buffer.isBuffer(jpeg) || jpeg.length === 0) {
      res.status(400).json({ error: 'empty or missing image/jpeg body' })
      return
    }
    const t0 = performance.now()
    const debugDir = process.env.BOARD_DEBUG_DIR // opt-in: keep each frame to see what the camera sent
    const stamp = Date.now()
    if (debugDir) writeFileSync(join(debugDir, `frame-${stamp}.jpg`), jpeg)
    if (wantsStream(req)) {
      await streamTerms(res, streamModel ? () => streamModel(jpeg) : async function* () { yield await callModel(jpeg) }, t0)
      return
    }
    try {
      const text = await callModel(jpeg)
      const terms = parseBoardResponse(text)
      const ms = Math.round(performance.now() - t0)
      console.log(`read-board: ${terms.length} terms, ${Math.round(jpeg.length / 1024)} KB, ${ms} ms${debugDir ? `, frame-${stamp}.jpg` : ''}`)
      if (debugDir) writeFileSync(join(debugDir, `frame-${stamp}.txt`), text)
      res.json({ terms, ms })
    } catch (e) {
      console.error('read-board failed:', e instanceof Error ? e.message : String(e)) // detail stays server-side
      res.status(502).json({ error: 'board read failed' })
    }
  }
}

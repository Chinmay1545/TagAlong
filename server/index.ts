import express from 'express'
import { pathToFileURL } from 'node:url'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseBoardResponse } from './parseBoard'
import { bedrockCallModelFromEnv, bedrockCallTextFromEnv } from './bedrock'
import { shareRouter, shareFromEnv, type Share } from './share'
import { ttsRouter, pollySynth, type Synth } from './tts'
import { attachTranscribe } from './transcribe'
import { anthropicCallModelFromEnv, anthropicCallTextFromEnv, pickProvider } from './anthropic'
import { notesRouter } from './notes'
import { healthFrom } from './health'

type CallModel = (jpeg: Buffer) => Promise<string>

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])
const version: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

export function createApp(callModel: CallModel, synth?: Synth, callText?: (prompt: string) => Promise<string>, opts?: { staticDir?: string; share?: Share }): express.Express {
  const app = express()
  app.use((req, res, next) => (LOCAL_HOSTS.has(req.hostname) ? next() : void res.status(403).json({ error: 'forbidden' }))) // blocks DNS rebinding
  app.get('/api/health', (_req, res) => void res.json(healthFrom(process.env, version)))
  app.post('/api/read-board', express.raw({ type: 'image/jpeg', limit: '5mb' }), async (req, res) => {
    const jpeg = req.body
    if (!Buffer.isBuffer(jpeg) || jpeg.length === 0) {
      res.status(400).json({ error: 'empty or missing image/jpeg body' })
      return
    }
    const t0 = performance.now()
    const debugDir = process.env.BOARD_DEBUG_DIR // opt-in: keep each frame to see what the camera sent
    const stamp = Date.now()
    if (debugDir) writeFileSync(join(debugDir, `frame-${stamp}.jpg`), jpeg)
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
  })
  app.use(synth ? ttsRouter(synth) : (_req, res, next) => (_req.path === '/api/tts' ? void res.status(503).json({ error: 'tts not configured' }) : next()))
  app.use(callText ? notesRouter(callText) : (req, res, next) => (req.path === '/api/notes' ? void res.status(503).json({ error: 'notes not configured' }) : next()))
  app.use(opts?.share ? shareRouter(opts.share) : (req, res, next) => (req.path === '/api/share-notes' ? void res.status(503).json({ error: 'sharing not configured' }) : next()))
  if (opts?.staticDir) {
    const dir = opts.staticDir
    app.use(express.static(dir))
    app.get(/^\/(?!api\/|ws\/).*/, (_req, res) => void res.sendFile(join(dir, 'index.html')))
  }
  app.use((_req, res) => void res.status(404).json({ error: 'not found' }))
  // Body-parser errors (e.g. 413) would otherwise render Express's HTML page with a stack trace and server paths.
  app.use((err: { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status ?? 500
    res.status(status).json({ error: status === 413 ? 'payload too large' : 'bad request' })
  })
  return app
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile() } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Could not read .env: ${(e as Error).message}`)
  }
  const provider = pickProvider(process.env)
  const callModel = provider === 'anthropic' ? anthropicCallModelFromEnv(process.env) : bedrockCallModelFromEnv(process.env)
  const server = createApp(callModel, pollySynth(), provider === 'anthropic' ? anthropicCallTextFromEnv(process.env) : process.env.AWS_REGION ? bedrockCallTextFromEnv(process.env) : undefined, { staticDir: existsSync('dist/index.html') ? join(process.cwd(), 'dist') : undefined, share: shareFromEnv(process.env) }).listen(8787, '127.0.0.1', () => {
    console.log(`listening on 8787 (board reader: ${provider}; BOARD_MODEL_ID set: ${process.env.BOARD_MODEL_ID ? 'yes' : 'no'})`)
  })
  attachTranscribe(server)
}

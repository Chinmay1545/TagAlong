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
import { COOKIE, LOCAL_ACCESS, accessFromEnv, hostAllowed, keyAllowed, keyMatches, type Access } from './access'

type CallModel = (jpeg: Buffer) => Promise<string>

const version: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const WEEK_S = 7 * 24 * 3600

export function createApp(callModel: CallModel, synth?: Synth, callText?: (prompt: string) => Promise<string>, opts?: { staticDir?: string; share?: Share; access?: Access }): express.Express {
  const app = express()
  const access = opts?.access ?? LOCAL_ACCESS
  app.use((req, res, next) => (hostAllowed(access, req.headers.host) ? next() : void res.status(403).json({ error: 'forbidden' }))) // blocks DNS rebinding
  // Hosted only: open the app once with ?key=..., which becomes a cookie the page, the API and the WebSocket all send.
  app.use((req, res, next) => {
    if (!access.key) return next()
    const given = req.query.key
    if (req.method === 'GET' && typeof given === 'string') {
      if (!keyMatches(given, access.key)) return void res.status(401).json({ error: 'wrong access key' })
      const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
      res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(given)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${WEEK_S}${secure ? '; Secure' : ''}`)
      const url = new URL(req.originalUrl, 'http://x')
      url.searchParams.delete('key') // keep the key out of history and screenshots
      return void res.redirect(302, url.pathname + url.search)
    }
    if (req.path.startsWith('/api/') && req.path !== '/api/health' && !keyAllowed(access, req.headers.cookie)) return void res.status(401).json({ error: 'access key required' })
    next()
  })
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
  const access = accessFromEnv(process.env) // throws if a public domain is set without ACCESS_KEY
  // Hosting platforms set PORT and need every interface; locally stay on loopback. HOST overrides.
  const port = Number(process.env.PORT) || 8787
  const host = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1')
  const provider = pickProvider(process.env)
  const callModel = provider === 'anthropic' ? anthropicCallModelFromEnv(process.env) : bedrockCallModelFromEnv(process.env)
  const server = createApp(callModel, pollySynth(), provider === 'anthropic' ? anthropicCallTextFromEnv(process.env) : process.env.AWS_REGION ? bedrockCallTextFromEnv(process.env) : undefined, { staticDir: existsSync('dist/index.html') ? join(process.cwd(), 'dist') : undefined, share: shareFromEnv(process.env), access }).listen(port, host, () => {
    console.log(`listening on ${host}:${port} (board reader: ${provider}; BOARD_MODEL_ID set: ${process.env.BOARD_MODEL_ID ? 'yes' : 'no'}; hosts: ${[...access.hosts].join(', ')}; access key: ${access.key ? 'required' : 'off'})`)
  })
  attachTranscribe(server, undefined, access)
}

import express from 'express'
import { pathToFileURL } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readBoardHandler, streamModelFromEnv, type StreamModel } from './readBoard'
import { bedrockCallModelFromEnv, bedrockCallTextFromEnv, bedrockDescribeFromEnv } from './bedrock'
import { shareRouter, shareFromEnv, type Share } from './share'
import { ttsRouter, type Synth } from './tts'
import { synthFromEnv, voiceFromEnv } from './voice'
import { attachTranscribe } from './transcribe'
import { anthropicCallModelFromEnv, anthropicCallTextFromEnv, anthropicDescribeFromEnv, pickProvider } from './anthropic'
import { notesRouter } from './notes'
import { describeRouter } from './describe'
import { healthFrom } from './health'
import { COOKIE, LOCAL_ACCESS, accessFromEnv, hostAllowed, keyAllowed, keyMatches, type Access } from './access'
import { createRoomHub, type RoomHub } from './rooms'
import { isRoomName, studentLinkPath } from '../src/live/roomProtocol'

type CallModel = (jpeg: Buffer) => Promise<string>

const version: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const WEEK_S = 7 * 24 * 3600

export function createApp(callModel: CallModel, synth?: Synth, callText?: (prompt: string) => Promise<string>, opts?: { staticDir?: string; share?: Share; streamModel?: StreamModel; access?: Access; describe?: (jpeg: Buffer) => Promise<string>; rooms?: RoomHub }): express.Express {
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
    const path = req.path.toLowerCase() // Express routes ignore case, so the key check must too
    if (path.startsWith('/api/') && path !== '/api/health' && !keyAllowed(access, req.headers.cookie) && !roomRoute(req, res)) return void res.status(401).json({ error: 'access key required' })
    next()
  })
  // Classroom relay: a student phone has no access key, only room tokens. They open exactly two routes:
  // /api/tts (headers x-room, x-room-token; the TTS guard below only voices phrases the camera published in that room)
  // and /api/room-status (each body entry carries its own token, checked in the handler).
  function roomRoute(req: express.Request, res: express.Response): boolean {
    const path = req.path.toLowerCase()
    if (req.method === 'POST' && path === '/api/room-status') return true
    const room = req.get('x-room'), token = req.get('x-room-token')
    if (path !== '/api/tts' || !opts?.rooms || !isRoomName(room) || !opts.rooms.verify(room, token ?? null)) return false
    res.locals.room = room
    return true
  }
  app.get('/api/room-link', (req, res) => {
    const room = req.query.room
    if (!opts?.rooms) return void res.status(503).json({ error: 'classroom relay not configured' })
    if (!isRoomName(room)) return void res.status(400).json({ error: 'room must be 1-40 characters: a-z, 0-9 and -' })
    res.json({ room, path: studentLinkPath(room, opts.rooms.tokenFor(room)) })
  })
  app.post('/api/room-status', express.json({ limit: '4kb' }), (req, res) => {
    const list: unknown = req.body?.rooms
    if (!opts?.rooms) return void res.status(503).json({ error: 'classroom relay not configured' })
    if (!Array.isArray(list) || list.length > 10) return void res.status(400).json({ error: 'rooms must be a list of at most 10' })
    const hub = opts.rooms
    const live = list.flatMap((e: { room?: unknown; token?: unknown } | null) =>
      e && isRoomName(e.room) && typeof e.token === 'string' && hub.verify(e.room, e.token) && hub.isLive(e.room) ? [e.room] : [])
    res.json({ live })
  })
  app.get('/api/health', (_req, res) => void res.json(healthFrom(process.env, version)))
  app.post('/api/read-board', express.raw({ type: 'image/jpeg', limit: '5mb' }), readBoardHandler(callModel, opts?.streamModel))
  const roomGuard = (res: express.Response, text: string) => typeof res.locals.room !== 'string' || !!opts?.rooms?.allowsPhrase(res.locals.room, text)
  app.use(synth ? ttsRouter(synth, roomGuard) : (_req, res, next) => (_req.path === '/api/tts' ? void res.status(503).json({ error: 'tts not configured' }) : next()))
  app.use(callText ? notesRouter(callText) : (req, res, next) => (req.path === '/api/notes' ? void res.status(503).json({ error: 'notes not configured' }) : next()))
  app.use(opts?.describe ? describeRouter(opts.describe) : (req, res, next) => (req.path === '/api/describe' ? void res.status(503).json({ error: 'describe not configured' }) : next()))
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
  const rooms = createRoomHub({ access }) // classroom relay: one camera device, many student phones
  const provider = pickProvider(process.env)
  const callModel = provider === 'anthropic' ? anthropicCallModelFromEnv(process.env) : bedrockCallModelFromEnv(process.env)
  const server = createApp(callModel, synthFromEnv(process.env), provider === 'anthropic' ? anthropicCallTextFromEnv(process.env) : process.env.AWS_REGION ? bedrockCallTextFromEnv(process.env) : undefined, { staticDir: existsSync('dist/index.html') ? join(process.cwd(), 'dist') : undefined, share: shareFromEnv(process.env), streamModel: streamModelFromEnv(process.env), access, rooms, describe: provider === 'anthropic' ? anthropicDescribeFromEnv(process.env) : process.env.AWS_REGION ? bedrockDescribeFromEnv(process.env) : undefined }).listen(port, host, () => {
    console.log(`listening on ${host}:${port} (board reader: ${provider}; BOARD_MODEL_ID set: ${process.env.BOARD_MODEL_ID ? 'yes' : 'no'}; hosts: ${[...access.hosts].join(', ')}; access key: ${access.key ? 'required' : 'off'}; voice: ${voiceFromEnv(process.env)})`)
  })
  attachTranscribe(server, undefined, access)
  rooms.attach(server)
  server.on('upgrade', (req, socket) => { // any other WebSocket path: close it instead of leaving it hanging
    const path = new URL(req.url ?? '/', 'http://x').pathname
    if (path !== '/ws/transcribe' && path !== '/ws/room') socket.destroy()
  })
}

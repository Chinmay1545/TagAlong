import type http from 'node:http'
import type { WebSocketServer } from 'ws'

// Route upgrades by path so several noServer ws servers can share one http server
// (two `{server, path}` servers abort each other's upgrades with 400).
export function serveUpgrade(server: http.Server, path: string, wss: WebSocketServer): void {
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== path) return
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  })
}

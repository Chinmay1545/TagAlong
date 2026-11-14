import type http from 'node:http'
import type { WebSocketServer } from 'ws'

const served = new WeakMap<http.Server, Set<string>>()
const pathOf = (url: string | undefined) => new URL(url ?? '/', 'http://x').pathname

// Route upgrades by path so several noServer ws servers can share one http server
// (two `{server, path}` servers abort each other's upgrades with 400).
export function serveUpgrade(server: http.Server, path: string, wss: WebSocketServer): void {
  let paths = served.get(server)
  if (!paths) {
    const known = (paths = new Set<string>())
    served.set(server, known)
    // Unserved paths would otherwise hang open forever.
    server.on('upgrade', (req, socket) => {
      if (known.has(pathOf(req.url))) return
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
    })
  }
  paths.add(path)
  server.on('upgrade', (req, socket, head) => {
    if (pathOf(req.url) !== path) return
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  })
}

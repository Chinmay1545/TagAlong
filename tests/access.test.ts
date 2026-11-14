import { describe, it, expect } from 'vitest'
import type { AddressInfo } from 'node:net'
import { request } from 'node:http'
import { createApp } from '../server/index'
import { accessFromEnv, keyAllowed, originAllowed } from '../server/access'

const hit = (port: number, path: string, headers: Record<string, string>) => new Promise<{ status: number; headers: any; body: string }>((resolve, reject) => {
  const r = request({ port, host: '127.0.0.1', path, headers }, res => {
    let body = ''; res.on('data', c => (body += c)); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }))
  })
  r.on('error', reject); r.end()
})

describe('accessFromEnv', () => {
  it('is local-only with no key when nothing is set', () => {
    const a = accessFromEnv({})
    expect([...a.hosts]).toEqual(['127.0.0.1', 'localhost'])
    expect(a.key).toBeUndefined()
    expect(a.isPublic).toBe(false)
  })
  it('throws when a public domain has no ACCESS_KEY', () => {
    expect(() => accessFromEnv({ RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' })).toThrow(/ACCESS_KEY/)
  })
  it('adds the Railway domain and ALLOWED_HOSTS', () => {
    const a = accessFromEnv({ RAILWAY_PUBLIC_DOMAIN: 'X.up.railway.app', ALLOWED_HOSTS: ' a.example , ', ACCESS_KEY: 'k' })
    expect(a.hosts.has('x.up.railway.app')).toBe(true)
    expect(a.hosts.has('a.example')).toBe(true)
    expect(originAllowed('https://x.up.railway.app', a)).toBe(true)
    expect(originAllowed('https://evil.example', a)).toBe(false)
    expect(keyAllowed(a, 'tagalong_key=k')).toBe(true)
    expect(keyAllowed(a, 'tagalong_key=nope')).toBe(false)
  })
})

describe('hosted access key', () => {
  const access = accessFromEnv({ RAILWAY_PUBLIC_DOMAIN: 'app.up.railway.app', ACCESS_KEY: 's3cret' })
  const H = { Host: 'app.up.railway.app' }
  it('health is open, other APIs need the key, ?key= sets a cookie', async () => {
    const server = createApp(async () => '{"terms":[]}', undefined, undefined, { access }).listen(0)
    try {
      const { port } = server.address() as AddressInfo
      expect((await hit(port, '/api/health', H)).status).toBe(200)
      expect((await hit(port, '/api/notes', H)).status).toBe(401)
      expect((await hit(port, '/?key=wrong', H)).status).toBe(401)
      const ok = await hit(port, '/student?key=s3cret&x=1', { ...H, 'X-Forwarded-Proto': 'https' })
      expect(ok.status).toBe(302)
      expect(ok.headers.location).toBe('/student?x=1')
      expect(ok.headers['set-cookie'][0]).toMatch(/^tagalong_key=s3cret;.*HttpOnly.*Secure/)
      // with the cookie the key gate passes (notes is unconfigured here, so 503 rather than 401)
      expect((await hit(port, '/api/notes', { ...H, Cookie: 'tagalong_key=s3cret' })).status).toBe(503)
      expect((await hit(port, '/api/health', { Host: 'evil.example' })).status).toBe(403)
    } finally { server.close() }
  })
})

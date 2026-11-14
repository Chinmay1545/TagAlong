import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { request } from 'node:http'
import { createApp } from '../server/index'
import { parseBoardResponse } from '../server/parseBoard'

const ok = '{"terms":[{"latex":"2x","phrase":"the 2x on top","box":{"x":0.2,"y":0.2,"w":0.1,"h":0.1}}]}'

async function post(callModel: (b: Buffer) => Promise<string>, body: Buffer) {
  const server = createApp(callModel).listen(0)
  try {
    const { port } = server.address() as AddressInfo
    const res = await fetch(`http://127.0.0.1:${port}/api/read-board`, {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array(body),
    })
    return { status: res.status, json: await res.json() as any }
  } finally {
    server.close()
  }
}

describe('POST /api/read-board', () => {
  it('returns terms and ms', async () => {
    const r = await post(async () => ok, Buffer.alloc(10, 1))
    expect(r.status).toBe(200)
    expect(r.json.terms).toHaveLength(1)
    expect(typeof r.json.ms).toBe('number')
  })
  it('502 when the model throws', async () => {
    const r = await post(async () => { throw new Error('boom') }, Buffer.alloc(10, 1))
    expect(r.status).toBe(502)
    expect(r.json.error).toBe('board read failed')
  })
  it('400 on empty body', async () => {
    const r = await post(async () => ok, Buffer.alloc(0))
    expect(r.status).toBe(400)
    expect(r.json.error).toBeTruthy()
  })
  it('413 as JSON (no HTML stack trace) when the body is over 5 MB', async () => {
    let called = false
    const r = await post(async () => { called = true; return ok }, Buffer.alloc(5 * 1024 * 1024 + 1, 1))
    expect(r.status).toBe(413)
    expect(r.json.error).toMatch(/too large/i)
    expect(JSON.stringify(r.json)).not.toMatch(/node_modules|at /)
    expect(called).toBe(false)
  })
})

describe('board-fraction fixture', () => {
  it('is valid parser output', () => {
    const f = JSON.parse(readFileSync('public/fixtures/board-fraction.json', 'utf8'))
    expect(parseBoardResponse(JSON.stringify(f))).toEqual(f.terms)
  })
})

describe('host check', () => {
  const get = (port: number, host: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const r = request({ port, host: '127.0.0.1', path: '/api/health', headers: { Host: host } }, res => {
      let body = ''; res.on('data', c => (body += c)); res.on('end', () => resolve({ status: res.statusCode!, body }))
    })
    r.on('error', reject); r.end()
  })
  it('403s a foreign Host header (DNS rebinding) and allows localhost', async () => {
    const server = createApp(async () => '').listen(0)
    try {
      const { port } = server.address() as AddressInfo
      const bad = await get(port, 'evil.example')
      expect(bad.status).toBe(403)
      expect(JSON.parse(bad.body)).toEqual({ error: 'forbidden' })
      expect((await get(port, `localhost:${port}`)).status).toBe(200)
    } finally { server.close() }
  })
})

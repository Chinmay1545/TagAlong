// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { mountJudge, unmountJudge } from './helpers/judgeHarness'

const TOKEN = 't'.repeat(22)
class FakeWS {
  static all: FakeWS[] = []
  static OPEN = 1
  readyState = 0
  sent: any[] = []
  onopen: any; onmessage: any; onclose: any; onerror: any
  constructor(public url: string) { FakeWS.all.push(this); setTimeout(() => { this.readyState = 1; this.onopen?.({}) }, 0) }
  send(s: string) { this.sent.push(JSON.parse(s)) }
  close() { this.readyState = 3 }
  push(m: object) { this.onmessage?.({ data: JSON.stringify(m) }) }
}
const okFetch = () => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ token: TOKEN, name: 'Math 201' }) }))

async function mountWithRoom(search = '') {
  FakeWS.all = []
  vi.stubGlobal('WebSocket', FakeWS)
  const j = await mountJudge(search, () => vi.stubGlobal('fetch', okFetch()))
  await j.wait(30)
  return { ...j, ws: FakeWS.all[0] }
}
afterEach(() => { unmountJudge(); FakeWS.all = [] })

describe('judge relay', () => {
  it('creates the room and connects as teacher', async () => {
    const { ws } = await mountWithRoom()
    expect(ws.url).toContain('role=teacher')
    expect(ws.url).toContain(TOKEN)
  })
  it('shows listeners from the relay', async () => {
    const { ws, wait, container } = await mountWithRoom()
    act(() => ws.push({ type: 'listeners', count: 3 }))
    await wait(10)
    expect(container.textContent).toContain('3 listening')
  })
  it('mirrors whispers to the relay', async () => {
    const { ws, mouseTo, key, wait } = await mountWithRoom('?demo=1')
    mouseTo(0.25, 0.27)
    await wait(320)
    await key('p')
    expect(ws.sent.some(m => m.type === 'resolution')).toBe(true)
  })
  it('marked reply goes only to the sender', async () => {
    const { ws, wait } = await mountWithRoom()
    act(() => ws.push({ type: 'bookmark', from: 'abc' }))
    await wait(10)
    expect(ws.sent).toContainEqual({ type: 'marked', count: 1, to: 'abc' })
  })
  it('unmark within the window removes the mark', async () => {
    const { ws, wait } = await mountWithRoom()
    act(() => ws.push({ type: 'bookmark', from: 'abc' }))
    act(() => ws.push({ type: 'unmark', from: 'abc' }))
    await wait(10)
    expect(ws.sent).toContainEqual({ type: 'marked', count: 0, removed: true, to: 'abc' })
  })
  it('unmark from someone with no mark is ignored', async () => {
    const { ws, wait } = await mountWithRoom()
    act(() => ws.push({ type: 'unmark', from: 'zed' }))
    await wait(10)
    expect(ws.sent.some(m => m.type === 'marked')).toBe(false)
  })
  it('hello from a phone gets mode and board back to that phone', async () => {
    const { ws, wait } = await mountWithRoom()
    act(() => ws.push({ type: 'hello', from: 'abc' }))
    await wait(10)
    expect(ws.sent).toContainEqual({ type: 'mode', withoutApp: false, to: 'abc' })
  })
  it('when /api/rooms fails the panel says Phones offline and nothing breaks', async () => {
    const { container } = await mountJudge()
    expect(container.textContent).toContain('Phones offline')
    expect(container.textContent).toContain('THIS & THAT')
  })
})

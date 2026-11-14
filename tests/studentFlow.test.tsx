// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { mountJudge, unmountJudge } from './helpers/judgeHarness'
import type { Msg } from '../src/live/broadcast'

// The student tab, played by a real BroadcastChannel; the judge screen is the real one.
let student: BroadcastChannel | null = null
const got: Msg[] = []
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function judgeWithStudent(search = '?demo=1') {
  vi.doMock('../src/vision/grabFrame', () => ({ grabJpeg: async () => new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' }) }))
  const j = await mountJudge(search)
  got.length = 0
  student = new BroadcastChannel('this-and-that')
  student.onmessage = e => got.push(e.data as Msg)
  const fromStudent = async (m: Msg) => { await act(async () => { student!.postMessage(m); await sleep(30) }) }
  const say = async (text: string) => { await act(async () => { window.__tt!.say(text); await sleep(30) }) }
  return { ...j, fromStudent, say }
}
afterEach(() => { student?.close(); student = null; vi.doUnmock('../src/vision/grabFrame'); unmountJudge() })

describe('judge screen: student bookmarks', () => {
  it('a bookmark marks the sentence just said, shows it in the transcript, and confirms with the count', async () => {
    const j = await judgeWithStudent()
    await j.say('so we factor the top')
    await j.fromStudent({ type: 'bookmark' })
    expect(got).toContainEqual({ type: 'marked', count: 1 })
    const rows = j.container.querySelectorAll('.tr-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].classList.contains('marked')).toBe(true)
    await j.fromStudent({ type: 'bookmark' })
    expect(got).toContainEqual({ type: 'marked', count: 2 })
  })
})

describe("judge screen: what's happening", () => {
  it('sends a frame to /api/describe and passes the answer to the student', async () => {
    const j = await judgeWithStudent()
    const fetchFn = vi.fn(async (url: string) => ({ ok: url === '/api/describe', status: 200, json: async () => ({ text: 'Students are packing up.' }) }))
    vi.stubGlobal('fetch', fetchFn)
    await j.fromStudent({ type: 'ask' })
    await j.wait(30)
    expect(fetchFn.mock.calls.some(c => c[0] === '/api/describe')).toBe(true)
    expect(got).toContainEqual({ type: 'assist', text: 'Students are packing up.' })
  })
  it('when the describer is down the student still gets an answer', async () => {
    const j = await judgeWithStudent()
    await j.fromStudent({ type: 'ask' }) // the harness fetch fails with 503
    await j.wait(30)
    expect(got.filter(m => m.type === 'assist')).toHaveLength(1)
  })
})

describe('judge screen: class ending alert', () => {
  it('a wrap-up sentence sends one notice with what the teacher said', async () => {
    const j = await judgeWithStudent()
    await j.say('for homework do problems 3 to 7')
    expect(got).toContainEqual({ type: 'notice', text: 'Class is wrapping up. The teacher said: for homework do problems 3 to 7' })
  })
  it('ordinary lecture sentences send no notice', async () => {
    const j = await judgeWithStudent()
    await j.say('this cancels with that')
    expect(got.some(m => m.type === 'notice')).toBe(false)
  })
})

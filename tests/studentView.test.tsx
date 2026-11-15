// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StudentView } from '../src/ui/StudentView'
import type { Msg } from '../src/live/broadcast'

// The judge tab, played by a real BroadcastChannel on the same name.
let judge: BroadcastChannel
let got: Msg[]
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const send = async (m: Msg) => { await act(async () => { judge.postMessage(m); await sleep(20) }) }
const spoken = () => document.querySelector('[aria-live]')!.textContent

beforeEach(async () => {
  got = []
  judge = new BroadcastChannel('tagalong')
  judge.onmessage = e => got.push(e.data as Msg)
  render(<StudentView />)
  await act(() => sleep(20))
})
afterEach(() => { cleanup(); judge.close() })

describe('student view: bookmark', () => {
  it('the Mark button tells the judge tab "I did not understand this"', async () => {
    fireEvent.click(screen.getByRole('button', { name: /mark/i }))
    await act(() => sleep(20))
    expect(got).toContainEqual({ type: 'bookmark' })
  })
  it('the confirmation is spoken with the running count', async () => {
    await send({ type: 'marked', count: 1 })
    expect(spoken()).toBe('Marked. 1 moment to go over later.')
    await send({ type: 'marked', count: 3 })
    expect(spoken()).toBe('Marked. 3 moments to go over later.')
  })
})

describe("student view: what's happening", () => {
  it('the button asks the judge tab and says it is looking', async () => {
    fireEvent.click(screen.getByRole('button', { name: /what.s happening/i }))
    await act(() => sleep(20))
    expect(got).toContainEqual({ type: 'ask' })
    expect(spoken()).toBe('Looking.')
  })
  it('the answer is spoken and shown', async () => {
    await send({ type: 'assist', text: 'Students are packing up.' })
    expect(spoken()).toBe('Students are packing up.')
    expect(screen.getByText('Students are packing up.', { selector: '.s-help p' })).toBeTruthy()
  })
})

describe('student view: alerts only when needed', () => {
  it('a notice is spoken and shown', async () => {
    await send({ type: 'notice', text: 'Class is wrapping up. The teacher said: see you Monday.' })
    expect(spoken()).toBe('Class is wrapping up. The teacher said: see you Monday.')
    expect(screen.getByText(/wrapping up/, { selector: '.s-help p' })).toBeTruthy()
  })
})

describe('student view: repeats are announced again', () => {
  it('the same text twice changes the live region, so the screen reader speaks it again', async () => {
    await send({ type: 'assist', text: 'Students are packing up.' })
    const first = spoken()
    await send({ type: 'assist', text: 'Students are packing up.' })
    expect(spoken()).not.toBe(first)
    expect(spoken()!.replace(/\u200b/g, '')).toBe('Students are packing up.')
  })
})

describe('student view: existing whisper still works', () => {
  it('a resolution is spoken and shown as now', async () => {
    await send({ type: 'resolution', word: 'this', phrase: 'the 2x on top', latencyMs: 400, muted: false })
    expect(spoken()).toBe('the 2x on top')
    expect(document.querySelector('.s-now .s-phrase')!.textContent).toBe('the 2x on top')
  })
  it('messages meant for the judge (from another student tab) are ignored', async () => {
    await send({ type: 'bookmark' })
    await send({ type: 'ask' })
    expect(document.querySelector('.s-now')).toBeNull()
    expect(spoken()).toBe('')
  })
})

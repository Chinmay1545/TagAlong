// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RoomStudentView } from '../src/ui/RoomStudentView'
import type { RoomState } from '../src/live/roomClient'

afterEach(cleanup)

const css = readFileSync('src/phone/phone.css', 'utf8')

describe('student phone look (phone.css)', () => {
  it('turns every animation and transition off for reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{[^}]*animation: none !important;[^}]*transition: none !important/)
  })
  it('never uses pure black', () => expect(css).not.toMatch(/#000(000)?\b/i))
  it('keeps every phone button a big target', () => {
    for (const sel of ['.rs-start-btn', '.rs-btn']) {
      const rule = css.match(new RegExp(`\\${sel} {([^}]*)}`))
      expect(rule, sel).toBeTruthy()
      const h = rule![1].match(/min-height: (\d+)px/)
      if (h) expect(Number(h[1])).toBeGreaterThanOrEqual(56)
      else expect(rule![1]).toMatch(/min-height: (100dvh|calc\(100dvh)/)
    }
  })
  it('is scoped to the phone screens so the same-device student tab does not change', () => {
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*{([^{}]*{[^}]*})*\s*}/g, '').match(/(^|})\s*([^{}@]+){/g) ?? []
    for (const s of selectors) {
      const sel = s.replace(/^}?\s*/, '').replace(/{$/, '').trim()
      if (sel === ':root' || sel.startsWith('from') || sel.startsWith('to') || /^\d/.test(sel)) continue
      for (const part of sel.split(',')) expect(part.trim(), sel).toMatch(/^(\.rs|\*)/)
    }
  })
})

describe('student phone look (markup stays accessible)', () => {
  function setup() {
    let on: { onMessage(m: unknown): void; onState?(s: RoomState): void } | null = null
    render(<RoomStudentView room="math201" token="tok" label="Math 201" deps={{
      connect: (_u, h) => { on = h; return { send: () => {}, close: () => {} } },
      player: { unlock: vi.fn(), play: vi.fn(() => ({ startedAt: 0 })), prepare: vi.fn(async () => {}) }, keepAwake: () => () => {},
      location: { protocol: 'https:', host: 'h' }, earcons: { unlock: vi.fn(), play: vi.fn() }, unlockVoice: vi.fn(),
    }} />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Start listening to Math 201' })) })
    return { recv: (m: unknown) => act(async () => { on!.onMessage(m) }), state: (s: RoomState) => act(() => on!.onState?.(s)) }
  }

  it('the word-by-word reveal is hidden from the screen reader and spells the same phrase', async () => {
    const t = setup()
    await t.recv({ type: 'whisper', word: 'this', items: [{ phrase: 'the x on the left', x: 0.2 }] })
    const p = screen.getByText('the x on the left')
    const words = p.querySelector('[aria-hidden="true"]')!
    expect(words.textContent).toBe('the x on the left')
    expect(words.querySelectorAll('span').length).toBe(5)
  })

  it('shows a reconnecting banner that the screen reader skips (the live region speaks it)', () => {
    const t = setup()
    t.state('open')
    t.state('reconnecting')
    const banner = document.querySelector('.rs-banner')!
    expect(banner.getAttribute('aria-hidden')).toBe('true')
    t.state('open')
    expect(document.querySelector('.rs-banner')).toBeNull()
  })

  it('keeps the start button name exact with the styled class name inside it', () => {
    cleanup()
    render(<RoomStudentView room="math201" token="tok" label="Math 201" deps={{ connect: () => ({ send: () => {}, close: () => {} }) }} />)
    expect(screen.getByRole('button', { name: 'Start listening to Math 201' }).textContent).toBe('Start listening to Math 201')
  })
})

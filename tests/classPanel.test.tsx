// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ClassPanel } from '../src/ui/ClassPanel'
import type { Classroom } from '../src/live/classroom'
import type { RoomState } from '../src/live/roomClient'

afterEach(() => { cleanup(); try { localStorage.clear() } catch { /* ignore */ } })

function fakeClassroom(link = 'https://app/?student&room=math201&t=tok') {
  let listeners: ((n: number) => void) | null = null
  let state: ((s: RoomState) => void) | null = null
  let room: string | null = null
  const c = {
    room: () => room,
    open: vi.fn(async (r: string) => { room = r; return link }),
    close: vi.fn(() => { room = null }),
    whisper: vi.fn(), board: vi.fn(), notice: vi.fn(),
    onListeners: (cb: (n: number) => void) => { listeners = cb; return () => {} },
    onState: (cb: (s: RoomState) => void) => { state = cb; return () => {} },
  }
  return { c: c as unknown as Classroom, raw: c, count: (n: number) => listeners?.(n), setState: (s: RoomState) => state?.(s) }
}

describe('class panel (camera device)', () => {
  it('opens the class, shows the student link and goes quiet on this device', async () => {
    const f = fakeClassroom()
    const onLive = vi.fn()
    render(<ClassPanel classroom={f.c} onLiveChange={onLive} />)
    fireEvent.change(screen.getByLabelText(/class name/i), { target: { value: 'math201' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /open class/i })) })
    expect(f.raw.open).toHaveBeenCalledWith('math201')
    expect(screen.getByRole('link', { name: /student link/i }).getAttribute('href')).toBe('https://app/?student&room=math201&t=tok')
    expect(onLive).toHaveBeenLastCalledWith(true)
  })

  it('shows the live state and how many students are listening', async () => {
    const f = fakeClassroom()
    render(<ClassPanel classroom={f.c} onLiveChange={() => {}} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /open class/i })) })
    act(() => { f.setState('open'); f.count(3) })
    expect(screen.getByText(/live · 3 listening/i)).toBeTruthy()
    act(() => f.setState('reconnecting'))
    expect(screen.getByText(/reconnecting/i)).toBeTruthy()
  })

  it('closing the class brings this device\'s own voice back', async () => {
    const f = fakeClassroom()
    const onLive = vi.fn()
    render(<ClassPanel classroom={f.c} onLiveChange={onLive} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /open class/i })) })
    fireEvent.click(screen.getByRole('button', { name: /close class/i }))
    expect(f.raw.close).toHaveBeenCalled()
    expect(onLive).toHaveBeenLastCalledWith(false)
    expect(screen.queryByRole('link', { name: /student link/i })).toBeNull()
  })

  it('shows why a class could not be opened', async () => {
    const f = fakeClassroom()
    f.raw.open.mockRejectedValueOnce(new Error('Use 1-40 characters: a-z, 0-9 and -'))
    render(<ClassPanel classroom={f.c} onLiveChange={() => {}} />)
    fireEvent.change(screen.getByLabelText(/class name/i), { target: { value: 'Math 201' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /open class/i })) })
    expect(screen.getByRole('alert').textContent).toMatch(/a-z, 0-9/)
  })

  it('remembers the class name for next time', async () => {
    const f = fakeClassroom()
    const { unmount } = render(<ClassPanel classroom={f.c} onLiveChange={() => {}} />)
    fireEvent.change(screen.getByLabelText(/class name/i), { target: { value: 'bio110' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /open class/i })) })
    unmount()
    render(<ClassPanel classroom={fakeClassroom().c} onLiveChange={() => {}} />)
    expect((screen.getByLabelText(/class name/i) as HTMLInputElement).value).toBe('bio110')
  })
})

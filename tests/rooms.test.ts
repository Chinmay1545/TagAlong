import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHub, roomToken, TOKEN_RE, type Sock } from '../server/rooms'

type Msg = Record<string, unknown>
const sock = () => {
  const got: Msg[] = []
  const s: Sock & { got: Msg[]; closed: boolean; code?: number } = {
    got, closed: false,
    send: d => { got.push(JSON.parse(d)) },
    close(code) { s.closed = true; s.code = code },
  }
  return s
}
const A = 'tokenAAAAAAAAAAAAAAAA', B = 'tokenBBBBBBBBBBBBBBBB'
const last = (s: { got: Msg[] }) => s.got[s.got.length - 1]
const say = (h: ReturnType<typeof createHub>, s: Sock, m: Msg) => h.fromStudent(s, JSON.stringify(m))

describe('roomToken', () => {
  it('is stable, case/space-insensitive, url-safe, 22 chars', () => {
    const t = roomToken('s', 'Math 201')
    expect(t).toBe(roomToken('s', ' math 201 '))
    expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/); expect(t).toMatch(TOKEN_RE)
    expect(t).toHaveLength(22)
    expect(roomToken('t', 'Math 201')).not.toBe(t)
  })
})

describe('hub', () => {
  it('a student sees which of its rooms are live', () => {
    const h = createHub(), t = sock(), s = sock()
    h.addTeacher(A, 'Math 201', t)
    h.addStudent(s, [A, B])
    expect(last(s)).toEqual({ type: 'rooms', live: [A], names: { [A]: 'Math 201' } })
  })

  it('notifies watching students when a teacher arrives and when it leaves', () => {
    const h = createHub({ graceMs: 0 }), t = sock(), s = sock()
    h.addStudent(s, [A])
    expect(last(s)).toEqual({ type: 'rooms', live: [], names: {} })
    h.addTeacher(A, 'Math 201', t)
    expect(last(s)).toEqual({ type: 'rooms', live: [A], names: { [A]: 'Math 201' } })
    h.remove(t)
    expect(last(s)).toEqual({ type: 'rooms', live: [], names: {} })
  })

  it('relays teacher messages only to students joined to that room', () => {
    const h = createHub(), t = sock(), a = sock(), watcher = sock(), b = sock()
    h.addTeacher(A, 'Math', t)
    h.addStudent(a, [A]); h.addStudent(watcher, [A]); h.addStudent(b, [B])
    say(h, a, { type: 'join', room: A })
    say(h, b, { type: 'join', room: B })
    h.fromTeacher(t, JSON.stringify({ type: 'whisper', text: 'hi' }))
    expect(last(a)).toEqual({ type: 'whisper', text: 'hi' })
    expect(watcher.got.some(m => m.type === 'whisper')).toBe(false)
    expect(b.got.some(m => m.type === 'whisper')).toBe(false)
  })

  it('forwards student hello/bookmark/unmark/ask to the teacher with from', () => {
    const h = createHub(), t = sock(), s = sock()
    h.addTeacher(A, 'Math', t)
    const sid = h.addStudent(s, [A])
    say(h, s, { type: 'join', room: A })
    for (const type of ['hello', 'bookmark', 'unmark', 'ask']) {
      say(h, s, { type, q: 1 })
      expect(last(t)).toEqual({ type, q: 1, from: sid })
    }
  })

  it('ignores other types and bad JSON', () => {
    const h = createHub(), t = sock(), s = sock()
    h.addTeacher(A, 'Math', t)
    h.addStudent(s, [A])
    say(h, s, { type: 'join', room: A })
    const n = t.got.length
    say(h, s, { type: 'whisper' })
    h.fromStudent(s, '{nope')
    expect(t.got.length).toBe(n)
  })

  it('join outside its rooms is ignored', () => {
    const h = createHub(), t = sock(), s = sock()
    h.addTeacher(B, 'Other', t)
    h.addStudent(s, [A])
    say(h, s, { type: 'join', room: B })
    expect(last(t)).toEqual({ type: 'listeners', count: 0 })
    h.fromTeacher(t, JSON.stringify({ type: 'whisper' }))
    expect(s.got.some(m => m.type === 'whisper')).toBe(false)
  })

  it('targeted reply reaches only that student', () => {
    const h = createHub(), t = sock(), a = sock(), b = sock()
    h.addTeacher(A, 'Math', t)
    const sidA = h.addStudent(a, [A]); h.addStudent(b, [A])
    say(h, a, { type: 'join', room: A }); say(h, b, { type: 'join', room: A })
    h.fromTeacher(t, JSON.stringify({ type: 'marked', count: 1, to: sidA }))
    expect(last(a)).toEqual({ type: 'marked', count: 1 })
    expect(b.got.some(m => m.type === 'marked')).toBe(false)
  })

  it('listeners count follows joins and leaves', () => {
    const h = createHub(), t = sock(), a = sock(), b = sock()
    h.addTeacher(A, 'Math', t)
    expect(last(t)).toEqual({ type: 'listeners', count: 0 })
    h.addStudent(a, [A]); h.addStudent(b, [A])
    say(h, a, { type: 'join', room: A })
    expect(last(t)).toEqual({ type: 'listeners', count: 1 })
    say(h, b, { type: 'join', room: A })
    expect(last(t)).toEqual({ type: 'listeners', count: 2 })
    h.remove(a)
    expect(last(t)).toEqual({ type: 'listeners', count: 1 })
  })

  it('a new teacher replaces the old one', () => {
    const h = createHub(), old = sock(), s = sock(), fresh = sock()
    h.addTeacher(A, 'Math', old)
    h.addStudent(s, [A]); say(h, s, { type: 'join', room: A })
    h.addTeacher(A, 'Math', fresh)
    expect(old.closed).toBe(true)
    expect(old.code).toBe(4001) // tells the old tab it was replaced, so it stops reconnecting
    expect(last(fresh)).toEqual({ type: 'listeners', count: 1 })
    expect(last(s)).toEqual({ type: 'rooms', live: [A], names: { [A]: 'Math' } })
    h.remove(old) // late close event from the replaced socket must not evict the new teacher
    h.fromTeacher(fresh, JSON.stringify({ type: 'whisper' }))
    expect(last(s)).toEqual({ type: 'whisper' })
  })

  it('rate limit drops the 7th forwarded message in 20 s, allows again after the window', () => {
    let now = 1000
    const h = createHub({ now: () => now }), t = sock(), s = sock()
    h.addTeacher(A, 'Math', t)
    h.addStudent(s, [A]); say(h, s, { type: 'join', room: A })
    const count = () => t.got.filter(m => m.type === 'ask').length
    for (let i = 0; i < 6; i++) say(h, s, { type: 'ask' })
    expect(count()).toBe(6)
    say(h, s, { type: 'ask' })
    expect(count()).toBe(6)
    now += 20001
    say(h, s, { type: 'ask' })
    expect(count()).toBe(7)
  })

  it('ping gets pong with the same t for both roles', () => {
    const h = createHub(), t = sock(), s = sock()
    h.addTeacher(A, 'Math', t); h.addStudent(s, [A])
    h.fromTeacher(t, JSON.stringify({ type: 'ping', t: 5 }))
    say(h, s, { type: 'ping', t: 9 })
    expect(last(t)).toEqual({ type: 'pong', t: 5 })
    expect(last(s)).toEqual({ type: 'pong', t: 9 })
  })

  it('re-joining the same room is a no-op for the teacher', () => {
    const h = createHub(), t = sock(), s = sock()
    h.addTeacher(A, 'Math', t); h.addStudent(s, [A])
    say(h, s, { type: 'join', room: A })
    const n = t.got.length
    say(h, s, { type: 'join', room: A })
    expect(t.got.length).toBe(n)
  })

  it('a throwing close on a replaced teacher does not break addTeacher', () => {
    const h = createHub(), old = sock(), fresh = sock(), s = sock()
    old.close = () => { throw new Error('boom') }
    h.addTeacher(A, 'Math', old); h.addStudent(s, [A])
    expect(() => h.addTeacher(A, 'Math', fresh)).not.toThrow()
    expect(last(s)).toEqual({ type: 'rooms', live: [A], names: { [A]: 'Math' } })
  })
})

describe('teacher drops for a moment (Wi-Fi blip)', () => {
  afterEach(() => { vi.useRealTimers() })
  const setup = () => {
    vi.useFakeTimers()
    const h = createHub(), t = sock(), s = sock()
    h.addTeacher(A, 'Math 201', t)
    h.addStudent(s, [A]); say(h, s, { type: 'join', room: A })
    return { h, t, s }
  }

  it('phones hear nothing if the laptop is back within 10 seconds', () => {
    const { h, t, s } = setup()
    const before = s.got.length
    h.remove(t)
    vi.advanceTimersByTime(9000)
    const t2 = sock()
    h.addTeacher(A, 'Math 201', t2)
    vi.advanceTimersByTime(60000)
    expect(s.got.slice(before)).toEqual([]) // no "class ended", no "started"
    expect(last(t2)).toEqual({ type: 'listeners', count: 1 }) // still joined
    h.fromTeacher(t2, JSON.stringify({ type: 'notice', text: 'hi' }))
    expect(last(s)).toEqual({ type: 'notice', text: 'hi' })
  })

  it('the class ends for phones only after 10 seconds without the laptop', () => {
    const { h, t, s } = setup()
    h.remove(t)
    vi.advanceTimersByTime(9999)
    expect(last(s)).not.toEqual({ type: 'rooms', live: [], names: {} })
    vi.advanceTimersByTime(1)
    expect(last(s)).toEqual({ type: 'rooms', live: [], names: {} })
  })

  it('a phone that connects during the gap still sees the class as live', () => {
    const { h, t } = setup()
    h.remove(t)
    const s2 = sock()
    h.addStudent(s2, [A])
    expect(last(s2)).toEqual({ type: 'rooms', live: [A], names: { [A]: 'Math 201' } })
  })
})

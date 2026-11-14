import { describe, it, expect } from 'vitest'
import { createClassroom } from '../src/live/classroom'
import type { RoomState } from '../src/live/roomClient'
import type { Resolution, Term } from '../src/core/types'

const term = (id: number, phrase: string, x: number, y: number): Term => ({ id, latex: 'x', phrase, box: { x, y, w: 0.1, h: 0.1 } })

function setup() {
  const conns: { url: string; sent: unknown[]; closed: boolean; on: { onMessage(m: unknown): void; onState?(s: RoomState): void } }[] = []
  const classroom = createClassroom({
    connect: (url, on) => {
      const c = { url, sent: [] as unknown[], closed: false, on }
      conns.push(c)
      return { send: (m: unknown) => c.sent.push(m), close: () => { c.closed = true } }
    },
    fetchLink: async room => `/?student&room=${room}&t=tok`,
    location: { protocol: 'https:', host: 'app.example', origin: 'https://app.example' },
  })
  return { classroom, conns, last: () => conns.at(-1)! }
}

describe('classroom (camera device side)', () => {
  it('opening a class connects as the camera and returns the full student link', async () => {
    const { classroom, last } = setup()
    const link = await classroom.open('math201')
    expect(link).toBe('https://app.example/?student&room=math201&t=tok')
    expect(last().url).toBe('wss://app.example/ws/room?role=camera&room=math201')
    expect(classroom.room()).toBe('math201')
  })

  it('sends nothing before a class is opened', () => {
    const { classroom, conns } = setup()
    classroom.board([term(1, 'the x on the left', 0.1, 0.3)])
    expect(conns).toHaveLength(0)
  })

  it('publishes whispers with positions and the board in reading order', async () => {
    const { classroom, last } = setup()
    await classroom.open('math201')
    last().on.onState?.('open')
    classroom.board([term(2, 'the 6 on the right', 0.8, 0.3), term(1, 'the x on the left', 0.1, 0.3)])
    const r: Resolution = { word: { word: 'this', t: 1 } as Resolution['word'], terms: [term(1, 'the x on the left', 0.1, 0.3)] }
    classroom.whisper(r)
    classroom.whisper({ ...r, terms: [] }) // nothing resolved: nothing to send
    classroom.notice('Class is ending.')
    expect(last().sent).toEqual([
      { type: 'status', open: true },
      { type: 'board', phrases: ['the x on the left', 'the 6 on the right'], overview: ['the x on the left', 'the 6 on the right'] },
      { type: 'whisper', word: 'this', items: [{ phrase: 'the x on the left', x: 0.15000000000000002 }] },
      { type: 'notice', text: 'Class is ending.' },
    ])
  })

  it('after a reconnect, re-sends the class status and the latest board', async () => {
    const { classroom, last } = setup()
    await classroom.open('math201')
    last().on.onState?.('open')
    classroom.board([term(1, 'the x on the left', 0.1, 0.3)])
    last().sent.length = 0
    last().on.onState?.('reconnecting')
    last().on.onState?.('open')
    expect(last().sent).toEqual([{ type: 'status', open: true }, { type: 'board', phrases: ['the x on the left'], overview: ['the x on the left'] }])
  })

  it('reports listener counts and connection state', async () => {
    const { classroom, last } = setup()
    const counts: number[] = [], states: RoomState[] = []
    classroom.onListeners(n => counts.push(n))
    classroom.onState(s => states.push(s))
    await classroom.open('math201')
    last().on.onState?.('open')
    last().on.onMessage({ type: 'listeners', count: 3 })
    last().on.onMessage({ type: 'nonsense' })
    expect(counts).toEqual([3])
    expect(states).toEqual(['open'])
  })

  it('closing the class tells the room, disconnects, and stops publishing', async () => {
    const { classroom, last, conns } = setup()
    await classroom.open('math201')
    last().on.onState?.('open')
    classroom.close()
    expect(last().sent.at(-1)).toEqual({ type: 'status', open: false })
    expect(last().closed).toBe(true)
    expect(classroom.room()).toBeNull()
    classroom.board([term(1, 'x', 0.1, 0.1)])
    expect(conns).toHaveLength(1)
    expect(last().sent.at(-1)).toEqual({ type: 'status', open: false })
  })

  it('opening another room closes the first', async () => {
    const { classroom, conns } = setup()
    await classroom.open('math201')
    await classroom.open('bio110')
    expect(conns[0].closed).toBe(true)
    expect(conns[1].url).toContain('room=bio110')
  })
})

describe('classroom with a connection that reports state immediately (like the real one)', () => {
  it('does not crash when "connecting" is reported before connect() returns', async () => {
    const classroom = createClassroom({
      connect: (_url, on) => { on.onState?.('connecting'); return { send: () => {}, close: () => {} } },
      fetchLink: async room => `/?student&room=${room}&t=tok`,
      location: { protocol: 'http:', host: 'h', origin: 'http://h' },
    })
    await expect(classroom.open('math201')).resolves.toBe('http://h/?student&room=math201&t=tok')
  })
})

import { describe, it, expect } from 'vitest'
import { loadClasses, saveClass, classLabel } from '../src/phone/classes'
import { pickView } from '../src/ui/route'

const mem = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}
const bad = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
const c = (room: string, label = room) => ({ room, token: 't-' + room, label })

describe('saved classes', () => {
  it('round trips, newest first, dedupes by room with the new label and token', () => {
    const s = mem()
    saveClass(s, c('a'))
    saveClass(s, c('b'))
    const next = saveClass(s, { room: 'a', token: 'new', label: 'Math 201' })
    expect(next).toEqual([{ room: 'a', token: 'new', label: 'Math 201' }, c('b')])
    expect(loadClasses(s)).toEqual(next)
  })
  it('keeps at most 10', () => {
    const s = mem()
    for (let i = 0; i < 12; i++) saveClass(s, c('r' + i))
    const l = loadClasses(s)
    expect(l).toHaveLength(10)
    expect(l[0].room).toBe('r11')
  })
  it('never throws: bad storage, bad JSON, wrong shape, junk entries', () => {
    expect(loadClasses(bad)).toEqual([])
    expect(() => saveClass(bad, c('a'))).not.toThrow()
    expect(loadClasses({ getItem: () => '{oops' })).toEqual([])
    expect(loadClasses({ getItem: () => '{"a":1}' })).toEqual([])
    expect(loadClasses({ getItem: () => JSON.stringify([c('a'), { room: 'b' }, null, { room: 1, token: 'x', label: 'y' }]) })).toEqual([c('a')])
  })
})

describe('class label', () => {
  it('uses n when 1-60 characters, else the room id', () => {
    expect(classLabel('math201', 'Math 201')).toBe('Math 201')
    expect(classLabel('math201', null)).toBe('math201')
    expect(classLabel('math201', '')).toBe('math201')
    expect(classLabel('math201', 'x'.repeat(61))).toBe('math201')
    expect(classLabel('math201', 'x'.repeat(60))).toBe('x'.repeat(60))
  })
})

describe('pickView for the phone app', () => {
  it('?classes opens the phone home', () => expect(pickView('?classes')).toEqual({ view: 'phone-home' }))
  it('a course link may carry a display name', () =>
    expect(pickView('?student&room=math201&t=tok&n=Math%20201')).toEqual({ view: 'room-student', room: 'math201', token: 'tok', name: 'Math 201' }))
  it('links without n are unchanged', () =>
    expect(pickView('?student&room=math201&t=tok')).toStrictEqual({ view: 'room-student', room: 'math201', token: 'tok' }))
})

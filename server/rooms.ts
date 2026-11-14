import { createHmac, randomUUID } from 'node:crypto'

// Relays live whispers from one teacher laptop per room to the students' phones joined to it.
// Pure: sockets are anything with send/close, so this is tested without a network.
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/

export const roomToken = (secret: string, name: string): string =>
  createHmac('sha256', secret).update(name.trim().toLowerCase()).digest('base64url').slice(0, 22)

export type Sock = { send(data: string): void; close(code?: number): void }
// Close code for a teacher socket replaced by a newer tab on the same class: the old tab must not reconnect.
export const REPLACED = 4001
export type Hub = {
  addTeacher(room: string, name: string, s: Sock): void
  addStudent(s: Sock, rooms: string[]): string
  remove(s: Sock): void
  fromTeacher(s: Sock, raw: string): void
  fromStudent(s: Sock, raw: string): void
}

type Student = { sid: string; rooms: string[]; joined?: string; hits: number[] }
const FORWARDED = new Set(['hello', 'bookmark', 'unmark', 'ask'])

const parse = (raw: string): Record<string, unknown> | undefined => {
  try {
    const m = JSON.parse(raw)
    return m && typeof m === 'object' && !Array.isArray(m) ? m : undefined
  } catch { return undefined }
}

export function createHub(opts: { rateMax?: number; rateWindowMs?: number; now?: () => number } = {}): Hub {
  const { rateMax = 6, rateWindowMs = 20000, now = Date.now } = opts
  const teachers = new Map<string, { name: string; s: Sock }>()
  const students = new Map<Sock, Student>()
  const send = (s: Sock, m: unknown) => { try { s.send(JSON.stringify(m)) } catch { /* dead socket: its close event removes it */ } }

  const roomsMsg = (st: Student) => {
    const live = st.rooms.filter(r => teachers.has(r))
    return { type: 'rooms', live, names: Object.fromEntries(live.map(r => [r, teachers.get(r)!.name])) }
  }
  const tellStudents = (room: string) => {
    for (const [s, st] of students) if (st.rooms.includes(room)) send(s, roomsMsg(st))
  }
  const inRoom = (room: string) => [...students].filter(([, st]) => st.joined === room)
  const tellTeacher = (room: string) => {
    const t = teachers.get(room)
    if (t) send(t.s, { type: 'listeners', count: inRoom(room).length })
  }
  const roomOf = (s: Sock) => [...teachers].find(([, t]) => t.s === s)?.[0]

  return {
    addTeacher(room, name, s) {
      const old = teachers.get(room)
      teachers.set(room, { name, s }) // set first so old's late close event cannot evict the new one
      if (old && old.s !== s) try { old.s.close(REPLACED) } catch { /* already dead */ }
      tellStudents(room)
      tellTeacher(room)
    },

    addStudent(s, rooms) {
      const st: Student = { sid: randomUUID().slice(0, 8), rooms, hits: [] }
      students.set(s, st)
      send(s, roomsMsg(st))
      return st.sid
    },

    remove(s) {
      const room = roomOf(s)
      if (room) {
        teachers.delete(room)
        tellStudents(room)
        return
      }
      const st = students.get(s)
      if (!st) return
      students.delete(s)
      if (st.joined) tellTeacher(st.joined)
    },

    fromTeacher(s, raw) {
      const room = roomOf(s), m = parse(raw)
      if (!room || !m) return
      if (m.type === 'ping') return send(s, { type: 'pong', t: m.t })
      const { to, ...out } = m
      for (const [ss, st] of inRoom(room)) if (typeof to !== 'string' || st.sid === to) send(ss, out)
    },

    fromStudent(s, raw) {
      const st = students.get(s), m = parse(raw)
      if (!st || !m) return
      if (m.type === 'ping') return send(s, { type: 'pong', t: m.t })
      if (m.type === 'join') {
        if (typeof m.room !== 'string' || !st.rooms.includes(m.room)) return
        const prev = st.joined
        if (prev === m.room) return
        st.joined = m.room
        if (prev && prev !== m.room) tellTeacher(prev)
        tellTeacher(m.room)
        return
      }
      if (typeof m.type !== 'string' || !FORWARDED.has(m.type) || !st.joined) return
      const t = now()
      st.hits = st.hits.filter(h => t - h < rateWindowMs)
      if (st.hits.length >= rateMax) return
      st.hits.push(t)
      const teacher = teachers.get(st.joined)
      if (teacher) send(teacher.s, { ...m, from: st.sid })
    },
  }
}

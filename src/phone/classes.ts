// The courses this phone has opened a link for. Storage may be blocked or full: nothing here ever throws.
export type SavedClass = { room: string; token: string; label: string }

const KEY = 'tagalong:classes'
const MAX = 10

// A course link may carry n (a display name); without a usable one the room id is the label.
export const classLabel = (room: string, n: string | null | undefined): string => (n && n.length <= 60 ? n : room)

export function loadClasses(store: Pick<Storage, 'getItem'>): SavedClass[] {
  try {
    const v: unknown = JSON.parse(store.getItem(KEY) ?? '[]')
    if (!Array.isArray(v)) return []
    return v
      .filter((c): c is SavedClass => !!c && typeof c.room === 'string' && typeof c.token === 'string' && typeof c.label === 'string')
      .map(c => ({ room: c.room, token: c.token, label: c.label }))
  } catch {
    return []
  }
}

export function saveClass(store: Pick<Storage, 'getItem' | 'setItem'>, c: SavedClass): SavedClass[] {
  const next = [c, ...loadClasses(store).filter(x => x.room !== c.room)].slice(0, MAX)
  try { store.setItem(KEY, JSON.stringify(next)) } catch { /* no storage: keep going without it */ }
  return next
}

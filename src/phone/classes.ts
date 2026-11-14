export type SavedClass = { token: string; name: string }

const KEY = 'tagalong:classes'
const MAX = 10

export function loadClasses(store: Pick<Storage, 'getItem'>): SavedClass[] {
  try {
    const v: unknown = JSON.parse(store.getItem(KEY) ?? '[]')
    if (!Array.isArray(v)) return []
    return v
      .filter((c): c is SavedClass => !!c && typeof c.token === 'string' && typeof c.name === 'string')
      .map((c) => ({ token: c.token, name: c.name }))
  } catch {
    return []
  }
}

export function saveClass(store: Pick<Storage, 'getItem' | 'setItem'>, c: SavedClass): SavedClass[] {
  const next = [c, ...loadClasses(store).filter((x) => x.token !== c.token)].slice(0, MAX)
  try {
    store.setItem(KEY, JSON.stringify(next))
  } catch {
    // storage unavailable: keep going without persistence
  }
  return next
}

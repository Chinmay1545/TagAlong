import type { SavedClass } from './classes'

export type RoomChoice = { kind: 'join'; token: string } | { kind: 'wait' } | { kind: 'choose'; options: SavedClass[] }

export function pickRoom(live: string[], saved: SavedClass[], preferred: string | null): RoomChoice {
  if (preferred && live.includes(preferred)) return { kind: 'join', token: preferred }
  const options = saved.filter((c) => live.includes(c.token))
  if (options.length === 1) return { kind: 'join', token: options[0].token }
  if (options.length > 1) return { kind: 'choose', options }
  return { kind: 'wait' }
}

export function waitingText(saved: SavedClass[]): string {
  return saved.length === 1
    ? `Waiting for ${saved[0].name} to start.`
    : `Waiting. Your classes: ${saved.map((c) => c.name).join(', ')}.`
}

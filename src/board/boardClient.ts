import type { Term } from '../core/types'

export const isFixtureMode = (search: string): boolean => new URLSearchParams(search).get('fixture') === '1'

export async function loadFixture(): Promise<Term[]> {
  const res = await fetch('/fixtures/board-fraction.json')
  if (!res.ok) throw new Error(`fixture load failed: ${res.status}`)
  return (await res.json()).terms
}

export async function readBoard(jpeg: Blob): Promise<Term[]> {
  const res = await fetch('/api/read-board', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `read-board failed: ${res.status}`)
  return body.terms
}

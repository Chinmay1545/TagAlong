import { timingSafeEqual } from 'node:crypto'

// Who may talk to the server. Locally: localhost only, no key. Hosted: the public domain
// (Railway sets RAILWAY_PUBLIC_DOMAIN) plus ALLOWED_HOSTS, and an ACCESS_KEY is required,
// so a stranger with the URL cannot spend the team's model and AWS credits.
export type Access = { hosts: Set<string>; key?: string; isPublic: boolean }

const LOCAL = ['127.0.0.1', 'localhost']
export const COOKIE = 'tagalong_key'
export const LOCAL_ACCESS: Access = { hosts: new Set(LOCAL), isPublic: false }

export function accessFromEnv(env: Record<string, string | undefined>): Access {
  const extra = [env.RAILWAY_PUBLIC_DOMAIN, ...(env.ALLOWED_HOSTS ?? '').split(',')]
    .map(h => h?.trim().toLowerCase())
    .filter((h): h is string => Boolean(h))
  const key = env.ACCESS_KEY?.trim() || undefined
  if (extra.length && !key) throw new Error('ACCESS_KEY must be set when serving a public domain (RAILWAY_PUBLIC_DOMAIN or ALLOWED_HOSTS)')
  return { hosts: new Set([...LOCAL, ...extra]), key, isPublic: extra.length > 0 }
}

// Host header without the port. Bracketed IPv6 hosts are never allowed, so they need no special case.
export const hostOf = (host: string | undefined): string => (host ?? '').toLowerCase().replace(/:\d+$/, '')

export const hostAllowed = (a: Access, host: string | undefined): boolean => a.hosts.has(hostOf(host))

export const originAllowed = (origin: string | undefined, a: Access = LOCAL_ACCESS): boolean => {
  if (!origin) return true // non-browser clients send no Origin
  try { return a.hosts.has(new URL(origin).hostname.toLowerCase()) } catch { return false }
}

export function keyMatches(given: string | undefined, key: string): boolean {
  if (!given) return false
  const a = Buffer.from(given), b = Buffer.from(key)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function cookieKey(header: string | undefined): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === COOKIE) {
      try { return decodeURIComponent(part.slice(i + 1).trim()) } catch { return undefined }
    }
  }
  return undefined
}

// No key configured (local) -> always allowed.
export const keyAllowed = (a: Access, cookieHeader: string | undefined): boolean =>
  !a.key || keyMatches(cookieKey(cookieHeader), a.key)

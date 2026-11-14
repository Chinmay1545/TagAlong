export type Route = { kind: 'phone'; token: string; name: string } | { kind: 'student' } | { kind: 'judge' }

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/

export function routeFor(pathname: string, search: string): Route {
  const params = new URLSearchParams(search)
  if (params.has('student')) return { kind: 'student' }
  const m = /^\/c\/([^/]+)\/?$/.exec(pathname)
  if (m && TOKEN.test(m[1])) return { kind: 'phone', token: m[1], name: params.get('n') || 'your class' }
  return { kind: 'judge' }
}

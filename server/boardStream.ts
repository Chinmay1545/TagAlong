import type { Term } from '../src/core/types'
import { toTerm } from './parseBoard'

// Incremental board-reply parser: push model text as it streams in, get back each term the moment
// its JSON object closes (an object at brace depth 2, i.e. inside {"terms":[ ... ]}). String-aware,
// so braces inside LaTeX strings do not count. Ids are numbered in arrival order, like parseBoardResponse.
export function createTermStream() {
  let depth = 0
  let inStr = false
  let esc = false
  let obj = '' // text of the term object being read, while depth >= 2
  let n = 0
  const take = (raw: string): Term | null => {
    try {
      const term = toTerm(JSON.parse(raw), n + 1)
      if (term) n++
      return term
    } catch { return null }
  }
  return {
    push(chunk: string): Term[] {
      const out: Term[] = []
      for (const c of chunk) {
        if (depth >= 2) obj += c
        if (inStr) {
          if (esc) esc = false
          else if (c === '\\') esc = true
          else if (c === '"') inStr = false
          continue
        }
        if (c === '"') inStr = true
        else if (c === '{') {
          depth++
          if (depth === 2) obj = '{'
        } else if (c === '}' && depth > 0) {
          depth--
          if (depth === 1) {
            const term = take(obj)
            if (term) out.push(term)
            obj = ''
          }
        }
      }
      return out
    },
    end(): Term[] { return [] },
  }
}

import type { Term } from '../src/core/types'
import { lineTerm, toTerm } from './parseBoard'

// Incremental board-reply parser: push model text as it streams in, get back each term the moment it is
// complete. Handles both reply formats at once:
//  - compact lines (latex|x|y|w|h): a term per finished line, the last line on end();
//  - older JSON: a term per object at brace depth 2 (inside {"terms":[ ... ]}), string-aware so braces
//    inside LaTeX strings do not count.
// A line never parses as a JSON term and a JSON fragment never parses as a line, so nothing is emitted twice.
// Ids are numbered in arrival order, like parseBoardResponse.
export function createTermStream() {
  let depth = 0
  let inStr = false
  let esc = false
  let obj = '' // text of the JSON term object being read, while depth >= 2
  let line = ''
  let n = 0
  const add = (out: Term[], term: Term | null) => { if (term) { n++; out.push(term) } }
  const jsonTerm = (raw: string): Term | null => {
    try { return toTerm(JSON.parse(raw), n + 1) } catch { return null }
  }
  return {
    push(chunk: string): Term[] {
      const out: Term[] = []
      for (const c of chunk) {
        if (c === '\n') { add(out, lineTerm(line, n + 1)); line = '' } else line += c
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
          if (depth === 1) { add(out, jsonTerm(obj)); obj = '' }
        }
      }
      return out
    },
    end(): Term[] {
      const out: Term[] = []
      add(out, lineTerm(line, n + 1))
      line = ''
      return out
    },
  }
}

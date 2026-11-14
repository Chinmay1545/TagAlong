// A bracketed sum or difference that is multiplied (next to a bracket, a number, "2x" or a times sign) is
// spoken "the quantity ...", so "3(x - 4) + 5" is not heard as "3x minus 4 plus 5". A comma closes the
// quantity when more follows. A lone "(x + 3)" is just "x plus 3". Markers are swapped for words at the end.
const OPEN = '\u0001', CLOSE = '\u0002', CLOSE_END = '\u0003'
function quantities(s: string): string {
  return s.replace(/\(([^()]*)\)/g, (m, inner: string, at: number) => {
    if (!/[+-]/.test(inner.trim().slice(1))) return m
    const before = s.slice(0, at), after = s.slice(at + m.length).trimStart()
    const gluedBefore = /(\d|\d[a-z])$/i.test(before) // "3(" and "2x(": a letter alone is a function, f(x)
    const multiplied = gluedBefore || /\)\s*$|[*×·]\s*$|\btimes\s*$/i.test(before) || /^[(*×·]/.test(after)
    if (!multiplied) return m
    const more = after !== '' && !after.startsWith(')')
    return `${gluedBefore ? ' times ' : ''}${OPEN}${inner}${more ? CLOSE : CLOSE_END}${after.startsWith('(') ? ' times ' : ''}`
  })
}

// Board phrase -> speakable English. Pure; hyphenated words ("well-known") stay untouched.
export function speakMath(phrase: string): string {
  return quantities(phrase)
    .replace(/√\s*/g, 'sqrt ')
    .replace(/sqrt\s*\(([^()]*)\)/gi, 'the square root of $1')
    .replace(/\bsqrt\s+/gi, 'the square root of ')
    .replace(/\)\s*\(/g, ') times (')
    .replace(/(\d[a-z]?)\s*\(/gi, '$1 times (') // 2(x+3), 2x(x+3): a number before a bracket multiplies
    .replace(/(\/[^=]*?)\s*=\s*/, '$1, equals ') // so does the comma before "equals" after a fraction
    .replace(/\)\s*\/\s*\(/g, '), over (') // a fraction: the comma marks where the top ends
    .replace(/\b([a-z])\(/gi, '$1 of ')
    .replace(/(\d)(?=[a-z])/gi, '$1 ')
    .replace(/\s+-\s+|(?<=\d|\)|(?<![a-z])[a-z])-(?=\d|\(|[a-z](?![a-z]))/gi, ' minus ') // letter-hyphen-letter only for single letters, so "top-left" survives
    .replace(/\^2|²/g, ' squared')
    .replace(/\^3|³/g, ' cubed')
    .replace(/\^(\w+)/g, ' to the $1')
    .replace(/\s*\+\s*/g, ' plus ')
    .replace(/\s*=\s*/g, ' equals ')
    .replace(/\s*\/\s*/g, ' over ')
    .replace(/\s*[*×·]\s*/g, ' times ')
    .replace(/[()]/g, '')
    .replace(new RegExp(`\\s*${CLOSE}\\s*`, 'g'), ', ').replace(new RegExp(CLOSE_END, 'g'), '').replace(new RegExp(OPEN, 'g'), 'the quantity ')
    .replace(/,(\s*,)+/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
}

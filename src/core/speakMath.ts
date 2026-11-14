// Board phrase -> speakable English. Pure; hyphenated words ("well-known") stay untouched.
export function speakMath(phrase: string): string {
  return phrase
    .replace(/√\s*/g, 'sqrt ')
    .replace(/sqrt\s*\(([^()]*)\)/gi, 'the square root of $1')
    .replace(/\bsqrt\s+/gi, 'the square root of ')
    .replace(/\)\s*\(/g, ') times (')
    .replace(/(\d[a-z]?)\s*\(/gi, '$1 times (') // 2(x+3), 2x(x+3): a number before a bracket multiplies
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
    .replace(/\s+/g, ' ')
    .trim()
}

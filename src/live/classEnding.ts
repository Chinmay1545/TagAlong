// "Only if needed" alerts: a blind student may not notice the class is ending (people packing up,
// the teacher giving homework on the way out). These phrases are the usual signs. Plain words only,
// so "today", "see" or "stop" on their own never count.
const ENDING = [
  /\b(that'?s|that is) (all|it) for (today|now|this week)\b/,
  /\b(we'?ll|we will|let'?s|let us) stop (here|there)\b/,
  /\bsee (you|y'all|everyone)( all)? (next|on|tomorrow|monday|tuesday|wednesday|thursday|friday)\b/,
  /\bclass (is )?dismissed\b/,
  /\b(we'?re|we are) (out of time|done for (today|now))\b/,
  /\bhomework\b/,
  /\bhave a (good|great|nice) (weekend|day|evening|break)\b/,
]

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ')

export const isClassEnding = (text: string): boolean => ENDING.some(re => re.test(norm(text)))

export const endingNotice = (said: string): string => `Class is wrapping up. The teacher said: ${said.trim()}`

// Which of the extra pointer detectors run. They are off unless the link asks for them (?laser=1, ?stick=1):
// a detector that has not been tried on the real board must not be able to steal the pointer from the finger.
// hand (open-hand gesture: the whole equation under an open hand) is the one that is on unless ?hand=0.
export type Tools = { laser: boolean; stick: boolean; hand: boolean }

export const toolsFor = (search: string): Tools => {
  const q = new URLSearchParams(search)
  return { laser: q.get('laser') === '1', stick: q.get('stick') === '1', hand: q.get('hand') !== '0' }
}

// Shown on the judge screen, so it is plain to see what can point right now.
export const pointersLabel = (tools: Tools, demo: boolean): string =>
  [demo && 'mouse', 'finger', tools.stick && 'stick', tools.laser && 'laser', tools.hand && 'open hand'].filter(Boolean).join(' + ')

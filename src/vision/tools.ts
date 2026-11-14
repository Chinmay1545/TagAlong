// Which of the extra pointer detectors run. They are off unless the link asks for them (?laser=1, ?stick=1):
// a detector that has not been tried on the real board must not be able to steal the pointer from the finger.
export type Tools = { laser: boolean; stick: boolean }

export const toolsFor = (search: string): Tools => {
  const q = new URLSearchParams(search)
  return { laser: q.get('laser') === '1', stick: q.get('stick') === '1' }
}

// Shown on the judge screen, so it is plain to see what can point right now.
export const pointersLabel = (tools: Tools, demo: boolean): string =>
  [demo && 'mouse', 'finger', tools.stick && 'stick', tools.laser && 'laser'].filter(Boolean).join(' + ')

import type { WordItem } from './words'

export function resultsToItems(
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>,
  arrivedAt: number,
  fromIndex = 0, // earlier results are already final and were sent before
  session = 0, // bumps on each auto-restart, when result indices restart at 0
): { items: WordItem[]; finals: string[] } {
  const items: WordItem[] = []
  const finals: string[] = []
  for (let i = fromIndex; i < results.length; i++) {
    const { isFinal } = results[i]
    const text = results[i][0].transcript.trim()
    if (isFinal && text) finals.push(text)
    for (const content of text.split(/\s+/).filter(Boolean)) items.push({ content, isPartial: !isFinal, arrivedAt, segment: session * 1_000_000 + i })
  }
  return { items, finals }
}

// No word timings from Web Speech: items carry arrivedAt only. Returns null if unsupported.
export function startWebSpeech(
  onItems: (items: WordItem[]) => void,
  onFinal: (text: string) => void,
  onError: (err: string) => void = () => {},
  Ctor: any = (globalThis as any).webkitSpeechRecognition || (globalThis as any).SpeechRecognition, // injectable for tests
): { stop(): void } | null {
  if (!Ctor) return null
  let stopped = false
  let session = 0
  const rec = new Ctor()
  rec.continuous = true
  rec.interimResults = true
  rec.lang = 'en-US'
  rec.onresult = (e: any) => {
    const { items } = resultsToItems(e.results, performance.now(), e.resultIndex, session)
    onItems(items)
    // only results newly finalised since resultIndex
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal) continue
      const text = e.results[i][0].transcript.trim()
      if (text) onFinal(text)
    }
  }
  rec.onerror = (e: any) => {
    if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) { stopped = true; onError(e.error) }
  }
  rec.onend = () => {
    if (stopped) return
    setTimeout(() => {
      if (stopped) return
      session++
      try { rec.start() } catch { /* already started */ }
    }, 250)
  }
  rec.start()
  return { stop() { stopped = true; rec.stop() } }
}

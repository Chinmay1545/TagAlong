import { describe, it, expect } from 'vitest'
import { resultsToItems } from '../src/speech/webSpeech'

const r = (isFinal: boolean, transcript: string) => ({ isFinal, 0: { transcript } })

describe('resultsToItems', () => {
  it('splits words, marks partial/final', () => {
    const { items, finals } = resultsToItems([r(true, ' put this '), r(false, 'over there')], 5)
    expect(items.map(i => [i.content, i.isPartial, i.arrivedAt, i.startTime])).toEqual([
      ['put', false, 5, undefined], ['this', false, 5, undefined],
      ['over', true, 5, undefined], ['there', true, 5, undefined],
    ])
    expect(finals).toEqual(['put this'])
  })
})

import { detectPointerWords } from '../src/speech/words'
describe('web speech + detectPointerWords', () => {
  it('fires this, that, this with no duplicates', () => {
    const seen = new Set<string>()
    const e1 = resultsToItems([r(false, 'this cancels')], 1, 0).items
    const res2 = [r(true, 'this cancels with that'), r(false, 'this')]
    const e2 = resultsToItems(res2, 2, 0).items
    const words = [...detectPointerWords(e1, seen, null), ...detectPointerWords(e2, seen, null)].map(e => e.word)
    expect(words).toEqual(['this', 'that', 'this'])
  })
})

import { vi, beforeEach, afterEach } from 'vitest'
import { startWebSpeech } from '../src/speech/webSpeech'

describe('resultsToItems fromIndex', () => {
  it('omits earlier results', () => {
    const { items } = resultsToItems([r(true, 'a b'), r(false, 'c')], 1, 1)
    expect(items.map(i => i.content)).toEqual(['c'])
  })
})

describe('startWebSpeech', () => {
  let recs: any[]
  class Fake {
    continuous = false; interimResults = false; lang = ''
    started = 0; stopped = 0
    onresult: any; onend: any; onerror: any
    constructor() { recs.push(this) }
    start() { this.started++ }
    stop() { this.stopped++ }
  }
  beforeEach(() => { recs = []; vi.useFakeTimers() })
  afterEach(() => vi.useRealTimers())
  const mk = (onItems = vi.fn(), onError = vi.fn()) => ({ onItems, onError, h: startWebSpeech(onItems, () => {}, onError, Fake as any)! })

  it('restarts once after plain end, with delay', () => {
    mk()
    recs[0].onend()
    expect(recs[0].started).toBe(1)
    vi.advanceTimersByTime(250)
    expect(recs[0].started).toBe(2)
  })
  it('fatal error: no restart, onError called', () => {
    const { onError } = mk()
    recs[0].onerror({ error: 'not-allowed' }); recs[0].onend()
    vi.advanceTimersByTime(1000)
    expect(recs[0].started).toBe(1)
    expect(onError).toHaveBeenCalledWith('not-allowed')
  })
  it('stop() prevents restart', () => {
    const { h } = mk()
    h.stop(); recs[0].onend()
    vi.advanceTimersByTime(1000)
    expect(recs[0].started).toBe(1)
  })
  it('same segment index in a new session still fires', () => {
    const onItems = vi.fn()
    mk(onItems)
    const seen = new Set<string>()
    const fire = () => detectPointerWords(onItems.mock.calls.at(-1)![0], seen, null).length
    recs[0].onresult({ resultIndex: 0, results: [r(false, 'this')] })
    expect(fire()).toBe(1)
    recs[0].onend(); vi.advanceTimersByTime(250)
    recs[0].onresult({ resultIndex: 0, results: [r(false, 'this')] })
    expect(fire()).toBe(1)
  })
})

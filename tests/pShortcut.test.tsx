// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { FIXTURE, mountJudge, unmountJudge } from './helpers/judgeHarness'

afterEach(unmountJudge)

// 2.6: if the microphone or speech recognition fails in a noisy hall, the P key says "this" for the teacher.
// It goes down the same path as a spoken word, so it needs a pointer resting on the board too.
describe('P key: backup for "this" when the mic fails', () => {
  it('with the pointer resting on a term, P whispers that term (no microphone involved)', async () => {
    const j = await mountJudge('?demo=1')
    j.mouseTo(0.25, 0.27)
    await j.wait(320)
    await j.key('p')
    expect(j.fakes.play).toHaveBeenCalledTimes(1)
    expect(j.fakes.play.mock.calls[0][0].terms).toEqual([FIXTURE[0]])
    expect(j.log()[0]).toMatch(/^this → the 2x on top left · \d/)
  })
  it('capital P works too', async () => {
    const j = await mountJudge('?demo=1')
    j.mouseTo(0.5, 0.67)
    await j.wait(320)
    await j.key('P')
    expect(j.fakes.play.mock.calls[0][0].terms).toEqual([FIXTURE[2]])
  })
  it('with nothing pointing, P is silent', async () => {
    const j = await mountJudge('?demo=1')
    await j.key('p')
    expect(j.fakes.play).not.toHaveBeenCalled()
    expect(j.log()).toEqual(['this → silent'])
  })
  it('with the pointer resting on empty board, P is silent', async () => {
    const j = await mountJudge('?demo=1')
    j.mouseTo(0.9, 0.9)
    await j.wait(320)
    await j.key('p')
    expect(j.log()).toEqual(['this → silent'])
  })
  it('after the mouse leaves the board, P is silent', async () => {
    const j = await mountJudge('?demo=1')
    j.mouseTo(0.25, 0.27)
    await j.wait(320)
    j.mouseAway()
    await j.wait(700)
    await j.key('p')
    expect(j.log()).toEqual(['this → silent'])
  })
  it('each press is one event; holding the key down does not repeat', async () => {
    const j = await mountJudge('?demo=1')
    j.mouseTo(0.25, 0.27)
    await j.wait(320)
    await j.key('p')
    await j.key('p', { repeat: true })
    await j.key('p')
    expect(j.log()).toHaveLength(2)
  })
  it('typing a p into a text box does nothing', async () => {
    const j = await mountJudge('?demo=1')
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'p', bubbles: true })
    expect(j.log()).toEqual([])
    input.remove()
  })
  it('works in live mode on terms read from the camera', async () => {
    const j = await mountJudge('')
    await j.wait(0)
    j.fakes.setTerms!(FIXTURE)
    for (let i = 0; i < 12; i++) { j.fakes.pushPoint!({ kind: 'finger', x: 0.55, y: 0.27, confidence: 1, t: performance.now() }); await j.wait(30) }
    await j.key('p')
    expect(j.fakes.play.mock.calls[0][0].terms).toEqual([FIXTURE[1]])
  })
})

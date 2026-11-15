// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent } from '@testing-library/react'
import { FIXTURE, STAGE, mountJudge, unmountJudge } from './helpers/judgeHarness'
import { RECHECK_MS } from '../src/core/config'

afterEach(unmountJudge)

describe('judge screen: demo mode and live mode', () => {
  it('demo (?demo=1): the saved photo with its saved boxes, and no camera board reads', async () => {
    const j = await mountJudge('?demo=1')
    expect(j.container.querySelector('.vf-src')!.textContent).toBe('DEMO')
    expect(j.container.querySelector('img.demo-photo')).not.toBeNull()
    expect(j.stat('terms')).toBe(String(FIXTURE.length))
    expect(j.fakes.startBoardLoop).not.toHaveBeenCalled()
    expect(j.fakes.startCamera).toHaveBeenCalledTimes(1) // a real hand can still point at the photo
  })
  it('?fixture=1 is demo mode too', async () => {
    const j = await mountJudge('?fixture=1')
    expect(j.container.querySelector('.vf-src')!.textContent).toBe('DEMO')
  })
  it('live (no flag): the camera picture, no saved photo, boxes only from board reads', async () => {
    const j = await mountJudge('')
    expect(j.container.querySelector('.vf-src')!.textContent).toBe('LIVE')
    expect(j.container.querySelector('img.demo-photo')).toBeNull()
    expect(j.stat('terms')).toBe('0')
    expect(j.fakes.startBoardLoop).toHaveBeenCalledTimes(1)
    await act(async () => { j.fakes.setTerms!(FIXTURE.slice(0, 2)) })
    expect(j.stat('terms')).toBe('2')
  })
  it('live can be mirrored with ?mirror=1; the demo photo never is', async () => {
    const live = await mountJudge('?mirror=1')
    expect(live.container.querySelector('video')!.className).toBe('mirror')
    unmountJudge()
    const demo = await mountJudge('?demo=1&mirror=1')
    expect(demo.container.querySelector('video')!.className).toBe('behind-photo')
  })
  it('draws a box label for every term', async () => {
    const j = await mountJudge('?demo=1')
    await j.redraw()
    for (const t of FIXTURE) expect(j.fakes.texts).toContain(t.phrase)
  })
})

describe('judge screen: groups on the overlay', () => {
  const GROUP = { id: 9, latex: '', phrase: 'the top of the fraction: 2x times x plus 3', box: { x: 0.2, y: 0.2, w: 0.45, h: 0.15 } }
  it('a group is not labelled (and not counted in TERMS) until it is the one just resolved', async () => {
    const j = await mountJudge('')
    await act(async () => { j.fakes.setTerms!([...FIXTURE, GROUP]) })
    expect(j.stat('terms')).toBe('3')
    await j.redraw()
    expect(j.fakes.texts).toContain(FIXTURE[0].phrase)
    expect(j.fakes.texts).not.toContain(GROUP.phrase)
    expect(j.fakes.boxes).toBe(FIXTURE.length) // no group box either
    for (let i = 0; i < 12; i++) { j.fakes.pushPoint!({ kind: 'finger', x: 0.375, y: 0.27, confidence: 1, t: performance.now() }); await j.wait(30) }
    await act(async () => { window.__tt!.say('this top part') })
    await j.wait(400)
    expect(j.log()[0]).toMatch(/^this → the top of the fraction: 2x times x plus 3/)
    await j.redraw()
    expect(j.fakes.texts).toContain(GROUP.phrase)
    expect(j.fakes.boxes).toBe(FIXTURE.length + 1)
  })
})

describe('judge screen: reset button', () => {
  it('live: asks the board loop to start again and the boxes go at once', async () => {
    const j = await mountJudge('')
    await act(async () => { j.fakes.setTerms!(FIXTURE) })
    expect(j.stat('terms')).toBe('3')
    await act(async () => { fireEvent.click(j.getByRole('button', { name: 'Reset board' })) })
    expect(j.fakes.boardReset).toHaveBeenCalledTimes(1)
    expect(j.stat('terms')).toBe('0')
    await j.redraw()
    expect(j.fakes.texts).not.toContain(FIXTURE[0].phrase)
  })
  it('demo: clears the saved boxes, and pointing then finds nothing', async () => {
    const j = await mountJudge('?demo=1')
    await act(async () => { fireEvent.click(j.getByRole('button', { name: 'Reset board' })) })
    expect(j.stat('terms')).toBe('0')
    j.mouseTo(0.25, 0.27)
    await j.wait(320)
    await j.key('p')
    expect(j.log()).toEqual(['this → silent'])
  })
  it('reset drops the highlight of the last resolved term', async () => {
    const j = await mountJudge('')
    await act(async () => { j.fakes.setTerms!(FIXTURE) })
    for (let i = 0; i < 12; i++) { j.fakes.pushPoint!({ kind: 'finger', x: 0.25, y: 0.27, confidence: 1, t: performance.now() }); await j.wait(30) }
    await act(async () => { window.__tt!.say('this top part') })
    await j.wait(400)
    expect(j.log()[0]).toMatch(/^this → the 2x on top left/)
    await act(async () => { fireEvent.click(j.getByRole('button', { name: 'Reset board' })) })
    await act(async () => { j.fakes.setTerms!(FIXTURE) }) // the board is read again
    expect(j.stat('terms')).toBe('3')
  })
})

describe('judge screen: with / without app', () => {
  it('starts with the app on; the switch turns the whisper off and on', async () => {
    const j = await mountJudge('?demo=1')
    const sw = j.getByRole('button', { name: 'Without app' })
    expect(sw.getAttribute('aria-pressed')).toBe('false')
    await act(async () => { fireEvent.click(sw) })
    expect(sw.getAttribute('aria-pressed')).toBe('true')
    expect(j.fakes.setEnabled).toHaveBeenLastCalledWith(false)
    expect(window.__tt!.state().withoutApp).toBe(true)
    await act(async () => { fireEvent.click(sw) })
    expect(sw.getAttribute('aria-pressed')).toBe('false')
    expect(j.fakes.setEnabled).toHaveBeenLastCalledWith(true)
  })
  it('the W key does the same', async () => {
    const j = await mountJudge('?demo=1')
    await j.key('w')
    expect(j.getByRole('button', { name: 'Without app' }).getAttribute('aria-pressed')).toBe('true')
    expect(j.fakes.setEnabled).toHaveBeenLastCalledWith(false)
    await j.key('w')
    expect(j.fakes.setEnabled).toHaveBeenLastCalledWith(true)
  })
  it('without the app, a pointer word is still resolved but shown as muted, not whispered', async () => {
    const j = await mountJudge('?demo=1')
    await j.key('w')
    j.mouseTo(0.25, 0.27)
    await j.wait(320)
    await j.key('p')
    expect(j.log()).toEqual(['this → the 2x on top left · muted'])
    await j.key('w')
    await act(async () => { window.__tt!.say('this top part') })
    await j.wait(400)
    expect(j.log()[0]).toMatch(/^this → the 2x on top left · \d/)
  })
})

describe('judge screen: pointer dot and label', () => {
  const finger = (x: number, y: number) => ({ kind: 'finger' as const, x, y, confidence: 1, t: performance.now() })
  const laser = (x: number, y: number) => ({ kind: 'laser' as const, x, y, confidence: 1, t: performance.now() })
  const stick = (x: number, y: number) => ({ kind: 'stick' as const, x, y, confidence: 1, t: performance.now() })
  const KINDS = ['finger', 'stick', 'laser', 'mouse']
  const labels = (j: { fakes: { texts: string[] } }) => [...new Set(j.fakes.texts.filter(t => KINDS.includes(t)))]

  it('no pointer: no dot and no label', async () => {
    const j = await mountJudge('')
    await j.redraw()
    expect(labels(j)).toEqual([])
    expect(j.fakes.arcs).toEqual([])
  })
  it('a fingertip gets a dot labelled "finger", at the fingertip', async () => {
    const j = await mountJudge('')
    j.fakes.pushPoint!(finger(0.25, 0.5))
    await j.redraw()
    expect(labels(j)).toEqual(['finger'])
    expect(j.fakes.arcs.at(-1)!.slice(0, 2)).toEqual([0.25 * STAGE.width, 0.5 * STAGE.height])
  })
  it('a stick tip is labelled "stick" and wins over the hand that holds it', async () => {
    const j = await mountJudge('')
    for (let i = 0; i < 4; i++) { j.fakes.pushPoint!(finger(0.8, 0.8)); j.fakes.pushPoint!(stick(0.3, 0.2)) }
    await j.redraw()
    expect(labels(j)).toEqual(['stick'])
    expect(j.fakes.arcs.at(-1)!.slice(0, 2)).toEqual([0.3 * STAGE.width, 0.2 * STAGE.height])
  })
  it('a laser dot is labelled "laser" and wins over stick and finger', async () => {
    const j = await mountJudge('')
    for (let i = 0; i < 4; i++) { j.fakes.pushPoint!(finger(0.8, 0.8)); j.fakes.pushPoint!(stick(0.3, 0.2)); j.fakes.pushPoint!(laser(0.6, 0.4)) }
    await j.redraw()
    expect(labels(j)).toEqual(['laser'])
  })
  it('the dot goes away half a second after the pointer does', async () => {
    const j = await mountJudge('')
    j.fakes.pushPoint!(finger(0.25, 0.5))
    await j.wait(650)
    await j.redraw()
    expect(labels(j)).toEqual([])
  })
  it('demo mode: the mouse is the pointer, labelled "mouse"', async () => {
    const j = await mountJudge('?demo=1')
    j.mouseTo(0.5, 0.5)
    await j.redraw()
    expect(labels(j)).toEqual(['mouse'])
    expect(j.fakes.arcs.at(-1)!.slice(0, 2)).toEqual([0.5 * STAGE.width, 0.5 * STAGE.height])
  })
  it('live mode: the mouse is not a pointer', async () => {
    const j = await mountJudge('')
    j.mouseTo(0.5, 0.5)
    await j.redraw()
    expect(labels(j)).toEqual([])
  })
  it('mirrored live view: the dot is drawn on the mirrored side', async () => {
    const j = await mountJudge('?mirror=1')
    j.fakes.pushPoint!(finger(0.25, 0.5))
    await j.redraw()
    expect(j.fakes.arcs.at(-1)![0]).toBeCloseTo(0.75 * STAGE.width)
  })
})

describe('judge screen: laser and stick detectors are off unless the link turns them on', () => {
  const tools = (j: { fakes: { startToolTracker: { mock: { calls: unknown[][] } } } }) => j.fakes.startToolTracker.mock.calls[0]?.[3]
  const status = (j: { container: HTMLElement }) => j.container.querySelector('.status')!.textContent

  it('a plain link: finger only', async () => {
    const j = await mountJudge('')
    expect(tools(j)).toEqual({ laser: false, stick: false })
    expect(status(j)).toContain('pointers · finger')
    expect(status(j)).not.toContain('laser')
    expect(status(j)).not.toContain('stick')
  })
  it('?laser=1: the laser detector runs and the screen says so', async () => {
    const j = await mountJudge('?laser=1')
    expect(tools(j)).toEqual({ laser: true, stick: false })
    expect(status(j)).toContain('pointers · finger + laser')
  })
  it('?stick=1: the stick detector runs and the screen says so', async () => {
    const j = await mountJudge('?stick=1')
    expect(tools(j)).toEqual({ laser: false, stick: true })
    expect(status(j)).toContain('pointers · finger + stick')
  })
  it('both, in demo mode', async () => {
    const j = await mountJudge('?demo=1&laser=1&stick=1')
    expect(tools(j)).toEqual({ laser: true, stick: true })
    expect(status(j)).toContain('pointers · mouse + finger + stick + laser')
  })
  it('a plain demo link: mouse and finger', async () => {
    const j = await mountJudge('?demo=1')
    expect(status(j)).toContain('pointers · mouse + finger')
  })
})

describe('judge screen: a word waiting for its second look is dropped on reset and on close', () => {
  it('Reset board during the wait: no log line appears afterwards', async () => {
    const j = await mountJudge('?demo=1')
    await j.key('p') // nothing pointing: waits to look once more
    await act(async () => { fireEvent.click(j.getByRole('button', { name: 'Reset board' })) })
    await j.wait(RECHECK_MS + 150)
    expect(j.log()).toEqual([])
    expect(j.fakes.play).not.toHaveBeenCalled()
  })
  it('closing the screen during the wait: nothing is whispered afterwards', async () => {
    const j = await mountJudge('?demo=1')
    j.mouseTo(0.9, 0.9)
    await j.wait(60)
    j.mouseTo(0.25, 0.27)
    await j.wait(40)
    await j.key('p') // the mouse has just landed on a term: waits
    j.unmount()
    await new Promise(r => setTimeout(r, RECHECK_MS + 150))
    expect(j.fakes.play).not.toHaveBeenCalled()
  })
  it('without a reset the same press does produce its line (the wait itself works)', async () => {
    const j = await mountJudge('?demo=1')
    await j.key('p')
    await j.wait(RECHECK_MS + 150)
    expect(j.log()).toEqual(['this → silent'])
  })
})

describe('judge screen: board lock and reading indicator', () => {
  it('F locks the board (pill shown, legend lists it), F again unlocks, Reset unlocks', async () => {
    const j = await mountJudge('')
    const pill = () => j.container.querySelector('.vf-lock')!.textContent
    expect(j.container.querySelector('.kbd-strip')!.textContent).toContain('lock board')
    expect(pill()).toBe('')
    await j.key('f')
    expect(pill()).toBe('Board locked')
    await j.key('F')
    expect(pill()).toBe('')
    await j.key('f')
    expect(pill()).toBe('Board locked')
    fireEvent.click([...j.container.querySelectorAll('button')].find(b => b.textContent === 'Reset board')!)
    expect(pill()).toBe('')
  })
  it('shows "Reading the board" (aria-hidden) while a read is in flight', async () => {
    const j = await mountJudge('')
    const bar = () => j.container.querySelector('.vf-reading') as HTMLElement
    expect(bar().getAttribute('aria-hidden')).toBe('true')
    expect(bar().classList.contains('on')).toBe(false)
    j.fakes.reading = true
    await j.wait(600)
    expect(bar().classList.contains('on')).toBe(true)
    expect(bar().textContent).toBe('Reading the board')
    j.fakes.reading = false
    await j.wait(600)
    expect(bar().classList.contains('on')).toBe(false)
  })
})

describe('judge screen: H switches the open-hand gesture', () => {
  const status = (j: { container: HTMLElement }) => j.container.querySelector('.status')!.textContent
  it('on by default, H toggles the label, ?hand=0 starts off', async () => {
    const j = await mountJudge('')
    expect(status(j)).toContain('open hand')
    expect(j.container.querySelector('.kbd-strip')!.textContent).toContain('open hand')
    await act(async () => { fireEvent.keyDown(window, { key: 'h' }) })
    expect(status(j)).not.toContain('open hand')
    await act(async () => { fireEvent.keyDown(window, { key: 'H' }) })
    expect(status(j)).toContain('open hand')
    unmountJudge()
    const off = await mountJudge('?hand=0')
    expect(status(off)).not.toContain('open hand')
  })
})

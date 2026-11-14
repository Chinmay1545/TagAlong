import { vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { Resolution, Term } from '../../src/core/types'
import type { PointerPoint } from '../../src/vision/pointer'

// Mounts the real judge screen in a fake browser (jsdom). The camera, hand tracker, pointer detectors,
// board reads and audio are faked; everything else (the live path, the resolver, the UI) is real.
// The file that uses this must start with: // @vitest-environment jsdom

export const FIXTURE: Term[] = [
  { id: 1, latex: '2x', phrase: 'the 2x on top left', box: { x: 0.2, y: 0.2, w: 0.1, h: 0.15 } },
  { id: 2, latex: '(x+3)', phrase: 'the x plus 3 on top', box: { x: 0.45, y: 0.2, w: 0.2, h: 0.15 } },
  { id: 3, latex: '2x', phrase: 'the 2x on the bottom', box: { x: 0.45, y: 0.6, w: 0.1, h: 0.15 } },
]
export const STAGE = { width: 800, height: 400 }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// search: the page address after "/", for example "?demo=1". The mode is read when the screen loads.
export async function mountJudge(search = '') {
  vi.resetModules()
  window.history.replaceState({}, '', '/' + search)

  let enabled = true
  const fakes = {
    play: vi.fn((_r: Resolution) => (enabled ? { startedAt: performance.now() + 5 } : null)),
    setEnabled: vi.fn((on: boolean) => { enabled = on }),
    startBoardLoop: vi.fn(),
    boardReset: vi.fn(),
    startCamera: vi.fn(async () => {}),
    setTerms: null as null | ((t: Term[]) => void), // live mode: what a board read would hand over
    pushPoint: null as null | ((p: PointerPoint) => void), // what the hand tracker / detectors would report
    texts: [] as string[], // every label drawn on the overlay
    arcs: [] as number[][], // every dot drawn on the overlay: [x, y, r]
  }
  vi.doMock('../../src/vision/camera', async orig => ({ ...(await orig<object>()), startCamera: fakes.startCamera }))
  vi.doMock('../../src/vision/wakeLock', () => ({ keepScreenAwake: () => () => {} }))
  vi.doMock('../../src/vision/handTracker', () => ({
    startHandTracker: async (_v: unknown, onTip: (p: PointerPoint) => void) => { fakes.pushPoint = onTip; return () => {} },
  }))
  vi.doMock('../../src/vision/toolTracker', () => ({ DETECT_WIDTH: 480, startToolTracker: () => () => {} }))
  vi.doMock('../../src/board/boardClient', async orig => ({ ...(await orig<object>()), loadFixture: async () => FIXTURE }))
  vi.doMock('../../src/board/boardLoop', async orig => ({
    ...(await orig<object>()),
    startBoardLoop: (_v: unknown, _tips: unknown, onTerms: (t: Term[]) => void) => {
      fakes.startBoardLoop()
      fakes.setTerms = onTerms
      return { stop: () => {}, reset: () => { fakes.boardReset(); onTerms([]) }, pendingRegion: () => null }
    },
  }))
  vi.doMock('../../src/audio/whisper', async orig => ({
    ...(await orig<object>()),
    createWhisperPlayer: () => ({ play: fakes.play, setEnabled: fakes.setEnabled, prepare: async () => {}, unlock: () => {} }),
  }))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))

  // jsdom has no canvas: a stand-in context that accepts every call and remembers labels and dots.
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (store, key: string) => {
      if (key === 'fillText') return (s: string) => { fakes.texts.push(s) }
      if (key === 'arc') return (...a: number[]) => { fakes.arcs.push(a.slice(0, 3)) }
      if (key === 'measureText') return (s: string) => ({ width: s.length * 6 })
      return key in store ? store[key] : () => {}
    },
    set: (store, key: string, v) => { store[key] = v; return true },
  })
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => STAGE.width })
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, get: () => STAGE.height })

  const { JudgeScreen } = await import('../../src/ui/JudgeScreen')
  const view = render(<JudgeScreen />)
  await act(() => sleep(30)) // startup: fixture load, camera, trackers
  const stage = view.container.querySelector('.stage') as HTMLElement
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, right: STAGE.width, bottom: STAGE.height, x: 0, y: 0, ...STAGE, toJSON: () => ({}) })

  const mouse = (type: string, x: number, y: number) =>
    fireEvent(stage, new MouseEvent(type, { bubbles: true, clientX: x * STAGE.width, clientY: y * STAGE.height }))
  return {
    ...view,
    fakes,
    stage,
    wait: (ms: number) => act(() => sleep(ms)),
    // Demo mode: put the mouse at board position (x, y) and leave it there.
    mouseTo: (x: number, y: number) => mouse('pointermove', x, y),
    // React turns a pointer leaving the element (pointerout to outside) into onPointerLeave.
    mouseAway: () => fireEvent.pointerOut(stage),
    key: (key: string, init: KeyboardEventInit = {}) => act(() => { fireEvent.keyDown(window, { key, ...init }) }),
    log: () => window.__tt!.state().log,
    // The number shown in the stats strip under a label such as "terms".
    stat: (label: string) => [...view.container.querySelectorAll('.stats dt')].find(dt => dt.textContent === label)?.nextElementSibling?.textContent ?? null,
    // Forget what was drawn so far, then wait for fresh frames.
    redraw: async () => { fakes.texts.length = 0; fakes.arcs.length = 0; await act(() => sleep(60)) },
  }
}

export function unmountJudge() {
  cleanup()
  vi.unstubAllGlobals()
  vi.doUnmock('../../src/vision/camera')
  vi.doUnmock('../../src/vision/wakeLock')
  vi.doUnmock('../../src/vision/handTracker')
  vi.doUnmock('../../src/vision/toolTracker')
  vi.doUnmock('../../src/board/boardClient')
  vi.doUnmock('../../src/board/boardLoop')
  vi.doUnmock('../../src/audio/whisper')
}

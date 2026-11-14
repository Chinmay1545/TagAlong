import { describe, it, expect, vi, afterEach } from 'vitest'
import { startCamera } from '../src/vision/camera'
import { keepScreenAwake } from '../src/vision/wakeLock'

afterEach(() => vi.unstubAllGlobals())

const fakeVideo = () => ({ play: vi.fn(async () => {}) }) as unknown as HTMLVideoElement

describe('startCamera', () => {
  it('asks for the rear camera so a phone on a tripod faces the board', async () => {
    const getUserMedia = vi.fn(async () => ({}) as MediaStream)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    await startCamera(fakeVideo())
    const video = (getUserMedia.mock.calls[0] as unknown as [MediaStreamConstraints])[0].video as MediaTrackConstraints
    // "ideal", not "exact": a laptop with only a front camera must still open it
    expect(video.facingMode).toEqual({ ideal: 'environment' })
  })
})

// Fake Wake Lock API: records requests and lets a test drop the lock like iOS does when the page is hidden.
function wakeHarness() {
  const listeners: (() => void)[] = []
  const doc = { visibilityState: 'visible', addEventListener: (_: string, f: () => void) => listeners.push(f), removeEventListener: vi.fn() }
  const locks: { released: boolean; release: () => Promise<void> }[] = []
  const request = vi.fn(async () => {
    const lock = { released: false, release: async () => { lock.released = true } }
    locks.push(lock)
    return lock
  })
  vi.stubGlobal('document', doc)
  vi.stubGlobal('navigator', { wakeLock: { request } })
  const flush = () => new Promise(r => setTimeout(r, 0))
  const showPage = async () => { doc.visibilityState = 'visible'; listeners.forEach(f => f()); await flush() }
  return { request, locks, flush, showPage }
}

describe('keepScreenAwake', () => {
  it('holds a screen wake lock so the phone does not auto-lock on the tripod', async () => {
    const h = wakeHarness()
    keepScreenAwake()
    await h.flush()
    expect(h.request).toHaveBeenCalledWith('screen')
  })

  it('takes the lock again when the page comes back (iOS drops it when hidden)', async () => {
    const h = wakeHarness()
    keepScreenAwake()
    await h.flush()
    h.locks[0].released = true
    await h.showPage()
    expect(h.request).toHaveBeenCalledTimes(2)
  })

  it('releases the lock when stopped', async () => {
    const h = wakeHarness()
    const stop = keepScreenAwake()
    await h.flush()
    stop()
    expect(h.locks[0].released).toBe(true)
  })

  it('does nothing in browsers without the Wake Lock API', () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    expect(() => keepScreenAwake()()).not.toThrow()
  })
})

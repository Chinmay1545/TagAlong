import { describe, it, expect, vi, beforeEach } from 'vitest'
import { connectTranscribe } from '../src/speech/transcribeClient'

let sock: any
class FakeWS {
  static OPEN = 1
  readyState = 1
  binaryType = ''
  onopen: any; onclose: any; onerror: any; onmessage: any
  constructor() { sock = this }
  send() {}
  close() {}
}
beforeEach(() => { vi.stubGlobal('WebSocket', FakeWS) })

describe('connectTranscribe', () => {
  it('calls onError("closed") when the socket closes after open', () => {
    const onError = vi.fn()
    connectTranscribe('ws://x', () => {}, () => {}, onError)
    sock.onopen()
    sock.onclose()
    expect(onError).toHaveBeenCalledWith('closed')
  })
  it('does not double-report after a server error message', () => {
    const onError = vi.fn()
    connectTranscribe('ws://x', () => {}, () => {}, onError)
    sock.onopen()
    sock.onmessage({ data: JSON.stringify({ type: 'error', error: 'audio backlog' }) })
    sock.onclose()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('audio backlog')
  })
  it('close before open is left to ready rejection', () => {
    const onError = vi.fn()
    connectTranscribe('ws://x', () => {}, () => {}, onError)
    sock.onclose()
    expect(onError).not.toHaveBeenCalled()
  })
})

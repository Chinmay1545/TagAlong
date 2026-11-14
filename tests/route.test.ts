import { describe, it, expect } from 'vitest'
import { pickView } from '../src/ui/route'

describe('pickView', () => {
  it('a saved course link opens the student phone view', () =>
    expect(pickView('?student&room=math201&t=tok')).toEqual({ view: 'room-student', room: 'math201', token: 'tok' }))
  it('plain ?student keeps the same-device student view', () => expect(pickView('?student=1')).toEqual({ view: 'student' }))
  it('everything else is the camera / teacher view', () => {
    expect(pickView('')).toEqual({ view: 'judge' })
    expect(pickView('?demo=1')).toEqual({ view: 'judge' })
  })
  it('a link with a bad room name or no token falls back to the same-device view', () => {
    expect(pickView('?student&room=Math%20201&t=tok')).toEqual({ view: 'student' })
    expect(pickView('?student&room=math201')).toEqual({ view: 'student' })
  })
})

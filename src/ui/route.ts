import { isRoomName } from '../live/roomProtocol'

// Which screen a URL opens. ?student&room=..&t=.. is a student's saved course link (their own phone,
// classroom relay); plain ?student is the same-device student tab; anything else is the camera / teacher view.
export type View = { view: 'judge' } | { view: 'student' } | { view: 'room-student'; room: string; token: string }

export function pickView(search: string): View {
  const q = new URLSearchParams(search)
  if (!q.has('student')) return { view: 'judge' }
  const room = q.get('room'), token = q.get('t')
  return isRoomName(room) && token ? { view: 'room-student', room, token } : { view: 'student' }
}

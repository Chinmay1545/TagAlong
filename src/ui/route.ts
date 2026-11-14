import { isRoomName } from '../live/roomProtocol'

// Which screen a URL opens. ?student&room=..&t=.. is a student's saved course link (their own phone,
// classroom relay, optional n = display name); ?classes is the phone's home screen; plain ?student is the same-device student tab; anything else is the camera / teacher view.
export type View = { view: 'judge' } | { view: 'student' } | { view: 'room-student'; room: string; token: string; name?: string } | { view: 'phone-home' }

export function pickView(search: string): View {
  const q = new URLSearchParams(search)
  if (q.has('classes')) return { view: 'phone-home' }
  if (!q.has('student')) return { view: 'judge' }
  const room = q.get('room'), token = q.get('t')
  if (!isRoomName(room) || !token) return { view: 'student' }
  const name = q.get('n')
  return name ? { view: 'room-student', room, token, name } : { view: 'room-student', room, token }
}

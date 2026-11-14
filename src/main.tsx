import { createRoot } from 'react-dom/client'
import { JudgeScreen } from './ui/JudgeScreen'
import { StudentView } from './ui/StudentView'
import { RoomStudentView } from './ui/RoomStudentView'
import { PhoneHome } from './phone/PhoneHome'
import { classLabel, saveClass } from './phone/classes'
import { pickView } from './ui/route'

const v = pickView(location.search)
// Opening a course link keeps it on this phone, so the home-screen app can find it later.
if (v.view === 'room-student') {
  try { saveClass(localStorage, { room: v.room, token: v.token, label: classLabel(v.room, v.name) }) } catch { /* storage blocked */ }
}
createRoot(document.getElementById('root')!).render(
  v.view === 'room-student' ? <RoomStudentView room={v.room} token={v.token} />
    : v.view === 'phone-home' ? <PhoneHome />
    : v.view === 'student' ? <StudentView /> : <JudgeScreen />,
)

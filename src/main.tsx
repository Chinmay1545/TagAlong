import { createRoot } from 'react-dom/client'
import { JudgeScreen } from './ui/JudgeScreen'
import { StudentView } from './ui/StudentView'
import { RoomStudentView } from './ui/RoomStudentView'
import { pickView } from './ui/route'

const v = pickView(location.search)
createRoot(document.getElementById('root')!).render(
  v.view === 'room-student' ? <RoomStudentView room={v.room} token={v.token} /> : v.view === 'student' ? <StudentView /> : <JudgeScreen />,
)

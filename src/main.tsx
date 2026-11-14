import { createRoot } from 'react-dom/client'
import { JudgeScreen } from './ui/JudgeScreen'
import { StudentView } from './ui/StudentView'
import { PhoneApp } from './phone/PhoneApp'
import { routeFor } from './phone/route'

const r = routeFor(location.pathname, location.search)
createRoot(document.getElementById('root')!).render(
  r.kind === 'phone' ? <PhoneApp token={r.token} name={r.name} /> : r.kind === 'student' ? <StudentView /> : <JudgeScreen />,
)

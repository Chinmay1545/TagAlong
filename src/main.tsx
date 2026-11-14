import { createRoot } from 'react-dom/client'
import { JudgeScreen } from './ui/JudgeScreen'
import { StudentView } from './ui/StudentView'

const student = new URLSearchParams(location.search).has('student')
createRoot(document.getElementById('root')!).render(student ? <StudentView /> : <JudgeScreen />)

import express from 'express'

// On-demand help: the student asks "what is happening?" and hears one or two short sentences about the room.
export const SCENE_PROMPT = `You are helping a blind student in a classroom. The student just asked: "What is happening right now?"
Look at this camera picture of the classroom and answer in at most two short sentences, in plain words.
Say only what matters to the student: whether the class seems to be ending (people standing, packing up, leaving), what the teacher is doing (writing, erasing, pointing, talking, walking out), and anything that changed on the board.
Use positions like "at the front" or "on the left", never colours or looks.
Never identify anyone, never describe faces, clothing or bodies, and never guess gender: say "the teacher" or "students".
If you cannot tell, say so briefly. No lists, no markdown.`

export const NO_ANSWER = 'I could not tell what is happening.'
const MAX_SENTENCES = 2

// What the student hears: one plain line, at most two sentences, no markdown.
export function cleanAnswer(text: string): string {
  const flat = text
    .split('\n')
    .map(l => l.replace(/^\s*([-*•]|\d+\.)\s+/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/[*_`#]/g, '')
    .replace(/^["'“]+|["'”]+$/g, '')
    .trim()
  if (!flat) return NO_ANSWER
  const sentences = flat.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [flat]
  return sentences.slice(0, MAX_SENTENCES).map(s => s.trim()).join(' ')
}

export function describeRouter(describe: (jpeg: Buffer) => Promise<string>): express.Router {
  const router = express.Router()
  router.post('/api/describe', express.raw({ type: 'image/jpeg', limit: '5mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return void res.status(400).json({ error: 'empty or missing image/jpeg body' })
    try {
      res.json({ text: cleanAnswer(await describe(req.body)) })
    } catch (e) {
      console.error('describe failed:', e instanceof Error ? e.message : String(e)) // detail stays server-side
      res.status(502).json({ error: 'describe failed' })
    }
  })
  return router
}

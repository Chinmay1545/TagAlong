// "What is happening?": one frame to /api/describe. The student always gets an answer, even when it fails.
export const ASK_FAILED = "Sorry, I can't see the room right now."

type Post = (url: string, init: RequestInit) => Promise<Response>

export async function askScene(frame: () => Promise<Blob | null>, post: Post = fetch): Promise<string> {
  try {
    const jpeg = await frame()
    if (!jpeg) return ASK_FAILED
    const res = await post('/api/describe', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg })
    if (!res.ok) return ASK_FAILED
    const { text } = await res.json() as { text?: unknown }
    return typeof text === 'string' && text.trim() ? text.trim() : ASK_FAILED
  } catch {
    return ASK_FAILED
  }
}

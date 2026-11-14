import express from 'express'
import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export type Share = (text: string) => Promise<string>
const MAX_CHARS = 200_000

// Never creates the bucket: NOTES_BUCKET must already exist.
export function makeShare(bucket: string, client: { send: (c: PutObjectCommand) => Promise<unknown> }, sign: (c: any, cmd: GetObjectCommand, o: { expiresIn: number }) => Promise<string> = getSignedUrl as any): Share {
  return async (text) => {
    const Key = `notes/${randomUUID()}.txt`
    await client.send(new PutObjectCommand({ Bucket: bucket, Key, Body: text, ContentType: 'text/plain; charset=utf-8' }))
    return sign(client, new GetObjectCommand({ Bucket: bucket, Key }), { expiresIn: 86400 })
  }
}

export function shareFromEnv(env: Record<string, string | undefined>): Share | undefined {
  if (!env.NOTES_BUCKET) return undefined
  const s3 = new S3Client({ region: env.AWS_REGION })
  return makeShare(env.NOTES_BUCKET, s3 as any)
}

export function shareRouter(share: Share): express.Router {
  const router = express.Router()
  router.post('/api/share-notes', express.json({ limit: '256kb' }), async (req, res) => {
    const text = req.body?.text
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_CHARS) {
      res.status(400).json({ error: `text must be a non-empty string of at most ${MAX_CHARS} characters` })
      return
    }
    try { res.json({ url: await share(text) }) } catch (e) {
      console.error('share failed:', e instanceof Error ? e.message : String(e))
      res.status(502).json({ error: 'share failed' })
    }
  })
  return router
}

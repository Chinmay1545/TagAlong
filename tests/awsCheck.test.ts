import { describe, it, expect } from 'vitest'
// @ts-expect-error plain .mjs script
import { runChecks, renderTable, maskAccount, QUOTA_MSG, ROOT_WARNING } from '../scripts/aws-check.mjs'

const named = (name: string) => Object.assign(new Error('x'), { name })
const ok = (v: unknown = {}) => ({ send: async () => v })
const bad = (n: string) => ({ send: async () => { throw named(n) } })
const happy = () => ({ sts: ok({ Account: '123456789012', Arn: 'arn:aws:iam::123456789012:user/demo' }), polly: ok(), bedrock: ok(), transcribe: ok({ TranscriptResultStream: (async function* () {})() }) })
const env = { BOARD_MODEL_ID: 'board-m' }

describe('aws-check', () => {
  it('masks the account id except last 4', () => { expect(maskAccount('123456789012')).toBe('********9012') })
  it('all pass; account masked in table; no root warning', async () => {
    const { rows, notes } = await runChecks(happy(), env)
    expect(rows.every((r: any) => r.ok)).toBe(true)
    expect(notes).toEqual([])
    const t = renderTable(rows)
    expect(t).toContain('********9012')
    expect(t).not.toContain('123456789012')
    expect(t.split('\n')[0]).toMatch(/^check\s+\| result\s+\| next step/)
  })
  it('warns on root user', async () => {
    const c = happy(); c.sts = ok({ Account: '123456789012', Arn: 'arn:aws:iam::123456789012:root' })
    expect((await runChecks(c, env)).notes).toEqual([ROOT_WARNING])
  })
  it('bedrock throttle -> quota message on both models', async () => {
    const c = happy(); c.bedrock = bad('ThrottlingException')
    const { rows } = await runChecks(c, env)
    const b = rows.filter((r: any) => r.check.startsWith('Bedrock'))
    expect(b).toHaveLength(2)
    for (const r of b) expect(r).toMatchObject({ ok: false, next: QUOTA_MSG })
  })
  it('missing BOARD_MODEL_ID fails with next step', async () => {
    const { rows } = await runChecks(happy(), {})
    expect(rows.find((r: any) => r.check === 'Bedrock board model')).toMatchObject({ ok: false })
  })
  it('transcribe SubscriptionRequired is explicit', async () => {
    const c = happy(); c.transcribe = bad('SubscriptionRequiredException')
    const r = (await runChecks(c, env)).rows.find((r: any) => r.check.startsWith('Transcribe'))
    expect(r.ok).toBe(false); expect(r.result).toBe('not subscribed')
  })
  it('polly failure is reported per engine', async () => {
    const c = happy(); c.polly = bad('AccessDeniedException')
    const { rows } = await runChecks(c, env)
    expect(rows.filter((r: any) => r.check.startsWith('Polly')).every((r: any) => !r.ok)).toBe(true)
  })
})

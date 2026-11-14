// Diagnostic: tiny read/synth calls against each AWS service the app uses. Always exits 0.
// Usage: npm run aws:check   (reads .env if present; never prints keys)
import { pathToFileURL } from 'node:url'
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import { TranscribeStreamingClient, StartStreamTranscriptionCommand } from '@aws-sdk/client-transcribe-streaming'

export const QUOTA_MSG = "Bedrock quota is 0 on this account — request a quota increase or use the event's AWS account"
export const ROOT_WARNING = 'You are using the AWS root user. Create an IAM user with Polly, Transcribe, Bedrock and S3 access for the demo laptop.'
const NOTES_DEFAULT = 'us.amazon.nova-micro-v1:0'

export const maskAccount = (id) => `${'*'.repeat(Math.max(0, id.length - 4))}${id.slice(-4)}`
const fail = (result, next) => ({ ok: false, result, next })
const pass = (result) => ({ ok: true, result, next: '' })
const errName = (e) => e?.name || 'Error'

async function bedrock(client, modelId, label, envVar) {
  if (!modelId) return fail(`${envVar} not set`, `Set ${envVar} in .env to a Bedrock model or inference profile id`)
  try {
    await client.send(new ConverseCommand({ modelId, messages: [{ role: 'user', content: [{ text: 'Say hi' }] }], inferenceConfig: { maxTokens: 5 } }))
    return pass(`${modelId} replied`)
  } catch (e) {
    if (errName(e) === 'ThrottlingException') return fail('throttled', QUOTA_MSG)
    if (errName(e) === 'AccessDeniedException') return fail('access denied', `Enable model access for ${modelId} in the Bedrock console and allow bedrock:InvokeModel`)
    return fail(errName(e), `Check ${label} model id ${modelId} and region`)
  }
}

export async function runChecks({ sts, polly, bedrock: br, transcribe }, env) {
  const rows = []
  const add = (check, r) => rows.push({ check, ...r })
  const notes = []

  try {
    const id = await sts.send(new GetCallerIdentityCommand({}))
    add('STS identity', pass(`account ${maskAccount(String(id.Account ?? ''))}`))
    if (/:root$/.test(id.Arn ?? '')) notes.push(ROOT_WARNING)
  } catch (e) {
    add('STS identity', fail(errName(e), 'Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION in .env (or run aws configure)'))
  }

  for (const [engine, voice] of [[env.POLLY_ENGINE || 'generative', env.POLLY_VOICE || 'Ruth'], ['neural', 'Joanna']]) {
    try {
      await polly.send(new SynthesizeSpeechCommand({ Text: 'Hello', Engine: engine, VoiceId: voice, OutputFormat: 'mp3' }))
      add(`Polly ${engine}`, pass(`${voice} synthesized`))
    } catch (e) {
      add(`Polly ${engine}`, fail(errName(e), 'Allow polly:SynthesizeSpeech and use a region where this engine is offered'))
    }
  }

  add('Bedrock board model', await bedrock(br, env.BOARD_MODEL_ID, 'board', 'BOARD_MODEL_ID'))
  add('Bedrock notes model', await bedrock(br, env.NOTES_MODEL_ID?.trim() || NOTES_DEFAULT, 'notes', 'NOTES_MODEL_ID'))

  try {
    const silence = Buffer.alloc(3200) // 100 ms of 16 kHz 16-bit PCM
    const audio = (async function* () { for (let i = 0; i < 10; i++) yield { AudioEvent: { AudioChunk: silence } } })()
    const res = await transcribe.send(new StartStreamTranscriptionCommand({ LanguageCode: 'en-US', MediaEncoding: 'pcm', MediaSampleRateHertz: 16000, AudioStream: audio }))
    for await (const _ of res.TranscriptResultStream) { /* drain */ }
    add('Transcribe streaming', pass('1 s of silence accepted'))
  } catch (e) {
    add('Transcribe streaming', errName(e) === 'SubscriptionRequiredException'
      ? fail('not subscribed', 'Subscribe this account to Amazon Transcribe (or use the event\'s AWS account); the app falls back to browser speech')
      : fail(errName(e), 'Allow transcribe:StartStreamTranscription and check AWS_REGION'))
  }
  return { rows, notes }
}

export function renderTable(rows) {
  const data = [['check', 'result', 'next step'], ...rows.map((r) => [r.check, `${r.ok ? 'PASS' : 'FAIL'} ${r.result}`.trim(), r.next || '-'])]
  const w = [0, 1, 2].map((i) => Math.max(...data.map((r) => r[i].length)))
  const line = (r) => r.map((c, i) => c.padEnd(w[i])).join(' | ')
  return [line(data[0]), w.map((n) => '-'.repeat(n)).join('-+-'), ...data.slice(1).map(line)].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile() } catch { /* no .env: use the shell env / default chain */ }
  const region = process.env.AWS_REGION
  const { rows, notes } = await runChecks({
    sts: new STSClient({ region }), polly: new PollyClient({ region }),
    bedrock: new BedrockRuntimeClient({ region }), transcribe: new TranscribeStreamingClient({ region }),
  }, process.env)
  console.log(renderTable(rows))
  for (const n of notes) console.log(`\nWARNING: ${n}`)
  process.exit(0)
}

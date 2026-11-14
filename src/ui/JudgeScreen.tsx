import { isBoardQuery } from '../live/boardQuery'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { TipBuffer } from '../core/tipBuffer'
import { resolvePointer } from '../core/resolver'
import type { Box, Resolution, Term } from '../core/types'
import { startCamera } from '../vision/camera'
import { keepScreenAwake } from '../vision/wakeLock'
import { startHandTracker } from '../vision/handTracker'
import { startToolTracker } from '../vision/toolTracker'
import type { HandInfo } from '../vision/stick'
import { pointersLabel, toolsFor } from '../vision/tools'
import { loadFixture } from '../board/boardClient'
import { boardMode, stageFor } from '../board/mode'
import { activePointer, kindOf } from '../vision/pointer'
import { createMousePointer } from '../vision/mousePointer'
import { drawPointerDot } from './pointerDot'
import { startBoardLoop, type BoardLoop } from '../board/boardLoop'
import { createLive } from '../live/live'
import { createWhisperPlayer } from '../audio/whisper'
import { connectTranscribe } from '../speech/transcribeClient'
import { startMic } from '../speech/mic'
import { startWebSpeech } from '../speech/webSpeech'
import type { WordItem } from '../speech/words'
import { LATENCY_LOG_MAX, APP_NAME, DEFAULT_CLASS, UNDO_MARK_MS } from '../core/config'
import { createRelay, relayUrl, type RelayStatus } from '../live/relay'
import { RoomPanel } from './RoomPanel'
import { createTranscript, substitute, type Segment } from '../transcript/store'
import { median, applyMark, finalTimes, type Row, type Tally } from './judgeHelpers'
import { TranscriptPanel } from './TranscriptPanel'
import { reportCard } from '../transcript/report'
import { ReportCard } from './ReportCard'
import { NotesPanel } from './NotesPanel'
import { ModeSwitch, PointerLog, Readout, StatsStrip, type Last } from './Panels'
import { Readiness } from './Readiness'
import { createBroadcaster, resolutionMsg, finalMsg, boardMsg, modeMsg, subscribe, markedMsg, type Msg, assistMsg, noticeMsg } from '../live/broadcast'
import { askScene } from '../live/assist'
import { isClassEnding, endingNotice } from '../live/classEnding'
import { grabJpeg } from '../vision/grabFrame'
import './judge.css'

const ACCENT = '#3fb98a'
const LINE = '#52525b'
const NEUTRAL = '#71717a' // mid zinc: reads on a white board and a dark one
const CHIP = 'rgba(9,9,11,0.78)'
const SIGNAL_MS = 900 // ring pulse; the pointer line fades in the first 600 ms
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
const easeOut = (p: number) => 1 - (1 - p) ** 3
type Signal = { at: number; terms: Term[]; tip: { x: number; y: number } | null; muted: boolean }
const LOG_MAX = 50

// Demo mode shows the saved photo under its saved boxes; live mode shows the camera and only boxes read from it.
const stage = stageFor(boardMode(location.search), new URLSearchParams(location.search).get('mirror') === '1')
// Mirroring is opt-in via ?mirror=1 (live mode only). When on, the <video> preview is flipped with CSS scaleX(-1)
// (the .mirror class), so the overlay must be drawn in that same displayed space. When off,
// flipX is the identity. Data stays unmirrored either way; ONLY drawing goes through this flip.
const mirror = stage.mirror
// Laser and stick detectors run only when the link asks for them (?laser=1, ?stick=1).
const tools = toolsFor(location.search)
const flipX = (x: number, w = 0): number => (mirror ? 1 - (x + w) : x)

function drawBox(ctx: CanvasRenderingContext2D, b: Box, W: number, H: number) {
  ctx.strokeRect(flipX(b.x, b.w) * W, b.y * H, b.w * W, b.h * H)
}

// Small dark chip with mono text above a box, so labels read on a white board and a dark one.
function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, on: string | null, small: boolean) {
  const w = ctx.measureText(text).width + 10
  const h = small ? 14 : 17
  const top = Math.max(0, y - h - 3)
  ctx.fillStyle = on ?? CHIP
  ctx.beginPath()
  ctx.roundRect(x, top, w, h, 3)
  ctx.fill()
  ctx.fillStyle = on === ACCENT ? '#09090b' : on ? '#fafafa' : '#e4e4e7'
  ctx.fillText(text, x + 5, top + h - 4)
}

// The resolution moment: a fading line from fingertip to term, an expanding ring on the term,
// or a neutral x ripple at the fingertip when nothing was in reach. Time-based, drawn per frame.
function drawSignal(ctx: CanvasRenderingContext2D, s: Signal, tip: { x: number; y: number } | null, now: number, W: number, H: number) {
  const age = now - s.at
  if (age < 0 || age > SIGNAL_MS) return
  const p = age / SIGNAL_MS
  const color = s.muted ? NEUTRAL : ACCENT
  const from = tip ?? s.tip
  ctx.lineCap = 'round'
  if (!s.terms.length) {
    if (!from) return
    const x = flipX(from.x) * W, y = from.y * H, r = 8 + 26 * easeOut(p), a = 1 - p
    ctx.globalAlpha = a
    ctx.strokeStyle = NEUTRAL
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6); ctx.stroke()
    ctx.globalAlpha = 1
    return
  }
  for (const t of s.terms) {
    const bx = flipX(t.box.x, t.box.w) * W, by = t.box.y * H, bw = t.box.w * W, bh = t.box.h * H
    if (from && age < 600) {
      const cx = bx + bw / 2, cy = by + bh / 2
      const a = 1 - easeOut(age / 600)
      const head = Math.min(1, age / 140) // line draws toward the term, then fades
      const fx = flipX(from.x) * W, fy = from.y * H
      ctx.globalAlpha = a
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + (cx - fx) * head, fy + (cy - fy) * head); ctx.stroke()
    }
    const pad = 3 + 22 * easeOut(p)
    ctx.globalAlpha = (1 - p) * 0.9
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.roundRect(bx - pad, by - pad, bw + pad * 2, bh + pad * 2, 4 + pad / 2); ctx.stroke()
  }
  ctx.globalAlpha = 1
}

type Speech = 'off' | 'starting' | 'transcribe' | 'web speech' | 'unavailable'
const TRANSCRIBE_CONNECT_MS = 3000
const demo = new URLSearchParams(location.search).get('demo') === '1'

declare global {
  interface Window {
    __tt?: {
      say(text: string): void
      report(): ReturnType<typeof reportCard>
      state(): { log: string[]; transcript: { said: string; meant: string }[]; withoutApp: boolean; marks: { correct: number; total: number } }
    }
  }
}

export function JudgeScreen() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tipsRef = useRef(new TipBuffer())
  const mouseRef = useRef(createMousePointer(p => tipsRef.current.push(p)))
  useEffect(() => () => mouseRef.current.stop(), [])
  const termsRef = useRef<Term[]>([])
  const resolvedRef = useRef<Term[]>([])
  const boardLoopRef = useRef<BoardLoop | null>(null)
  const signalRef = useRef<Signal | null>(null)
  const boardAtRef = useRef<number | null>(null)
  const fixture = stage.fixtureTerms
  const playerRef = useRef<ReturnType<typeof createWhisperPlayer>>(null as never)
  const liveRef = useRef<ReturnType<typeof createLive>>(null as never)
  if (!liveRef.current) {
    playerRef.current = createWhisperPlayer()
    liveRef.current = createLive({ getTerms: () => termsRef.current, tips: tipsRef.current, player: playerRef.current, getPendingRegion: () => boardLoopRef.current?.pendingRegion() ?? null })
  }
  const latenciesRef = useRef<number[]>([])
  const segRef = useRef(0)
  const stopSpeechRef = useRef<(() => void) | null>(null)
  const transcriptRef = useRef(createTranscript())
  const rowIdRef = useRef(0)
  const rowsRef = useRef<Row[]>([])
  const whisperRef = useRef(true)
  const tallyRef = useRef<Tally>({ correct: 0, total: 0 })
  const [marks, setMarks] = useState<Tally>({ correct: 0, total: 0 })

  const [rows, setRows] = useState<Row[]>([])
  const [segs, setSegs] = useState<Segment[]>([])
  const [fps, setFps] = useState(0)
  const [boardAgo, setBoardAgo] = useState<string>('none')
  const [termCount, setTermCount] = useState(0)
  const [camError, setCamError] = useState<string | null>(null)
  const [speech, setSpeech] = useState<Speech>('off')
  const [whisperOn, setWhisperOn] = useState(true)
  const [medianMs, setMedianMs] = useState<number | null>(null)
  const [last, setLast] = useState<Last | null>(null)
  const bcRef = useRef<ReturnType<typeof createBroadcaster>>(null as never)
  if (!bcRef.current) bcRef.current = createBroadcaster()
  useEffect(() => () => bcRef.current.close(), [])
  const boardRef = useRef<Resolution | null>(null)
  const askingRef = useRef(false)
  const askWaitersRef = useRef<((m: Msg) => void)[]>([])
  const className = new URLSearchParams(location.search).get('class') || DEFAULT_CLASS
  const [joinUrl, setJoinUrl] = useState<string | null>(null)
  const [listeners, setListeners] = useState(0)
  const [relayStatus, setRelayStatus] = useState<RelayStatus | 'off'>('off')
  const relayRef = useRef<ReturnType<typeof createRelay> | null>(null)
  // Everything the laptop says goes to the laptop's own student tab and to every phone in the room.
  const sendAll = (m: Msg) => { bcRef.current.send(m); relayRef.current?.send(m) }
  const sendAllRef = useRef(sendAll)
  sendAllRef.current = sendAll
  const marksRef = useRef(new Map<string, number[]>()) // sender -> times of its bookmarks ('tab' = laptop student window)
  // One handler for the laptop tab (reply = BroadcastChannel) and for phones (reply = targeted relay send).
  const handleStudent = (m: Msg, from: string, reply: (m: Msg) => void) => {
    if (m.type === 'bookmark') {
      // "I didn't get this": marks the sentence being said now; the teacher sees it in the transcript.
      const t = performance.now()
      const count = transcriptRef.current.addBookmark(t)
      marksRef.current.set(from, [...(marksRef.current.get(from) ?? []), t])
      setSegs(transcriptRef.current.segments())
      reply(markedMsg(from === 'tab' ? count : marksRef.current.get(from)!.length))
      return
    }
    if (m.type === 'unmark') {
      const mine = marksRef.current.get(from) ?? []
      const t = mine[mine.length - 1]
      if (t === undefined || performance.now() - t > UNDO_MARK_MS + 2000) return
      marksRef.current.set(from, mine.slice(0, -1))
      const count = transcriptRef.current.removeBookmark(t)
      setSegs(transcriptRef.current.segments())
      reply(markedMsg(from === 'tab' ? count : mine.length - 1, true))
      return
    }
    if (m.type === 'ask') {
      askWaitersRef.current.push(reply)
      if (askingRef.current) return // one look at a time; everyone who asks meanwhile gets that same answer
      askingRef.current = true
      const photo = document.querySelector<HTMLImageElement>('img.demo-photo')
      void askScene(() => grabJpeg(photo ?? videoRef.current!))
        .then(text => { const waiting = askWaitersRef.current; askWaitersRef.current = []; waiting.forEach(w => w(assistMsg(text))) })
        .finally(() => { askingRef.current = false })
      return
    }
    if (m.type !== 'hello') return
    reply(modeMsg(!whisperRef.current))
    if (boardRef.current) reply(boardMsg(boardRef.current))
  }
  const handleStudentRef = useRef(handleStudent)
  handleStudentRef.current = handleStudent
  useEffect(() => subscribe(m => handleStudentRef.current(m, 'tab', r => bcRef.current.send(r))), [])

  // Open this class's room on the server; phones that scan the QR join it. If that fails, only phones are lost.
  useEffect(() => {
    let dead = false
    let relay: ReturnType<typeof createRelay> | null = null
    void (async () => {
      try {
        const res = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: className }) })
        if (!res.ok) return
        const { token } = await res.json() as { token: string }
        if (dead) return
        setJoinUrl(`${location.origin}/c/${token}?n=${encodeURIComponent(className)}`)
        relay = createRelay({
          url: relayUrl(location, { role: 'teacher', room: token, name: className }),
          onStatus: setRelayStatus,
          onMessage: (m: Msg & { from?: string; count?: number }) => {
            if ((m as { type: string }).type === 'listeners') setListeners(m.count ?? 0)
            else if (typeof m.from === 'string') {
              const from = m.from
              handleStudentRef.current(m, from, r => relayRef.current?.send({ ...r, to: from }))
            }
          },
        })
        relayRef.current = relay
        setRelayStatus(relay.status())
      } catch { /* no room: the laptop works on its own */ }
    })()
    return () => { dead = true; relay?.close(); relayRef.current = null }
  }, [])

  const prepare = (terms: Term[]) => { void playerRef.current.prepare(terms) }

  // Reset button: drop every box and the highlight; live mode re-reads the board on the next tick.
  const resetBoard = () => {
    resolvedRef.current = []
    if (boardLoopRef.current) boardLoopRef.current.reset()
    else setTerms([])
  }

  const setTerms = (terms: Term[]) => {
    termsRef.current = terms
    boardAtRef.current = performance.now()
    setTermCount(terms.length)
    prepare(terms)
    liveRef.current.checkHeld() // a "this" said before this box was read can be whispered now
  }

  // Startup: camera -> hand tracker -> board loop (or fixture). Cancel-safe.
  useEffect(() => {
    let cancelled = false
    let stopTracker: (() => void) | null = null
    const video = videoRef.current!

    ;(async () => {
      if (fixture) {
        try {
          const terms = await loadFixture()
          if (cancelled) return
          termsRef.current = terms
          setTermCount(terms.length)
          prepare(terms)
        } catch (e) {
          if (!cancelled) setCamError((e as Error).message)
        }
      }
      try {
        await startCamera(video)
        if (cancelled) {
          // cleanup ran before srcObject was assigned, so it stopped nothing
          ;(video.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop())
          video.srcObject = null
          return
        }
        let hand: HandInfo | null = null
        const stop = await startHandTracker(video, s => tipsRef.current.push(s), h => { hand = h })
        if (cancelled) { stop(); return }
        const stopTools = startToolTracker(video, p => tipsRef.current.push(p), () => hand, tools) // laser dot and stick tip, if switched on
        stopTracker = () => { stop(); stopTools() }
        if (stage.boardLoop) boardLoopRef.current = startBoardLoop(video, tipsRef.current, setTerms)
      } catch (e) {
        if (!cancelled) setCamError((e as Error).message)
      }
    })()

    const stats = setInterval(() => {
      const now = performance.now()
      liveRef.current.checkHeld() // gives up on held words that waited too long
      setFps(tipsRef.current.window(now - 1000, now).filter(s => kindOf(s) === 'finger').length)
      const at = boardAtRef.current
      setBoardAgo(fixture ? 'fixture' : at === null ? 'none' : `${((now - at) / 1000).toFixed(0)}s ago`)
    }, 500)
    const stopWake = keepScreenAwake()

    return () => {
      cancelled = true
      clearInterval(stats)
      stopWake()
      stopTracker?.()
      boardLoopRef.current?.stop()
      boardLoopRef.current = null
      const stream = video.srcObject as MediaStream | null
      stream?.getTracks().forEach(t => t.stop())
      video.srcObject = null
    }
  }, [fixture])

  // Overlay: rAF loop reading refs, no React state per frame.
  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    const draw = () => {
      const W = canvas.clientWidth
      const H = canvas.clientHeight
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr)
        canvas.height = Math.round(H * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const small = W < 640 // phone-sized view: smaller labels so neighbouring terms don't overlap
      ctx.font = `${small ? 9 : 11}px "Geist Mono", monospace`
      ctx.textBaseline = 'alphabetic'
      const now = performance.now()
      const hit = resolvedRef.current
      const hue = signalRef.current?.muted ? NEUTRAL : ACCENT // without app: show the match, not as a whisper
      for (const t of termsRef.current) {
        const on = hit.includes(t)
        const x = flipX(t.box.x, t.box.w) * W, y = t.box.y * H
        if (on) {
          ctx.globalAlpha = 0.12
          ctx.fillStyle = hue
          ctx.fillRect(x, y, t.box.w * W, t.box.h * H)
          ctx.globalAlpha = 1
        }
        ctx.lineWidth = on ? 2 : 1
        ctx.strokeStyle = on ? hue : LINE
        drawBox(ctx, t.box, W, H)
        drawLabel(ctx, t.phrase, x, y - 4, on ? hue : null, small)
      }
      const tip = activePointer(tipsRef.current.all(), now) // laser, then stick, then finger
      if (signalRef.current && !reduceMotion?.matches) drawSignal(ctx, signalRef.current, tip, now, W, H)
      if (tip) drawPointerDot(ctx, tip, W, H, flipX)
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Resolutions (from P, __tt or live speech) -> overlay highlight, log line, latency median.
  useEffect(() => liveRef.current.onResolution((r, ms) => {
    if (transcriptRef.current.addResolution(r)) setSegs(transcriptRef.current.segments()) // a held word joined an earlier sentence
    sendAllRef.current(resolutionMsg(r, ms, !whisperRef.current))
    resolvedRef.current = r.terms
    const now = performance.now()
    const tip = activePointer(tipsRef.current.all(), now)
    signalRef.current = { at: now, terms: r.terms, tip: tip && { x: tip.x, y: tip.y }, muted: ms === null }
    const phrase = r.terms.map(t => t.phrase).join(', ')
    const line = !r.terms.length ? `${r.word.word} → silent`
      : ms === null ? `${r.word.word} → ${phrase} · muted`
      : `${r.word.word} → ${phrase} · ${(ms / 1000).toFixed(2)} s`
    if (ms !== null) {
      latenciesRef.current = [ms, ...latenciesRef.current].slice(0, LATENCY_LOG_MAX)
      setMedianMs(median(latenciesRef.current))
    }
    const id = ++rowIdRef.current
    setLast({ id, word: r.word.word, phrase, ms })
    setRows(rs => (rowsRef.current = [{ id, line }, ...rs].slice(0, LOG_MAX)))
  }), [])

  useEffect(() => liveRef.current.onBoardQuery((r, ms) => {
    boardRef.current = r
    sendAllRef.current(boardMsg(r))
    const line = !r.terms.length ? 'board → empty'
      : `board → ${r.terms.length} terms · ${ms === null ? 'muted' : `${(ms / 1000).toFixed(2)} s`}`
    setRows(rs => (rowsRef.current = [{ id: ++rowIdRef.current, line }, ...rs].slice(0, LOG_MAX)))
  }), [])

  // Every final source (Transcribe, Web Speech, __tt.say) goes through live.handleFinal.
  useEffect(() => liveRef.current.onFinalSegment((text, t0, t1) => {
    if (isBoardQuery(text)) return // a question to the app, not lecture content
    transcriptRef.current.addFinal(text, t0, t1)
    const all = transcriptRef.current.segments()
    setSegs(all)
    const seg = all[all.length - 1]
    if (!seg) return
    const meant = substitute(seg.text, seg.resolutions)
    sendAllRef.current(finalMsg(seg.text, meant))
    if (isClassEnding(seg.text)) sendAllRef.current(noticeMsg(endingNotice(meant))) // only when it matters
  }), [])

  const toggleWhisper = () => {
    const on = !whisperRef.current
    whisperRef.current = on
    setWhisperOn(on)
    sendAllRef.current(modeMsg(!on))
    if (on) playerRef.current.unlock()
    liveRef.current.setWhisperEnabled(on)
  }
  const toggleWhisperRef = useRef(toggleWhisper)
  toggleWhisperRef.current = toggleWhisper

  useEffect(() => {
    const live = liveRef.current
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const k = e.key.toLowerCase()
      if (k === 'w') { toggleWhisperRef.current(); return }
      if (k === 'y' || k === 'n') {
        const r = applyMark(rowsRef.current, tallyRef.current, k)
        rowsRef.current = r.rows
        tallyRef.current = r.tally
        setRows(r.rows)
        setMarks(r.tally)
        return
      }
      if (k !== 'p') return
      playerRef.current.unlock()
      const t = performance.now()
      live.handleItems([{ content: 'this', isPartial: false, arrivedAt: t, segment: -(++segRef.current) }], null)
      live.handleFinal('this', t, t)
    }
    window.addEventListener('keydown', onKey)
    if (import.meta.env.DEV) {
      window.__tt = {
        say(text: string) {
          const t = performance.now()
          const segment = -(++segRef.current) // negative: never collides with Web Speech segments (>=0)
          const items: WordItem[] = text.split(/\s+/).filter(Boolean).map(content => ({ content, isPartial: false, arrivedAt: t, segment }))
          live.handleItems(items, null)
          live.handleFinal(text, t, t)
        },
        report: () => reportCard({ segments: transcriptRef.current.segments(), latencies: latenciesRef.current, marks: tallyRef.current }),
        state: () => ({
          log: rowsRef.current.map(r => r.line),
          transcript: transcriptRef.current.segments().map(s => ({ said: s.text, meant: substitute(s.text, s.resolutions) })),
          withoutApp: !whisperRef.current,
          marks: tallyRef.current,
        }),
      }
    }
    return () => {
      window.removeEventListener('keydown', onKey)
      if (import.meta.env.DEV) delete window.__tt
    }
  }, [])

  const stopSpeech = () => { stopSpeechRef.current?.(); stopSpeechRef.current = null }
  useEffect(() => stopSpeech, [])

  const toggleListen = () => {
    if (speech !== 'off' && speech !== 'unavailable') { stopSpeech(); setSpeech('off'); return }
    stopSpeech()
    const live = liveRef.current
    let dead = false
    let ws: ReturnType<typeof connectTranscribe> | null = null
    let mic: { stop(): void } | null = null
    let web: { stop(): void } | null = null
    let audioStart: number | null = null
    const onFinal = (source: 'web' | 'transcribe') => (text: string, t0 = 0, t1 = 0) => live.handleFinal(text, ...finalTimes(source, t0, t1, audioStart, performance.now()))
    const cleanup = () => { dead = true; mic?.stop(); ws?.close(); web?.stop(); mic = ws = web = null }
    stopSpeechRef.current = cleanup
    setSpeech('starting')
    playerRef.current.unlock()
    live.resetUtterance() // new stream: Transcribe times restart at 0

    const fallback = () => {
      if (dead || web) return
      mic?.stop(); ws?.close(); mic = ws = null
      web = startWebSpeech(items => live.handleItems(items, null, true), t => onFinal('web')(t), () => { cleanup(); stopSpeechRef.current = null; setSpeech('unavailable') })
      setSpeech(web ? 'web speech' : 'unavailable')
      if (!web) stopSpeechRef.current = null
    }

    ;(async () => {
      try {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws'
        ws = connectTranscribe(`${proto}://${location.host}/ws/transcribe`, items => live.handleItems(items, audioStart), onFinal('transcribe'), fallback)
        const sock = ws
        await Promise.race([sock.ready, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TRANSCRIBE_CONNECT_MS))])
        if (dead || web) return
        const m = await startMic(pcm => sock.send(pcm))
        if (dead || web) { m.stop(); return }
        mic = m
        audioStart = m.audioStartPerf
        setSpeech('transcribe')
      } catch {
        fallback()
      }
    })()
  }

  const report = reportCard({ segments: segs, latencies: latenciesRef.current, marks })
  const listening = speech === 'transcribe' || speech === 'web speech'
  const speechLabel = speech === 'starting' ? '...' : speech
  const step = (i: number) => ({ '--i': i }) as CSSProperties

  return (
    <main className="judge">
      <div className="grain" aria-hidden="true" />
      <header className="masthead rise" style={step(0)}>
        <div className="wordmark"><span className="dot" aria-hidden="true" />{APP_NAME}</div>
        <div className="status mono">board · {boardAgo}<span className="status-gap" />speech · {speechLabel}<span className="status-gap" />pointers · {pointersLabel(tools, !!stage.photo)}<span className="status-gap" /><a className="student-link" href="/?student=1" target="student" onClick={e => { e.preventDefault(); window.open('/?student=1', 'student', 'popup,width=1280,height=800') }} title="Opens in its own window; keep this window visible so hand tracking keeps running">Open student view</a></div>
      </header>
      <RoomPanel name={className} joinUrl={joinUrl} listeners={listeners} relay={relayStatus} />
      <Readiness />
      <section className="stage-wrap">
        <div className="viewfinder rise" style={step(1)}>
          {/* Demo: the mouse points at the saved photo (the camera still tracks a real hand when the mouse is off the photo). */}
          <div className="stage" onPointerMove={stage.photo ? e => mouseRef.current.move(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()) : undefined} onPointerLeave={stage.photo ? () => mouseRef.current.leave() : undefined}>
            <video ref={videoRef} className={mirror ? 'mirror' : stage.photo ? 'behind-photo' : undefined} playsInline muted />
            {stage.photo && <img className="demo-photo" src={stage.photo} alt="Saved demo board" />}
            <canvas ref={canvasRef} />
          </div>
          <span className="vf-tag vf-src"><span className="dot" aria-hidden="true" />{stage.photo ? 'DEMO' : 'LIVE'}</span>
          <span className="vf-tag vf-fps">{fps} FPS</span>
        </div>
        <div className="kbd-strip rise" style={step(2)}>
          <span><kbd>P</kbd> point</span>
          <span><kbd>Y</kbd> correct</span>
          <span><kbd>N</kbd> wrong</span>
          <span><kbd>W</kbd> with / without app</span>
        </div>
        {camError && <div className="cam-error" role="alert">{camError}</div>}
      </section>
      <aside className="side">
        <div className="rise" style={step(1)}>
          <ModeSwitch withApp={whisperOn} onToggle={() => { playerRef.current.unlock(); toggleWhisper() }} />
        </div>
        <div className="rise" style={step(2)}><Readout last={last} /></div>
        <div className="rise" style={step(3)}>
          <StatsStrip fps={fps} boardAgo={boardAgo} terms={termCount} speech={speech === 'web speech' ? 'web' : speechLabel} listening={listening} marks={marks} medianMs={medianMs} />
        </div>
        <div className="controls rise" style={step(4)}>
          <button type="button" className={`listen${listening ? ' on' : ''}`} aria-pressed={listening} onClick={toggleListen}>
            <span className="listen-ring" aria-hidden="true" />
            {speech === 'off' || speech === 'unavailable' ? 'Listen' : 'Stop listening'}
          </button>
          <button type="button" className="reset" onClick={resetBoard} title="Clear every box and read the board again from scratch">Reset board</button>
          {speech === 'unavailable' && <span className="inline-error" role="alert">speech: unavailable</span>}
        </div>
        <div className="rise" style={step(5)}><PointerLog rows={rows} /></div>
        <div className="rise" style={step(6)}><TranscriptPanel segs={segs} open={demo} /></div>
        <div className="rise" style={step(7)}><NotesPanel segs={segs} report={report} /></div>
        <div className="rise" style={step(8)}><ReportCard card={report} /></div>
      </aside>
    </main>
  )
}

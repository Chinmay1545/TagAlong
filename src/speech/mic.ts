import { PCM_RATE } from '../core/config'

// Linear average over each output sample's input span; Int16 range, clamped.
export function downsampleTo16k(input: Float32Array, inRate: number): Int16Array {
  const ratio = inRate / PCM_RATE
  const out = new Int16Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio)
    const b = Math.max(a + 1, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = a; j < b; j++) sum += input[j]
    const v = Math.max(-1, Math.min(1, sum / (b - a)))
    out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767)
  }
  return out
}

// Emits ~100 ms chunks (3200 bytes at 16 kHz), well under the server's 64 KiB frame cap.
export async function startMic(onChunk: (pcm: Int16Array) => void): Promise<{ audioStartPerf: number; stop(): void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const ctx = new AudioContext()
  let src: MediaStreamAudioSourceNode, node: AudioWorkletNode
  const chunkLen = Math.round(ctx.sampleRate / 10)
  let buf = new Float32Array(0)
  try {
    await ctx.audioWorklet.addModule('/pcm-worklet.js')
    if (ctx.state === 'suspended') await ctx.resume()
    src = ctx.createMediaStreamSource(stream)
    node = new AudioWorkletNode(ctx, 'pcm-worklet')
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const next = new Float32Array(buf.length + e.data.length)
      next.set(buf); next.set(e.data, buf.length)
      buf = next
      while (buf.length >= chunkLen) {
        onChunk(downsampleTo16k(buf.subarray(0, chunkLen), ctx.sampleRate))
        buf = buf.slice(chunkLen)
      }
    }
    src.connect(node)
  } catch (e) {
    stream.getTracks().forEach(t => t.stop())
    void ctx.close()
    throw e
  }
  let done = false
  const audioStartPerf = performance.now()
  return {
    audioStartPerf,
    stop() {
      if (done) return
      done = true
      node.port.onmessage = null
      src.disconnect(); node.disconnect()
      stream.getTracks().forEach(t => t.stop())
      void ctx.close()
    },
  }
}

import { describe, expect, it, vi } from 'vitest'
import { Capture, MIME_CANDIDATES, pickMimeType, type CaptureEnv } from './capture'
import { cueForTransition, pillMessage } from './phase'
import { CUES, cueDurationMs } from './sounds'

class FakeTrack {
  stopped = false
  onended: (() => void) | null = null
  stop(): void {
    this.stopped = true
  }
}
class FakeStream {
  track = new FakeTrack()
  getTracks = () => [this.track]
  getAudioTracks = () => [this.track]
}
class FakeRecorder extends EventTarget {
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onerror: unknown = null
  emptyOnStop = false
  start(): void {
    this.state = 'recording'
    if (!this.emptyOnStop) this.ondataavailable?.({ data: new Blob([new Uint8Array(100)]) })
  }
  stop(): void {
    this.state = 'inactive'
    if (!this.emptyOnStop) this.ondataavailable?.({ data: new Blob([new Uint8Array(50)]) })
    this.dispatchEvent(new Event('stop'))
  }
}

function setup(opts: { failDevice?: boolean; failAll?: string; delayMs?: number; empty?: boolean } = {}) {
  const streams: FakeStream[] = []
  const recorders: FakeRecorder[] = []
  const calls: unknown[] = []
  let t = 1000
  const env: CaptureEnv = {
    async getUserMedia(c) {
      calls.push(c)
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      const audio = c.audio as { deviceId?: unknown }
      if (opts.failAll) throw Object.assign(new Error(opts.failAll), { name: opts.failAll })
      if (opts.failDevice && audio.deviceId) throw Object.assign(new Error('gone'), { name: 'NotFoundError' })
      const s = new FakeStream()
      streams.push(s)
      return s as unknown as MediaStream
    },
    isTypeSupported: (m) => m === 'audio/webm',
    createRecorder() {
      const r = new FakeRecorder()
      r.emptyOnStop = !!opts.empty
      recorders.push(r)
      return r as unknown as MediaRecorder
    },
    createAudioContext: () => null,
    now: () => (t += 500)
  }
  const sink = { sendAudio: vi.fn(async () => undefined), sendCaptureError: vi.fn(async () => undefined) }
  return { cap: new Capture(sink, env), sink, streams, recorders, calls }
}

describe('Capture', () => {
  it('records, delivers one blob and releases the mic', async () => {
    const { cap, sink, streams } = setup()
    await cap.start({ deviceId: 'dev1', mode: 'ptt' })
    expect(cap.active).toBe(true)
    await cap.stop()
    expect(sink.sendAudio).toHaveBeenCalledOnce()
    const [buf, mime, ms] = sink.sendAudio.mock.calls[0] as unknown as [ArrayBuffer, string, number]
    expect(buf.byteLength).toBe(150)
    expect(mime).toBe('audio/webm;codecs=opus')
    expect(ms).toBeGreaterThan(0)
    expect(streams[0].track.stopped).toBe(true)
    expect(cap.active).toBe(false)
  })

  it('uses exact deviceId, and undefined for default', async () => {
    const a = setup()
    await a.cap.start({ deviceId: 'abc', mode: 'ptt' })
    expect((a.calls[0] as { audio: { deviceId: unknown } }).audio.deviceId).toEqual({ exact: 'abc' })
    const b = setup()
    await b.cap.start({ deviceId: 'default', mode: 'ptt' })
    expect((b.calls[0] as { audio: { deviceId: unknown } }).audio.deviceId).toBeUndefined()
  })

  it('retries once with the default device when the chosen one fails', async () => {
    const { cap, sink, calls } = setup({ failDevice: true })
    await cap.start({ deviceId: 'unplugged', mode: 'ptt' })
    expect(calls).toHaveLength(2)
    expect(cap.active).toBe(true)
    expect(sink.sendCaptureError).not.toHaveBeenCalled()
  })

  it('does not retry on permission denial and reports a friendly error', async () => {
    const { cap, sink, calls } = setup({ failAll: 'NotAllowedError' })
    await cap.start({ deviceId: 'abc', mode: 'ptt' })
    expect(calls).toHaveLength(1)
    expect(sink.sendCaptureError).toHaveBeenCalledWith(expect.stringMatching(/denied/i))
    expect(cap.active).toBe(false)
  })

  it('ignores a double start', async () => {
    const { cap, calls } = setup()
    await Promise.all([cap.start({ deviceId: 'default', mode: 'ptt' }), cap.start({ deviceId: 'default', mode: 'ptt' })])
    expect(calls).toHaveLength(1)
  })

  it('stop arriving before getUserMedia resolves still finishes starting, then stops', async () => {
    const { cap, sink, streams } = setup({ delayMs: 30 })
    const started = cap.start({ deviceId: 'default', mode: 'ptt' })
    const stopped = cap.stop() // issued while getUserMedia is pending
    await Promise.all([started, stopped])
    expect(sink.sendAudio).toHaveBeenCalledOnce()
    expect(streams[0].track.stopped).toBe(true)
  })

  it('cancel discards audio and releases the mic', async () => {
    const { cap, sink, streams } = setup()
    await cap.start({ deviceId: 'default', mode: 'ptt' })
    await cap.cancel()
    expect(sink.sendAudio).not.toHaveBeenCalled()
    expect(streams[0].track.stopped).toBe(true)
    expect(cap.active).toBe(false)
  })

  it('stop and cancel without a session are no-ops', async () => {
    const { cap, sink } = setup()
    await cap.stop()
    await cap.cancel()
    expect(sink.sendAudio).not.toHaveBeenCalled()
    expect(sink.sendCaptureError).not.toHaveBeenCalled()
  })

  it('reports an error when no audio was captured', async () => {
    const { cap, sink } = setup({ empty: true })
    await cap.start({ deviceId: 'default', mode: 'ptt' })
    await cap.stop()
    expect(sink.sendAudio).not.toHaveBeenCalled()
    expect(sink.sendCaptureError).toHaveBeenCalled()
  })

  it('can record again after finishing', async () => {
    const { cap, sink } = setup()
    for (let i = 0; i < 2; i++) {
      await cap.start({ deviceId: 'default', mode: 'handsfree' })
      await cap.stop()
    }
    expect(sink.sendAudio).toHaveBeenCalledTimes(2)
  })

  it('prefers webm/opus, falls back to what is supported', () => {
    expect(pickMimeType(() => true)).toBe(MIME_CANDIDATES[0])
    expect(pickMimeType((m) => m === 'audio/mp4')).toBe('audio/mp4')
    expect(pickMimeType(() => false)).toBe('')
  })
})

describe('cues and pill helpers', () => {
  it('keeps every cue under 150 ms', () => {
    for (const k of Object.keys(CUES) as Array<keyof typeof CUES>) expect(cueDurationMs(k)).toBeLessThan(150)
  })
  it('chooses cues from state transitions', () => {
    const idle = { phase: 'idle' } as const
    const rec = { phase: 'recording', mode: 'ptt', startedAt: 1 } as const
    expect(cueForTransition(idle, rec)).toBe('start')
    expect(cueForTransition(rec, rec)).toBeNull()
    expect(cueForTransition(rec, { phase: 'processing', mode: 'ptt' })).toBe('stop')
    expect(cueForTransition(rec, { phase: 'error', message: 'x' })).toBe('error')
    expect(cueForTransition({ phase: 'processing', mode: 'ptt' }, { phase: 'done', mode: 'ptt', text: 'a', words: 1 })).toBeNull()
  })
  it('truncates pill messages', () => {
    expect(pillMessage('short')).toBe('short')
    expect(pillMessage('x'.repeat(80)).length).toBe(30)
    expect(pillMessage('x'.repeat(80)).endsWith('…')).toBe(true)
  })
})

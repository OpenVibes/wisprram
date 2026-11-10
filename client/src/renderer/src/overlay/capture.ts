// Microphone capture for the overlay window. Main drives it through recorder.onStart / onStop / onCancel.
//
// Races are avoided by serialising every command on one promise chain: a stop that arrives while
// getUserMedia is still pending simply runs after the start has finished (so recording starts, then
// stops immediately and the (short) audio is still delivered). A second start while recording is ignored.
import { audioConstraints, levelFromRms, micErrorMessage, rms } from '../lib/audio'
import type { RecMode } from '../../../shared/ipc'

export interface CaptureSink {
  sendAudio(data: ArrayBuffer, mimeType: string, durationMs: number): Promise<void>
  sendCaptureError(message: string): Promise<void>
}

/** Injectable browser APIs (real ones by default) so the state machine can be unit tested. */
export interface CaptureEnv {
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>
  isTypeSupported(mime: string): boolean
  createRecorder(stream: MediaStream, mime: string): MediaRecorder
  createAudioContext(): AudioContext | null
  now(): number
}

export const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

export function pickMimeType(isSupported: (m: string) => boolean): string {
  return MIME_CANDIDATES.find((m) => isSupported(m)) ?? ''
}

export const browserEnv: CaptureEnv = {
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
  isTypeSupported: (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
  createRecorder: (stream, mime) => new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 64_000 }),
  createAudioContext: () => {
    try {
      return new AudioContext()
    } catch {
      return null
    }
  },
  now: () => Date.now()
}

interface Session {
  stream: MediaStream
  recorder: MediaRecorder
  ctx: AudioContext | null
  analyser: AnalyserNode | null
  buf: Float32Array<ArrayBuffer> | null
  chunks: Blob[]
  mime: string
  startedAt: number
  mode: RecMode
  failed: string | null
}

export class Capture {
  private chain: Promise<void> = Promise.resolve()
  private session: Session | null = null
  private smooth = 0

  constructor(
    private readonly sink: CaptureSink,
    private readonly env: CaptureEnv = browserEnv
  ) {}

  /** true while a stream is open (starting counts once the stream exists). */
  get active(): boolean {
    return this.session !== null
  }

  /** Smoothed 0..1 input level, safe to call every animation frame. */
  getLevel(): number {
    const s = this.session
    if (!s?.analyser || !s.buf) {
      this.smooth *= 0.8
      return this.smooth
    }
    s.analyser.getFloatTimeDomainData(s.buf)
    const v = levelFromRms(rms(s.buf))
    this.smooth = v > this.smooth ? this.smooth * 0.4 + v * 0.6 : this.smooth * 0.82 + v * 0.18
    return this.smooth
  }

  start(opts: { deviceId: string; mode: RecMode }): Promise<void> {
    return this.enqueue(() => this.doStart(opts))
  }
  stop(): Promise<void> {
    return this.enqueue(() => this.doStop())
  }
  cancel(): Promise<void> {
    return this.enqueue(() => this.doCancel())
  }
  /** Release everything (window teardown). */
  dispose(): Promise<void> {
    return this.enqueue(async () => this.release())
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch((e) => console.error('[capture]', e))
    return this.chain
  }

  private async openStream(deviceId: string): Promise<MediaStream> {
    try {
      return await this.env.getUserMedia(audioConstraints(deviceId))
    } catch (e) {
      const name = (e as { name?: string } | null)?.name
      if (deviceId && deviceId !== 'default' && name !== 'NotAllowedError' && name !== 'SecurityError') {
        // The chosen device may have been unplugged: retry once with the system default.
        return await this.env.getUserMedia(audioConstraints('default'))
      }
      throw e
    }
  }

  private async doStart(opts: { deviceId: string; mode: RecMode }): Promise<void> {
    if (this.session) return // double start
    let stream: MediaStream
    try {
      stream = await this.openStream(opts.deviceId)
    } catch (e) {
      await this.sink.sendCaptureError(micErrorMessage(e))
      return
    }

    let ctx: AudioContext | null = null
    let analyser: AnalyserNode | null = null
    let buf: Float32Array<ArrayBuffer> | null = null
    try {
      ctx = this.env.createAudioContext()
      if (ctx) {
        analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        ctx.createMediaStreamSource(stream).connect(analyser)
        void ctx.resume().catch(() => undefined)
        buf = new Float32Array(analyser.fftSize)
      }
    } catch {
      analyser = null // levels are optional; recording must not fail because of them
    }

    const mime = pickMimeType((m) => this.env.isTypeSupported(m))
    let recorder: MediaRecorder
    try {
      recorder = this.env.createRecorder(stream, mime)
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop())
      void ctx?.close().catch(() => undefined)
      await this.sink.sendCaptureError(micErrorMessage(e))
      return
    }

    const s: Session = { stream, recorder, ctx, analyser, buf, chunks: [], mime, startedAt: this.env.now(), mode: opts.mode, failed: null }
    recorder.ondataavailable = (ev: BlobEvent): void => {
      if (ev.data && ev.data.size > 0) s.chunks.push(ev.data)
    }
    recorder.onerror = (ev: Event): void => {
      s.failed = (ev as unknown as { error?: Error }).error?.message ?? 'Recording failed'
    }
    stream.getAudioTracks().forEach((t) => {
      t.onended = () => {
        s.failed = s.failed ?? 'The microphone was disconnected'
      }
    })
    this.session = s
    try {
      recorder.start(250)
    } catch (e) {
      this.release()
      await this.sink.sendCaptureError(micErrorMessage(e))
    }
  }

  private waitForStop(recorder: MediaRecorder): Promise<void> {
    return new Promise<void>((resolve) => {
      if (recorder.state === 'inactive') return resolve()
      const timer = setTimeout(resolve, 3000)
      recorder.addEventListener(
        'stop',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
      try {
        recorder.stop() // fires a final dataavailable, then stop
      } catch {
        clearTimeout(timer)
        resolve()
      }
    })
  }

  private async doStop(): Promise<void> {
    const s = this.session
    if (!s) return
    await this.waitForStop(s.recorder)
    const durationMs = Math.max(0, this.env.now() - s.startedAt)
    const type = s.recorder.mimeType || s.mime || 'audio/webm'
    const failed = s.failed
    const blob = new Blob(s.chunks, { type })
    let buf: ArrayBuffer | null = null
    try {
      buf = await blob.arrayBuffer()
    } catch {
      buf = null
    }
    this.release() // turn the OS mic indicator off before the (possibly slow) IPC call
    if (!buf || buf.byteLength === 0) {
      await this.sink.sendCaptureError(failed ?? 'No audio was captured')
      return
    }
    await this.sink.sendAudio(buf, type, durationMs)
  }

  private async doCancel(): Promise<void> {
    const s = this.session
    if (!s) return
    s.recorder.ondataavailable = null
    await this.waitForStop(s.recorder)
    this.release()
  }

  private release(): void {
    const s = this.session
    this.session = null
    if (!s) return
    try {
      s.stream.getTracks().forEach((t) => {
        t.onended = null
        t.stop()
      })
    } catch {
      /* already stopped */
    }
    if (s.ctx && s.ctx.state !== 'closed') void s.ctx.close().catch(() => undefined)
  }
}

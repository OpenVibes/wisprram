// Recording state machine owned by the main process. No Electron imports: everything it touches
// (overlay, API, paste, context) is injected so the transitions can be unit-tested.
import type { AppContext, CommandOptions, CommandResult, DictateOptions, DictationResult } from '@shared/api'
import type { RecMode, RecState } from '@shared/ipc'
import type { ClientSettings } from '@shared/settings'
import type { ArchiveJob } from './archive-service'
import { describeError, pillMessage } from './url'

export const MAX_RECORDING_MS = 6 * 60 * 1000
export const DONE_SHOW_MS = 1200
export const ERROR_SHOW_MS = 2500
/** Generous: the first getUserMedia may sit behind an OS permission prompt. */
export const AUDIO_WAIT_MS = 12000
/** Recordings shorter than this are discarded silently (accidental toggle). */
export const MIN_AUDIO_MS = 300

export interface InsertOutcome {
  /** text ended up in the target app */
  pasted: boolean
  /** set when the text was only copied to the clipboard and the user must paste manually / grant permission */
  hint?: string
}

export interface RecorderDeps {
  getSettings(): ClientSettings
  overlay: {
    start(opts: { deviceId: string; mode: RecMode }): void
    stop(): void
    cancel(): void
  }
  api: {
    dictate(audio: Blob, options: DictateOptions, signal?: AbortSignal): Promise<DictationResult>
    command(audio: Blob, options: CommandOptions, signal?: AbortSignal): Promise<CommandResult>
  }
  insert(text: string): Promise<InsertOutcome>
  /** Command mode: copy the current selection from the focused app; null/empty when nothing is selected. */
  captureSelection(): Promise<{ text: string; hint?: string } | null>
  getContext(): Promise<AppContext | undefined>
  onState(s: RecState): void
  onResult(r: DictationResult | CommandResult): void
  /** v0.2: hand a finished/failed recording to the local archive. Called AFTER the text was pasted; must not throw. */
  archive?(job: ArchiveJob): Promise<void> | void
  log?(...a: unknown[]): void
  now?(): number
}

type Phase = 'idle' | 'preparing' | 'recording' | 'awaiting-audio' | 'processing'

export class Recorder {
  private phase: Phase = 'idle'
  private mode: RecMode = 'ptt'
  private startedAt = 0
  private selection = ''
  private contextP: Promise<AppContext | undefined> = Promise.resolve(undefined)
  private maxTimer: ReturnType<typeof setTimeout> | null = null
  private audioTimer: ReturnType<typeof setTimeout> | null = null
  private flashTimer: ReturnType<typeof setTimeout> | null = null
  private abort: AbortController | null = null
  /** bumps on every start/cancel so late async work from an old session is dropped */
  private session = 0
  private current: RecState = { phase: 'idle' }

  constructor(private readonly d: RecorderDeps) {}

  // ---- read-only ---------------------------------------------------------------------------------
  get state(): RecState {
    return this.current
  }
  get isRecording(): boolean {
    return this.phase === 'recording'
  }
  get isBusy(): boolean {
    return this.phase !== 'idle'
  }
  get recordingMode(): RecMode | null {
    return this.phase === 'recording' ? this.mode : null
  }

  // ---- commands ----------------------------------------------------------------------------------
  /** Push-to-talk key went down. If a hands-free/command recording is running, the press ends it. */
  pttPress(): void {
    if (this.phase === 'idle') void this.start('ptt')
    else if (this.phase === 'recording' && this.mode !== 'ptt') this.stop()
  }

  /** PTT released after a real hold */
  pttRelease(): void {
    if (this.phase === 'recording' && this.mode === 'ptt') this.stop()
  }

  /** PTT tap too short (or combo): drop it silently. Only affects a PTT recording. */
  pttCancel(): void {
    if ((this.phase === 'recording' || this.phase === 'preparing') && this.mode === 'ptt') this.cancel()
  }

  /** Double-tap lock: continue (or start) as hands-free. */
  lockHandsFree(): void {
    if (this.phase === 'recording' && this.mode === 'ptt') {
      this.mode = 'handsfree'
      this.emit({ phase: 'recording', mode: 'handsfree', startedAt: this.startedAt })
    } else if (this.phase === 'idle') {
      void this.start('handsfree')
    }
  }

  toggleHandsFree(): void {
    if (this.phase === 'idle') void this.start('handsfree')
    else if (this.phase === 'recording') this.stop()
  }

  toggleCommand(): void {
    if (this.phase === 'idle') void this.start('command')
    else if (this.phase === 'recording') this.stop()
  }

  /** Stop capturing and send for transcription. */
  stop(): void {
    if (this.phase !== 'recording') return
    this.clearMax()
    this.phase = 'awaiting-audio'
    this.emit({ phase: 'processing', mode: this.mode })
    this.d.overlay.stop()
    const s = this.session
    this.audioTimer = setTimeout(() => {
      if (s === this.session && this.phase === 'awaiting-audio') {
        this.d.log?.('timed out waiting for audio from overlay')
        this.fail('Recording failed — try again')
      }
    }, AUDIO_WAIT_MS)
  }

  /** Cancel at any time, silently. */
  cancel(): void {
    if (this.phase === 'idle' && this.current.phase === 'idle') return
    const wasCapturing = this.phase === 'recording' || this.phase === 'awaiting-audio'
    this.session++
    this.clearTimers()
    this.abort?.abort()
    this.abort = null
    this.phase = 'idle'
    if (wasCapturing) this.d.overlay.cancel()
    this.emit({ phase: 'idle' })
  }

  /** Show a short message in the pill without a recording (e.g. paste hints from the UI). Ignored while busy. */
  flash(message: string): void {
    if (this.phase !== 'idle') return
    this.showError(message)
  }

  // ---- overlay → main ----------------------------------------------------------------------------
  /** Overlay finished capturing. */
  async onAudio(data: ArrayBuffer, mimeType: string, durationMs: number): Promise<void> {
    if (this.phase !== 'awaiting-audio') {
      this.d.log?.('ignoring audio outside awaiting-audio phase', this.phase)
      return
    }
    const s = this.session
    this.clearAudio()
    if (durationMs < MIN_AUDIO_MS || data.byteLength < 200) {
      this.phase = 'idle'
      this.emit({ phase: 'idle' })
      return
    }
    this.phase = 'processing'
    const mode = this.mode
    const settings = this.d.getSettings()
    const abort = new AbortController()
    this.abort = abort
    // The audio stays referenced by `job` until the archive write finishes (fire-and-forget below).
    const job: ArchiveJob = {
      kind: mode === 'command' ? 'command' : 'dictation',
      mode,
      createdAt: (this.d.now ?? Date.now)(),
      audio: { data, mimeType: mimeType || 'audio/webm' },
      audioMs: durationMs,
      requested: { language: settings.language, cleanup: settings.cleanup, style: settings.style }
    }
    if (mode === 'command') job.selectedText = this.selection
    let archived = false
    const archive = (error?: string): void => {
      if (archived) return
      archived = true
      if (error) job.error = error
      this.archive(job)
    }
    try {
      const app = await this.contextP
      if (s !== this.session) return
      if (app) job.app = app
      const audio = new Blob([data], { type: job.audio.mimeType })
      let text: string
      let words: number
      if (mode === 'command') {
        const opts: CommandOptions = { selected_text: this.selection }
        if (app) opts.app = app
        const r = await this.d.api.command(audio, opts, abort.signal)
        if (s !== this.session) return
        job.result = r
        this.d.onResult(r)
        text = r.text
        words = countWords(r.text)
      } else {
        const opts: DictateOptions = { language: settings.language, cleanup: settings.cleanup, style: settings.style }
        if (app) opts.app = app
        const r = await this.d.api.dictate(audio, opts, abort.signal)
        if (s !== this.session) return
        job.result = r
        this.d.onResult(r)
        text = r.text
        words = r.word_count ?? countWords(r.text)
      }
      if (!text || !text.trim()) {
        archive()
        this.fail(mode === 'command' ? 'Nothing came back' : "Didn't catch that")
        return
      }
      const outcome = await this.d.insert(text)
      archive() // paste first, archive second: a slow disk never delays the text
      if (s !== this.session) return
      this.abort = null
      if (outcome.hint) {
        this.fail(outcome.hint)
        return
      }
      this.phase = 'idle'
      this.emit({ phase: 'done', mode, text, words })
      this.armFlash(DONE_SHOW_MS)
    } catch (err) {
      if (s !== this.session) return // cancelled
      this.d.log?.('processing failed', err)
      archive(describeError(err, settings.serverUrl))
      this.fail(pillMessage(err))
    }
  }

  private archive(job: ArchiveJob): void {
    if (!this.d.archive || !this.d.getSettings().archiveEnabled) return
    try {
      void Promise.resolve(this.d.archive(job)).catch((err) => this.d.log?.('archive failed', err))
    } catch (err) {
      this.d.log?.('archive failed', err)
    }
  }

  /** Overlay could not capture (mic denied, device gone…). */
  onCaptureError(message: string): void {
    if (this.phase !== 'recording' && this.phase !== 'awaiting-audio') return
    this.d.log?.('capture error', message)
    this.session++
    this.fail(message || 'Microphone error')
  }

  // ---- internals ---------------------------------------------------------------------------------
  private async start(mode: RecMode): Promise<void> {
    if (this.phase !== 'idle') return
    this.clearFlash()
    const s = ++this.session
    this.mode = mode
    this.phase = 'preparing'
    this.selection = ''
    // Capture the frontmost app now, before anything of ours could change focus.
    this.contextP = this.d.getContext().catch(() => undefined)
    if (mode === 'command') {
      let sel: { text: string; hint?: string } | null = null
      try {
        sel = await this.d.captureSelection()
      } catch (err) {
        this.d.log?.('captureSelection failed', err)
      }
      if (s !== this.session) return
      if (!sel || !sel.text.trim()) {
        this.fail(sel?.hint ?? 'Select some text first')
        return
      }
      this.selection = sel.text
    }
    this.phase = 'recording'
    this.startedAt = (this.d.now ?? Date.now)()
    this.emit({ phase: 'recording', mode: this.mode, startedAt: this.startedAt })
    this.d.overlay.start({ deviceId: this.d.getSettings().micDeviceId, mode })
    this.maxTimer = setTimeout(() => {
      if (s === this.session && this.phase === 'recording') {
        this.d.log?.('max recording length reached')
        this.stop()
      }
    }, MAX_RECORDING_MS)
  }

  private fail(message: string): void {
    this.clearTimers()
    this.abort = null
    const wasCapturing = this.phase === 'recording' || this.phase === 'awaiting-audio'
    this.phase = 'idle'
    if (wasCapturing) this.d.overlay.cancel()
    this.showError(message)
  }

  private showError(message: string): void {
    this.emit({ phase: 'error', message })
    this.armFlash(ERROR_SHOW_MS)
  }

  private armFlash(ms: number): void {
    this.clearFlash()
    const s = this.session
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null
      if (s === this.session && this.phase === 'idle') this.emit({ phase: 'idle' })
    }, ms)
  }

  private emit(s: RecState): void {
    this.current = s
    this.d.onState(s)
  }

  private clearMax(): void {
    if (this.maxTimer) clearTimeout(this.maxTimer)
    this.maxTimer = null
  }
  private clearAudio(): void {
    if (this.audioTimer) clearTimeout(this.audioTimer)
    this.audioTimer = null
  }
  private clearFlash(): void {
    if (this.flashTimer) clearTimeout(this.flashTimer)
    this.flashTimer = null
  }
  private clearTimers(): void {
    this.clearMax()
    this.clearAudio()
    this.clearFlash()
  }
}

export function countWords(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

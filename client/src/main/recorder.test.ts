import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandResult, DictationResult } from '@shared/api'
import type { RecState } from '@shared/ipc'
import { defaultSettings } from '../shared/settings'
import { AUDIO_WAIT_MS, DONE_SHOW_MS, ERROR_SHOW_MS, MAX_RECORDING_MS, Recorder, type RecorderDeps } from './recorder'
import { ApiError } from './url'

const audio = () => new Uint8Array(5000).buffer
const dictation = (text = 'Hello world.'): DictationResult => ({
  id: '1', raw_text: 'hello world', text, language: 'en', audio_ms: 1500, word_count: text ? 2 : 0,
  timings: { stt_ms: 1, llm_ms: 1, total_ms: 2 }, applied_snippets: [], cleanup_used: 'llm'
})

function make(over: Partial<RecorderDeps> = {}) {
  const states: RecState[] = []
  const calls = { start: [] as unknown[], stop: 0, cancel: 0, inserted: [] as string[], results: [] as unknown[] }
  const deps: RecorderDeps = {
    getSettings: () => ({ ...defaultSettings('darwin'), micDeviceId: 'mic-1' }),
    overlay: { start: (o) => void calls.start.push(o), stop: () => void calls.stop++, cancel: () => void calls.cancel++ },
    api: {
      dictate: vi.fn(async () => dictation()),
      command: vi.fn(async (): Promise<CommandResult> => ({ id: 'c', instruction: 'i', text: 'Rewritten', timings: { stt_ms: 1, llm_ms: 1, total_ms: 2 } }))
    },
    insert: vi.fn(async (t: string) => { calls.inserted.push(t); return { pasted: true } }),
    captureSelection: vi.fn(async () => ({ text: 'selected text' })),
    getContext: vi.fn(async () => ({ name: 'Notes' })),
    onState: (s) => void states.push(s),
    onResult: (r) => void calls.results.push(r),
    ...over
  }
  const rec = new Recorder(deps)
  const last = () => states[states.length - 1]
  return { rec, deps, states, calls, last }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Recorder', () => {
  it('ptt: press → recording, release → processing → done → idle', async () => {
    const { rec, calls, last, deps } = make()
    rec.pttPress()
    expect(last()).toMatchObject({ phase: 'recording', mode: 'ptt' })
    expect(calls.start).toEqual([{ deviceId: 'mic-1', mode: 'ptt' }])
    rec.pttRelease()
    expect(last()).toEqual({ phase: 'processing', mode: 'ptt' })
    expect(calls.stop).toBe(1)
    await rec.onAudio(audio(), 'audio/webm', 1500)
    expect(calls.inserted).toEqual(['Hello world.'])
    expect(last()).toEqual({ phase: 'done', mode: 'ptt', text: 'Hello world.', words: 2 })
    expect(calls.results).toHaveLength(1)
    const opts = (deps.api.dictate as ReturnType<typeof vi.fn>).mock.calls[0]![1]
    expect(opts).toMatchObject({ language: 'auto', cleanup: 'full', style: 'casual', app: { name: 'Notes' } })
    vi.advanceTimersByTime(DONE_SHOW_MS)
    expect(last()).toEqual({ phase: 'idle' })
    expect(rec.isBusy).toBe(false)
  })

  it('short ptt tap is cancelled silently (overlay told to cancel, no API call)', () => {
    const { rec, calls, last, deps } = make()
    rec.pttPress()
    rec.pttCancel()
    expect(last()).toEqual({ phase: 'idle' })
    expect(calls.cancel).toBe(1)
    expect(deps.api.dictate).not.toHaveBeenCalled()
  })

  it('ptt release/cancel do not affect a hands-free recording', () => {
    const { rec, last } = make()
    rec.toggleHandsFree()
    rec.pttRelease()
    rec.pttCancel()
    expect(last()).toMatchObject({ phase: 'recording', mode: 'handsfree' })
  })

  it('ptt press while hands-free ends it', () => {
    const { rec, last, calls } = make()
    rec.toggleHandsFree()
    rec.pttPress()
    expect(last()).toEqual({ phase: 'processing', mode: 'handsfree' })
    expect(calls.stop).toBe(1)
  })

  it('double-tap lock converts a running ptt recording to hands-free, keeping startedAt', () => {
    const { rec, states } = make({ now: () => 1234 })
    rec.pttPress()
    rec.lockHandsFree()
    expect(states[states.length - 1]).toEqual({ phase: 'recording', mode: 'handsfree', startedAt: 1234 })
  })

  it('double-tap lock from idle starts hands-free', () => {
    const { rec, last } = make()
    rec.lockHandsFree()
    expect(last()).toMatchObject({ phase: 'recording', mode: 'handsfree' })
  })

  it('toggleHandsFree twice: start then stop', () => {
    const { rec, last } = make()
    rec.toggleHandsFree()
    expect(rec.isRecording).toBe(true)
    rec.toggleHandsFree()
    expect(last()).toMatchObject({ phase: 'processing' })
  })

  it('ignores new starts while processing', async () => {
    let release!: (r: DictationResult) => void
    const { rec, last, calls } = make({ api: { dictate: () => new Promise((r) => (release = r)), command: vi.fn() as never } })
    rec.pttPress()
    rec.pttRelease()
    void rec.onAudio(audio(), 'audio/webm', 1000)
    await vi.advanceTimersByTimeAsync(0)
    rec.pttPress()
    rec.toggleHandsFree()
    rec.toggleCommand()
    expect(calls.start).toHaveLength(1)
    expect(last()).toMatchObject({ phase: 'processing' })
    release(dictation())
    await vi.advanceTimersByTimeAsync(0)
    expect(last()).toMatchObject({ phase: 'done' })
  })

  it('cancel during processing aborts the request and stays idle', async () => {
    let signal: AbortSignal | undefined
    const { rec, last, calls } = make({
      api: { dictate: (_a, _o, s) => new Promise((_r, rej) => { signal = s; s?.addEventListener('abort', () => rej(new Error('aborted'))) }), command: vi.fn() as never }
    })
    rec.toggleHandsFree()
    rec.toggleHandsFree()
    void rec.onAudio(audio(), 'audio/webm', 1000)
    await vi.advanceTimersByTimeAsync(0)
    rec.cancel()
    await vi.advanceTimersByTimeAsync(10)
    expect(signal?.aborted).toBe(true)
    expect(last()).toEqual({ phase: 'idle' })
    expect(calls.inserted).toEqual([])
  })

  it('cancel while recording tells the overlay and ignores late audio', async () => {
    const { rec, calls, last, deps } = make()
    rec.toggleHandsFree()
    rec.cancel()
    expect(calls.cancel).toBe(1)
    await rec.onAudio(audio(), 'audio/webm', 1000)
    expect(deps.api.dictate).not.toHaveBeenCalled()
    expect(last()).toEqual({ phase: 'idle' })
  })

  it('API failure → error state with short message → idle after 2.5 s', async () => {
    const { rec, last } = make({ api: { dictate: async () => { throw new ApiError('Server error (HTTP 500)', 500, 'x') }, command: vi.fn() as never } })
    rec.toggleHandsFree(); rec.toggleHandsFree()
    await rec.onAudio(audio(), 'audio/webm', 1000)
    expect(last()).toEqual({ phase: 'error', message: 'Server error (HTTP 500)' })
    vi.advanceTimersByTime(ERROR_SHOW_MS - 1)
    expect(last().phase).toBe('error')
    vi.advanceTimersByTime(1)
    expect(last()).toEqual({ phase: 'idle' })
  })

  it('network failure uses the short pill message', async () => {
    const { rec, last } = make({ api: { dictate: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }, command: vi.fn() as never } })
    rec.toggleHandsFree(); rec.toggleHandsFree()
    await rec.onAudio(audio(), 'audio/webm', 1000)
    expect(last()).toEqual({ phase: 'error', message: "Can't reach server" })
  })

  it('empty transcript: no insert, friendly error', async () => {
    const { rec, last, calls } = make({ api: { dictate: async () => dictation(''), command: vi.fn() as never } })
    rec.toggleHandsFree(); rec.toggleHandsFree()
    await rec.onAudio(audio(), 'audio/webm', 1000)
    expect(calls.inserted).toEqual([])
    expect(last()).toEqual({ phase: 'error', message: "Didn't catch that" })
    expect(calls.results).toHaveLength(1)
  })

  it('too-short audio is dropped silently', async () => {
    const { rec, last, deps } = make()
    rec.toggleHandsFree(); rec.toggleHandsFree()
    await rec.onAudio(audio(), 'audio/webm', 120)
    expect(deps.api.dictate).not.toHaveBeenCalled()
    expect(last()).toEqual({ phase: 'idle' })
  })

  it('missing audio from the overlay times out into an error', () => {
    const { rec, last, calls } = make()
    rec.toggleHandsFree(); rec.toggleHandsFree()
    vi.advanceTimersByTime(AUDIO_WAIT_MS)
    expect(last()).toMatchObject({ phase: 'error' })
    expect(calls.cancel).toBe(1)
  })

  it('capture error from the overlay surfaces the message', () => {
    const { rec, last } = make()
    rec.pttPress()
    rec.onCaptureError('Microphone access denied')
    expect(last()).toEqual({ phase: 'error', message: 'Microphone access denied' })
    expect(rec.isBusy).toBe(false)
  })

  it('auto-stops after the 6 minute maximum', () => {
    const { rec, last, calls } = make()
    rec.toggleHandsFree()
    vi.advanceTimersByTime(MAX_RECORDING_MS - 1)
    expect(rec.isRecording).toBe(true)
    vi.advanceTimersByTime(1)
    expect(last()).toMatchObject({ phase: 'processing' })
    expect(calls.stop).toBe(1)
  })

  it('a new recording can start while the done pill is still showing', async () => {
    const { rec, last } = make()
    rec.toggleHandsFree(); rec.toggleHandsFree()
    await rec.onAudio(audio(), 'audio/webm', 1000)
    expect(last().phase).toBe('done')
    rec.pttPress()
    expect(last()).toMatchObject({ phase: 'recording' })
    vi.advanceTimersByTime(DONE_SHOW_MS + 100)
    expect(last()).toMatchObject({ phase: 'recording' }) // stale done-timer must not reset it
  })

  describe('command mode', () => {
    it('captures the selection first, then records, then posts selected_text and pastes the result', async () => {
      const { rec, deps, last, calls } = make()
      rec.toggleCommand()
      await vi.advanceTimersByTimeAsync(0)
      expect(last()).toMatchObject({ phase: 'recording', mode: 'command' })
      rec.toggleCommand()
      await rec.onAudio(audio(), 'audio/webm', 1000)
      const opts = (deps.api.command as ReturnType<typeof vi.fn>).mock.calls[0]![1]
      expect(opts).toMatchObject({ selected_text: 'selected text', app: { name: 'Notes' } })
      expect(calls.inserted).toEqual(['Rewritten'])
      expect(last()).toMatchObject({ phase: 'done', mode: 'command' })
    })

    it('nothing selected → "Select some text first" and no recording', async () => {
      const { rec, last, calls } = make({ captureSelection: async () => null })
      rec.toggleCommand()
      await vi.advanceTimersByTimeAsync(0)
      expect(last()).toEqual({ phase: 'error', message: 'Select some text first' })
      expect(calls.start).toHaveLength(0)
      expect(rec.isBusy).toBe(false)
    })

    it('capture hint (e.g. missing Accessibility) is surfaced', async () => {
      const { rec, last } = make({ captureSelection: async () => ({ text: '', hint: 'Grant Accessibility to use command mode' }) })
      rec.toggleCommand()
      await vi.advanceTimersByTimeAsync(0)
      expect(last()).toEqual({ phase: 'error', message: 'Grant Accessibility to use command mode' })
    })

    it('cancel while capturing the selection aborts the start', async () => {
      let resolve!: (v: { text: string }) => void
      const { rec, last, calls } = make({ captureSelection: () => new Promise((r) => (resolve = r)) })
      rec.toggleCommand()
      rec.cancel()
      resolve({ text: 'x' })
      await vi.advanceTimersByTimeAsync(0)
      expect(calls.start).toHaveLength(0)
      expect(last()).toEqual({ phase: 'idle' })
    })
  })

  describe('insert outcomes', () => {
    it('copy-only hint → error state with the hint; result still emitted', async () => {
      const { rec, last, calls } = make({ insert: async () => ({ pasted: false, hint: 'Grant Accessibility to paste automatically' }) })
      rec.toggleHandsFree(); rec.toggleHandsFree()
      await rec.onAudio(audio(), 'audio/webm', 1000)
      expect(last()).toEqual({ phase: 'error', message: 'Grant Accessibility to paste automatically' })
      expect(calls.results).toHaveLength(1)
    })

    it('flash() shows a message only when idle', () => {
      const { rec, last } = make()
      rec.flash('Copied — press Cmd+V')
      expect(last()).toEqual({ phase: 'error', message: 'Copied — press Cmd+V' })
      rec.toggleHandsFree()
      rec.flash('ignored')
      expect(last()).toMatchObject({ phase: 'recording' })
    })
  })
})

describe('Recorder → archive hook', () => {
  const settingsOn = () => ({ ...defaultSettings('darwin'), micDeviceId: 'mic-1', archiveEnabled: true })

  it('archives after the paste with the audio, result, context and mode', async () => {
    const order: string[] = []
    const archive = vi.fn(async () => void order.push('archive'))
    const { rec } = make({ getSettings: settingsOn, archive, insert: vi.fn(async () => { order.push('insert'); return { pasted: true } }) })
    rec.toggleHandsFree()
    rec.stop()
    await rec.onAudio(audio(), 'audio/webm', 1500)
    expect(order).toEqual(['insert', 'archive'])
    const job = (archive.mock.calls[0] as unknown as [import('./archive-service').ArchiveJob])[0]
    expect(job).toMatchObject({ kind: 'dictation', mode: 'handsfree', audioMs: 1500, app: { name: 'Notes' }, requested: { language: 'auto', cleanup: 'full', style: 'casual' } })
    expect(job.audio.data.byteLength).toBe(5000)
    expect(job.result?.id).toBe('1')
    expect(job.error).toBeUndefined()
  })

  it('command jobs carry the selected text', async () => {
    const archive = vi.fn()
    const { rec } = make({ getSettings: settingsOn, archive })
    rec.toggleCommand()
    await vi.advanceTimersByTimeAsync(0)
    rec.stop()
    await rec.onAudio(audio(), 'audio/webm', 1500)
    expect(archive.mock.calls[0]![0]).toMatchObject({ kind: 'command', mode: 'command', selectedText: 'selected text' })
  })

  it('a failed request is archived with the error and the text is not pasted', async () => {
    const archive = vi.fn()
    const { rec, calls } = make({ getSettings: settingsOn, archive, api: { dictate: vi.fn(async () => { throw new ApiError('Server error (HTTP 500)', 500, 'http_500') }), command: vi.fn() } })
    rec.toggleHandsFree()
    rec.stop()
    await rec.onAudio(audio(), 'audio/webm', 1500)
    expect(calls.inserted).toEqual([])
    const job = archive.mock.calls[0]![0]
    expect(job.error).toBe('Server error (HTTP 500)')
    expect(job.result).toBeUndefined()
    expect(job.audio.data.byteLength).toBe(5000)
  })

  it('is not called when archiving is off, when cancelled, or for discarded short recordings', async () => {
    const archive = vi.fn()
    const off = make({ archive })
    off.rec.toggleHandsFree(); off.rec.stop()
    await off.rec.onAudio(audio(), 'audio/webm', 1500)
    const on = make({ getSettings: settingsOn, archive })
    on.rec.toggleHandsFree(); on.rec.stop()
    await on.rec.onAudio(audio(), 'audio/webm', 50) // too short
    const c = make({ getSettings: settingsOn, archive, api: { dictate: vi.fn((_a: Blob, _o: unknown, signal?: AbortSignal) => new Promise<DictationResult>((_res, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted'))))), command: vi.fn() } })
    c.rec.toggleHandsFree(); c.rec.stop()
    const p = c.rec.onAudio(audio(), 'audio/webm', 1500)
    await vi.advanceTimersByTimeAsync(0)
    c.rec.cancel()
    await p
    expect(archive).not.toHaveBeenCalled()
  })

  it('an archive failure never breaks the dictation flow', async () => {
    const { rec, last, calls } = make({ getSettings: settingsOn, archive: () => { throw new Error('disk full') } })
    rec.toggleHandsFree(); rec.stop()
    await rec.onAudio(audio(), 'audio/webm', 1500)
    expect(calls.inserted).toEqual(['Hello world.'])
    expect(last()).toMatchObject({ phase: 'done' })
  })
})


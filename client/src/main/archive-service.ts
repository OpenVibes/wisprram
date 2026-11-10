// Glue between the recorder / IPC handlers and the archive writer. No Electron imports (injected), so it is testable.
import { isAbsolute, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { AppContext, CommandResult, DictationResult, HistoryItem } from '@shared/api'
import type { ArchiveEntry, RecMode } from '@shared/ipc'
import type { ClientSettings } from '@shared/settings'
import {
  findEntryByHistoryId,
  isInside,
  NothingToSaveError,
  readRecent,
  realInside,
  togglesFromSettings,
  writeArchiveEntry,
  type ArchiveToggles,
  type ArchiveWrite
} from './archive'

/** One finished (or failed) recording handed over by the recorder after the text has been pasted. */
export interface ArchiveJob {
  kind: 'dictation' | 'command'
  mode: RecMode
  /** epoch ms */
  createdAt: number
  audio: { data: ArrayBuffer; mimeType: string }
  /** client-measured length of the recording */
  audioMs: number
  /** absent when the request failed */
  result?: DictationResult | CommandResult
  /** command mode: the text that was selected */
  selectedText?: string
  app?: AppContext
  requested?: { language: string; cleanup: string; style: string }
  /** request failed / could not be processed */
  error?: string
}

export interface ArchiveDeps {
  getSettings(): ClientSettings
  /** <Documents>/WisprRam */
  defaultDir(): string
  client(): { version: string; platform: string; arch: string }
  api: {
    historyGet(id: string): Promise<HistoryItem>
    historyAudio(id: string): Promise<{ data: ArrayBuffer; mimeType: string }>
  }
  onSaved(entry: ArchiveEntry): void
  /** non-blocking problem surfaced in AppStatus.hint; null clears it */
  setHint(text: string | null): void
  log(...a: unknown[]): void
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
export const isValidHistoryId = (id: unknown): id is string => typeof id === 'string' && ID_RE.test(id)

const countWords = (t: string): number => {
  const s = t.trim()
  return s ? s.split(/\s+/).length : 0
}
const msg = (e: unknown): string => (e instanceof Error && e.message ? e.message : String(e))

export class ArchiveService {
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly d: ArchiveDeps) {}

  /** Resolved archive folder in use. */
  folder(): string {
    const dir = (this.d.getSettings().archiveDir ?? '').trim()
    return dir || this.d.defaultDir()
  }

  /** Create the folder if needed and return it (throws a readable error when it is unusable). */
  async ensureFolder(): Promise<string> {
    const dir = this.folder()
    if (!isAbsolute(dir)) throw new Error('The archive folder must be an absolute path — choose a folder in Settings')
    try {
      await mkdir(dir, { recursive: true })
    } catch (err) {
      throw new Error(`Can't create the archive folder: ${msg(err)}`)
    }
    return dir
  }

  recent(limit = 20): Promise<ArchiveEntry[]> {
    const dir = this.folder()
    return isAbsolute(dir) ? readRecent(dir, limit) : Promise.resolve([])
  }

  /**
   * Validate a renderer-supplied path: it must exist and be inside the archive folder (symlinks resolved).
   * Returns the real path; throws otherwise.
   */
  async resolveInside(p: unknown): Promise<string> {
    if (typeof p !== 'string' || !p || p.includes('\0') || !isAbsolute(p)) throw new Error('Not a path inside the archive folder')
    const root = this.folder()
    if (!isInside(root, p)) throw new Error('Not a path inside the archive folder')
    const real = await realInside(root, p)
    if (!real) throw new Error('That archive entry no longer exists')
    return real
  }

  /** Automatic archive of a dictation/command. Never throws; failures become a hint. Serialized. */
  saveJob(job: ArchiveJob): Promise<void> {
    const run = this.chain.then(() => this.doSaveJob(job))
    this.chain = run.catch(() => undefined)
    return run.catch(() => undefined)
  }

  private async doSaveJob(job: ArchiveJob): Promise<void> {
    const s = this.d.getSettings()
    if (!s.archiveEnabled) return
    const toggles = togglesFromSettings(s)
    if (!anyOn(toggles)) return
    try {
      const root = await this.ensureFolder()
      const { entry, warnings } = await writeArchiveEntry(root, this.jobToWrite(job, s), toggles)
      this.afterWrite(entry, warnings)
    } catch (err) {
      this.failed(err)
    }
  }

  /** Manual: save a server-side history item (and its kept recording). Works even when archiveEnabled is off. */
  saveHistoryItem(id: string): Promise<ArchiveEntry> {
    const run = this.chain.then(() => this.doSaveHistory(id))
    this.chain = run.catch(() => undefined)
    return run
  }

  private async doSaveHistory(id: string): Promise<ArchiveEntry> {
    if (!isValidHistoryId(id)) throw new Error('Invalid history item')
    const s = this.d.getSettings()
    const toggles = togglesFromSettings(s)
    if (!anyOn(toggles)) throw new Error('Nothing to save — every archive file type is turned off in Settings')
    const root = await this.ensureFolder()
    const reuse = await findEntryByHistoryId(root, id)
    const item = await this.d.api.historyGet(id)
    let audio: ArchiveWrite['audio']
    const alreadyHasAudio = !!reuse?.files.some((f) => f.startsWith('audio.'))
    if (toggles.audio && item.has_audio && !alreadyHasAudio) {
      try {
        audio = await this.d.api.historyAudio(id)
      } catch (err) {
        throw new Error(`Couldn't download the recording: ${msg(err)}`)
      }
    }
    const w = this.historyToWrite(item, audio, s)
    try {
      const { entry, warnings } = await writeArchiveEntry(root, w, toggles, { reuse })
      this.afterWrite(entry, warnings, true)
      return entry
    } catch (err) {
      if (err instanceof NothingToSaveError) {
        throw new Error("Nothing to save — this item has no data for the selected file types (the server didn't keep a recording)")
      }
      throw new Error(`Couldn't write to the archive folder: ${msg(err)}`)
    }
  }

  // ---- mapping -----------------------------------------------------------------------------------
  private jobToWrite(job: ArchiveJob, s: ClientSettings): ArchiveWrite {
    const r = job.result
    const isCommand = job.kind === 'command'
    const dict = !isCommand ? (r as DictationResult | undefined) : undefined
    const cmd = isCommand ? (r as CommandResult | undefined) : undefined
    const created = new Date(job.createdAt)
    const timings = r?.timings
    const meta: Record<string, unknown> = {
      source: 'auto',
      history_id: r?.id ?? null,
      created_at: created.toISOString(),
      kind: job.kind,
      mode: job.mode,
      app: job.app ?? null,
      language: dict?.language ?? job.requested?.language ?? s.language,
      cleanup: dict?.cleanup ?? job.requested?.cleanup ?? s.cleanup,
      style: dict?.style ?? job.requested?.style ?? s.style,
      requested: job.requested ?? { language: s.language, cleanup: s.cleanup, style: s.style },
      server_url: s.serverUrl || null,
      stt_model: r?.stt_model ?? null,
      llm_model: r?.llm_model ?? null,
      timings: timings ?? null,
      cleanup_used: dict?.cleanup_used ?? null,
      applied_snippets: dict?.applied_snippets ?? [],
      audio_ms: dict?.audio_ms ?? Math.round(job.audioMs),
      word_count: dict?.word_count ?? countWords(r?.text ?? ''),
      has_server_audio: r?.has_audio ?? false,
      client: { app: 'WisprRam', ...this.d.client() }
    }
    const w: ArchiveWrite = {
      kind: job.kind,
      createdAt: created,
      audio: job.audio,
      meta,
      indexExtra: {
        mode: job.mode,
        app: job.app?.name ?? null,
        words: meta['word_count'],
        audioMs: meta['audio_ms']
      }
    }
    if (r?.id) w.historyId = r.id
    if (job.error) w.error = job.error
    if (r) {
      w.transcript = dict ? dict.raw_text : (cmd?.instruction ?? '')
      w.output = r.text
      if (isCommand && job.selectedText) w.input = job.selectedText
    } else if (isCommand && job.selectedText) {
      w.input = job.selectedText // nothing was transcribed, but keep what was selected
    }
    return w
  }

  private historyToWrite(item: HistoryItem, audio: ArchiveWrite['audio'], s: ClientSettings): ArchiveWrite {
    const sm = { ...(item.meta ?? {}) }
    const selected = typeof sm['selected_text'] === 'string' ? (sm['selected_text'] as string) : ''
    delete sm['selected_text'] // goes to input.txt, never into meta.json
    delete sm['instruction']
    const created = new Date(item.created_at)
    const createdAt = Number.isNaN(created.getTime()) ? new Date() : created
    const meta: Record<string, unknown> = {
      source: 'history',
      history_id: item.id,
      created_at: createdAt.toISOString(),
      kind: item.kind,
      mode: null,
      app: item.app_name ? { name: item.app_name } : null,
      server_url: s.serverUrl || null,
      audio_ms: item.audio_ms,
      word_count: item.word_count,
      has_server_audio: !!item.has_audio,
      ...sm,
      client: { app: 'WisprRam', ...this.d.client() }
    }
    const w: ArchiveWrite = {
      kind: item.kind,
      createdAt,
      historyId: item.id,
      meta,
      transcript: item.raw_text,
      output: item.text,
      indexExtra: { mode: null, app: item.app_name, words: item.word_count, audioMs: item.audio_ms }
    }
    if (audio) w.audio = audio
    if (item.kind === 'command' && selected) w.input = selected
    return w
  }

  // ---- outcome -----------------------------------------------------------------------------------
  private afterWrite(entry: ArchiveEntry, warnings: string[], manual = false): void {
    if (warnings.length) {
      this.d.log('archive: partial write', entry.path, warnings)
      if (!manual) this.d.setHint(`Saved to the archive with problems: ${warnings[0]}.`)
    } else {
      this.d.setHint(null)
    }
    try {
      this.d.onSaved(entry)
    } catch (err) {
      this.d.log('archive: onSaved failed', err)
    }
  }

  private failed(err: unknown): void {
    this.d.log('archive: write failed', err)
    this.d.setHint(`Couldn't save to the archive folder: ${msg(err)}. Your text was still inserted.`)
  }
}

function anyOn(t: ArchiveToggles): boolean {
  return t.audio || t.transcript || t.output || t.meta
}

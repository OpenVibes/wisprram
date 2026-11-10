// Local archive writer: pure Node fs (no Electron), so it can be unit-tested with a temp dir.
//
// Layout (see ArchiveEntry in shared/ipc.ts):
//   <root>/index.jsonl                         one JSON line per written entry (append-only)
//   <root>/YYYY-MM-DD/HHMMSS-<kind>-<id8>/     local date/time of the dictation
//       audio.<ext>  transcript.txt  input.txt  output.txt  meta.json
import { randomBytes } from 'node:crypto'
import { appendFile, mkdir, open, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ArchiveEntry } from '@shared/ipc'
import type { ClientSettings } from '@shared/settings'

export const INDEX_FILE = 'index.jsonl'
export const META_SCHEMA = 1
/** How much of index.jsonl's tail is read when listing / looking up entries. */
export const INDEX_TAIL_BYTES = 2 * 1024 * 1024
const PREVIEW_CHARS = 80

export interface ArchiveToggles {
  audio: boolean
  transcript: boolean
  output: boolean
  meta: boolean
}

/** Missing (older settings file) toggles count as on. */
export function togglesFromSettings(s: Pick<ClientSettings, 'archiveAudio' | 'archiveTranscript' | 'archiveOutput' | 'archiveMeta'>): ArchiveToggles {
  return {
    audio: s.archiveAudio !== false,
    transcript: s.archiveTranscript !== false,
    output: s.archiveOutput !== false,
    meta: s.archiveMeta !== false
  }
}

export interface ArchiveWrite {
  kind: 'dictation' | 'command'
  createdAt: Date
  historyId?: string
  audio?: { data: ArrayBuffer | Uint8Array; mimeType: string }
  /** dictation: raw Whisper text; command: the spoken instruction */
  transcript?: string
  /** command mode: the selected text that was edited */
  input?: string
  /** final text inserted / model output */
  output?: string
  /** everything known about the dictation; the writer adds `schema` and `files` */
  meta: Record<string, unknown>
  /** request failed: transcript/output are omitted by the caller; meta.json is always written so the failure is recorded */
  error?: string
  /** extra fields stored on the index.jsonl line */
  indexExtra?: Record<string, unknown>
}

export interface WriteOptions {
  /** write into this existing entry folder and only create files that are missing (top-up of a prior save) */
  reuse?: ArchiveEntry | null
}

export interface WriteResult {
  entry: ArchiveEntry
  /** non-fatal per-file failures (the entry still exists and was indexed) */
  warnings: string[]
}

export class NothingToSaveError extends Error {
  constructor() {
    super('Nothing to save with the current archive settings')
    this.name = 'NothingToSaveError'
  }
}

// ---- paths ----------------------------------------------------------------------------------------

export function extForMime(mime: string | undefined): string {
  const m = (mime ?? '').toLowerCase().split(';')[0]!.trim()
  if (m.includes('webm')) return 'webm'
  if (m.includes('ogg') || m.includes('opus')) return 'ogg'
  if (m.includes('wav') || m.includes('wave')) return 'wav'
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a'
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  if (m.includes('flac')) return 'flac'
  return 'webm'
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
export const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const localTime = (d: Date): string => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

/** First 8 alphanumerics of the history id, or 8 random hex chars. */
export function shortId(historyId?: string): string {
  const clean = (historyId ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8)
  return clean || randomBytes(4).toString('hex')
}

export function entryRelPath(w: Pick<ArchiveWrite, 'kind' | 'createdAt' | 'historyId'>): string {
  return `${localDate(w.createdAt)}/${localTime(w.createdAt)}-${w.kind}-${shortId(w.historyId)}`
}

/** True when `target` is `root` itself or lies below it (lexical check, both resolved). */
export function isInside(root: string, target: string): boolean {
  if (!root || !target) return false
  const rel = relative(resolve(root), resolve(target))
  if (rel === '') return true
  if (rel === '..' || rel.startsWith(`..${sep}`)) return false
  return !isAbsolute(rel)
}

/** Like isInside but follows symlinks; `target` must exist. Resolves to the real path or null. */
export async function realInside(root: string, target: string): Promise<string | null> {
  try {
    const [r, t] = await Promise.all([realpath(root), realpath(target)])
    return isInside(r, t) ? t : null
  } catch {
    return null
  }
}

// ---- file helpers ---------------------------------------------------------------------------------

async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${randomBytes(3).toString('hex')}.tmp`
  try {
    await writeFile(tmp, data)
    await rename(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

function toBytes(d: ArrayBuffer | Uint8Array): Uint8Array {
  return d instanceof Uint8Array ? d : new Uint8Array(d)
}

function makePreview(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > PREVIEW_CHARS ? `${t.slice(0, PREVIEW_CHARS - 1)}…` : t
}

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// ---- writer ---------------------------------------------------------------------------------------

/**
 * Write one entry. Throws only when nothing at all could be written (or there was nothing to write);
 * per-file failures after the first successful file come back as `warnings`.
 */
export async function writeArchiveEntry(root: string, w: ArchiveWrite, toggles: ArchiveToggles, opts: WriteOptions = {}): Promise<WriteResult> {
  if (!root || !isAbsolute(root)) throw new Error('The archive folder must be an absolute path')

  const topUp = !!opts.reuse && (await exists(opts.reuse.path))
  const rel = topUp && opts.reuse ? relative(root, opts.reuse.path).split(sep).join('/') : entryRelPath(w)
  const dir = topUp && opts.reuse ? opts.reuse.path : join(root, ...rel.split('/'))
  const have = new Set(topUp ? await readdir(dir).catch(() => [] as string[]) : [])
  const hasAudioAlready = [...have].some((f) => f.startsWith('audio.'))

  type Job = { name: string; data: string | Uint8Array }
  const jobs: Job[] = []
  if (toggles.audio && w.audio && w.audio.data.byteLength > 0 && !hasAudioAlready) {
    jobs.push({ name: `audio.${extForMime(w.audio.mimeType)}`, data: toBytes(w.audio.data) })
  }
  if (toggles.transcript && w.transcript?.trim()) jobs.push({ name: 'transcript.txt', data: w.transcript })
  if (toggles.transcript && w.input?.trim()) jobs.push({ name: 'input.txt', data: w.input })
  if (toggles.output && w.output?.trim()) jobs.push({ name: 'output.txt', data: w.output })
  const writeMeta = toggles.meta || !!w.error
  const todo = jobs.filter((j) => !have.has(j.name))
  if (todo.length === 0 && !(writeMeta && !have.has('meta.json'))) {
    if (topUp && opts.reuse) return { entry: opts.reuse, warnings: [] }
    throw new NothingToSaveError()
  }

  await mkdir(dir, { recursive: true })
  const written: string[] = []
  const warnings: string[] = []
  let firstError: unknown
  const put = async (name: string, data: string | Uint8Array): Promise<void> => {
    try {
      await atomicWrite(join(dir, name), data)
      written.push(name)
    } catch (err) {
      firstError ??= err
      warnings.push(`${name}: ${msg(err)}`)
    }
  }
  for (const j of todo) await put(j.name, j.data) // audio first: it is the irreplaceable part

  if (writeMeta && !have.has('meta.json')) {
    const files = [...new Set([...have, ...written, 'meta.json'])].filter((f) => !f.endsWith('.tmp')).sort()
    const body = { schema: META_SCHEMA, ...w.meta, ...(w.error ? { error: w.error } : {}), files }
    await put('meta.json', `${JSON.stringify(body, null, 2)}\n`)
  }
  if (written.length === 0) {
    if (!topUp) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    throw firstError ?? new NothingToSaveError()
  }

  const files = [...new Set([...have, ...written])].filter((f) => !f.endsWith('.tmp')).sort()
  const preview = toggles.output || toggles.transcript ? makePreview(w.output || w.transcript || '') : ''
  const entry: ArchiveEntry = {
    path: dir,
    files,
    kind: w.kind,
    createdAt: w.createdAt.toISOString(),
    preview: preview || (w.error ? makePreview(`Failed: ${w.error}`) : '')
  }
  if (w.historyId) entry.historyId = w.historyId

  try {
    await appendIndex(root, { ...entry, rel, ...(w.indexExtra ?? {}), ...(w.error ? { error: w.error } : {}) })
  } catch (err) {
    warnings.push(`${INDEX_FILE}: ${msg(err)}`)
  }
  return { entry, warnings }
}

async function appendIndex(root: string, line: Record<string, unknown>): Promise<void> {
  const file = join(root, INDEX_FILE)
  await mkdir(dirname(file), { recursive: true })
  // A crash can leave a last line without "\n"; start a fresh line so one bad line never eats the next entry.
  let prefix = ''
  try {
    const fh = await open(file, 'r')
    try {
      const { size } = await fh.stat()
      if (size > 0) {
        const b = Buffer.alloc(1)
        await fh.read(b, 0, 1, size - 1)
        if (b[0] !== 0x0a) prefix = '\n'
      }
    } finally {
      await fh.close()
    }
  } catch {
    /* new file */
  }
  await appendFile(file, `${prefix}${JSON.stringify(line)}\n`)
}

// ---- reading the index ----------------------------------------------------------------------------

/** Parse the tail of index.jsonl. Newest first; corrupt lines and entries outside `root` are skipped. */
export async function readIndexTail(root: string, maxBytes = INDEX_TAIL_BYTES): Promise<ArchiveEntry[]> {
  let text: string
  try {
    const fh = await open(join(root, INDEX_FILE), 'r')
    try {
      const { size } = await fh.stat()
      const len = Math.min(size, maxBytes)
      const buf = Buffer.alloc(len)
      if (len > 0) await fh.read(buf, 0, len, size - len)
      text = buf.toString('utf8')
      if (size > len) text = text.slice(text.indexOf('\n') + 1) // first line is cut
    } finally {
      await fh.close()
    }
  } catch {
    return []
  }
  const out: ArchiveEntry[] = []
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.trim()
    if (!l) continue
    const e = parseIndexLine(root, l)
    if (e) out.push(e)
  }
  return out
}

function parseIndexLine(root: string, line: string): ArchiveEntry | null {
  let o: Record<string, unknown>
  try {
    const v = JSON.parse(line) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    o = v as Record<string, unknown>
  } catch {
    return null
  }
  if (o['kind'] !== 'dictation' && o['kind'] !== 'command') return null
  if (typeof o['createdAt'] !== 'string') return null
  // `rel` keeps the archive relocatable; older/other lines fall back to the absolute path.
  let path: string
  if (typeof o['rel'] === 'string' && o['rel']) path = join(root, ...o['rel'].split('/'))
  else if (typeof o['path'] === 'string' && o['path']) path = o['path']
  else return null
  if (!isInside(root, path) || resolve(path) === resolve(root)) return null
  const entry: ArchiveEntry = {
    path,
    files: Array.isArray(o['files']) ? o['files'].filter((f): f is string => typeof f === 'string') : [],
    kind: o['kind'],
    createdAt: o['createdAt'],
    preview: typeof o['preview'] === 'string' ? o['preview'] : ''
  }
  if (typeof o['historyId'] === 'string') entry.historyId = o['historyId']
  return entry
}

/** Most recent entries whose folder still exists. A re-saved entry appears once (at its latest position). */
export async function readRecent(root: string, limit = 20): Promise<ArchiveEntry[]> {
  const n = Math.max(1, Math.min(Math.floor(limit) || 20, 500))
  const seen = new Set<string>()
  const out: ArchiveEntry[] = []
  for (const e of await readIndexTail(root)) {
    if (seen.has(e.path)) continue
    seen.add(e.path)
    if (!(await exists(e.path))) continue
    out.push(e)
    if (out.length >= n) break
  }
  return out
}

/** The newest still-existing entry written for a history id, if any. */
export async function findEntryByHistoryId(root: string, historyId: string): Promise<ArchiveEntry | null> {
  for (const e of await readIndexTail(root)) {
    if (e.historyId === historyId && (await exists(e.path))) {
      // refresh the file list from disk: files may have been added or removed by hand
      const files = await readdir(e.path).catch(() => e.files)
      return { ...e, files: files.filter((f) => !f.endsWith('.tmp')).sort() }
    }
  }
  return null
}

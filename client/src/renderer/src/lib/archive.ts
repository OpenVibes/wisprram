// Pure helpers for the v0.2 archive / recordings UI. No DOM or bridge access, so they are unit tested.
import { DEFAULT_SERVER_PORT } from '../../../shared/api'
import { formatMs, truncate } from './format'

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string }

/**
 * Validates and normalises what the user typed as the server address.
 * "192.168.1.50" → "http://192.168.1.50:8790" (scheme and default port assumed when both are missing),
 * trailing slashes, query and hash are dropped.
 */
export function validateServerUrl(raw: string): UrlCheck {
  const t = raw.trim()
  if (!t) return { ok: false, error: 'Enter the address of your server.' }
  if (/\s/.test(t)) return { ok: false, error: 'The address cannot contain spaces.' }
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(t)
  if (scheme && !/^https?$/i.test(scheme[1])) return { ok: false, error: 'Start the address with http:// or https://.' }
  let u: URL
  try {
    u = new URL(scheme ? t : `http://${t}`)
  } catch {
    return { ok: false, error: `That does not look like a valid address. Try http://192.168.1.50:${DEFAULT_SERVER_PORT}.` }
  }
  if (!u.hostname) return { ok: false, error: 'The address is missing a host name or IP.' }
  if (u.username || u.password) return { ok: false, error: 'Leave the user name and password out of the address.' }
  if (!scheme && !u.port) u.port = String(DEFAULT_SERVER_PORT)
  const path = u.pathname.replace(/\/+$/, '')
  return { ok: true, url: `${u.protocol}//${u.host}${path}` }
}

/** True for POSIX absolute (`/x`), Windows drive (`C:\x`, `C:/x`) and UNC (`\\host\share`) paths. */
export function isAbsolutePath(p: string): boolean {
  return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(p.trim())
}

/** "/Users/me/Documents/WisprRam/archive" → "/Users/me/…/archive" (keeps the start and the tail). */
export function middleEllipsis(s: string, max: number): string {
  if (s.length <= max || max < 8) return s
  const tail = Math.ceil((max - 1) * 0.6)
  const head = max - 1 - tail
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`
}

export interface ArchiveSelection {
  archiveAudio?: boolean
  archiveTranscript?: boolean
  archiveOutput?: boolean
  archiveMeta?: boolean
}

/** The folder layout hint, reflecting which files are currently selected. */
export function layoutExample(sel: ArchiveSelection): string {
  const files = [sel.archiveAudio !== false && 'audio.webm', sel.archiveTranscript !== false && 'transcript.txt', sel.archiveOutput !== false && 'output.txt', sel.archiveMeta !== false && 'meta.json'].filter(Boolean) as string[]
  const lines = ['2026-11-09/', '  193412-dictation-6ab1e37e/']
  if (files.length === 0) lines.push('    (nothing selected)')
  for (const f of files) lines.push(`    ${f}`)
  return lines.join('\n')
}

export interface MetaRow {
  label: string
  value: string
}

const CLEANUP_LABEL: Record<string, string> = { none: 'None', light: 'Light', full: 'Full AI' }
const STYLE_LABEL: Record<string, string> = { formal: 'Formal', casual: 'Casual', very_casual: 'Very casual' }
const USED_LABEL: Record<string, string> = { llm: 'AI model', rules: 'Rules only', none: 'Not cleaned' }

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Turns a HistoryItem.meta blob into labelled rows. Tolerates missing or oddly-typed fields. */
export function metaRows(meta: Record<string, unknown> | null | undefined, appName?: string | null): MetaRow[] {
  const rows: MetaRow[] = []
  const add = (label: string, value: string | null): void => {
    if (value) rows.push({ label, value })
  }
  const m = meta ?? {}
  add('Speech model', str(m.stt_model))
  add('Language model', str(m.llm_model))
  const cleanup = str(m.cleanup)
  const used = str(m.cleanup_used)
  add('Cleanup', cleanup ? `${CLEANUP_LABEL[cleanup] ?? cleanup}${used ? ` · ${USED_LABEL[used] ?? used}` : ''}` : used ? (USED_LABEL[used] ?? used) : null)
  const style = str(m.style)
  add('Style', style ? (STYLE_LABEL[style] ?? style) : null)
  add('Language', str(m.language))
  add('App', str(appName) ?? null)
  const t = m.timings && typeof m.timings === 'object' ? (m.timings as Record<string, unknown>) : null
  if (t) {
    const parts: string[] = []
    const stt = num(t.stt_ms)
    const llm = num(t.llm_ms)
    const total = num(t.total_ms)
    if (stt !== null) parts.push(`Speech ${formatMs(stt)}`)
    if (llm !== null) parts.push(`Cleanup ${formatMs(llm)}`)
    if (total !== null) parts.push(`Total ${formatMs(total)}`)
    add('Timings', parts.join(' · ') || null)
  }
  if (Array.isArray(m.applied_snippets) && m.applied_snippets.length > 0) add('Snippets used', m.applied_snippets.filter((x) => typeof x === 'string').join(', ') || null)
  const sel = str(m.selected_text)
  add('Selected text', sel ? truncate(sel, 140) : null)
  return rows
}

/** Which files an entry contains, in a readable form: "audio, transcript, final text, details". */
export function describeFiles(files: string[]): string {
  const names: Array<[string, string]> = [
    ['audio.', 'audio'],
    ['transcript.txt', 'transcript'],
    ['output.txt', 'final text'],
    ['meta.json', 'details']
  ]
  const out = names.filter(([prefix]) => files.some((f) => f.startsWith(prefix))).map(([, label]) => label)
  return out.length ? out.join(', ') : 'no files'
}

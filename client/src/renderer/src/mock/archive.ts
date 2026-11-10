// Pure pieces of the mock archive and the generated demo audio. Mirrors the real layout described in
// shared/ipc.ts (ArchiveEntry): <archive>/<YYYY-MM-DD>/<HHMMSS>-<kind>-<id8>/{audio.webm,transcript.txt,output.txt,meta.json}
import type { HistoryItem } from '../../../shared/api'
import type { ArchiveEntry } from '../../../shared/ipc'
import type { ClientSettings } from '../../../shared/settings'

const pad = (n: number): string => String(n).padStart(2, '0')

/** "<date>/<time>-<kind>-<id8>" in local time. */
export function entryRelPath(createdAt: string, kind: string, id: string): string {
  const d = new Date(createdAt)
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const short = id.replace(/[^a-z0-9]/gi, '').slice(-8).padStart(8, '0')
  return `${day}/${time}-${kind}-${short}`
}

type Sel = Pick<ClientSettings, 'archiveAudio' | 'archiveTranscript' | 'archiveOutput' | 'archiveMeta'>

export function archiveFiles(sel: Sel, hasAudio: boolean): string[] {
  const files: string[] = []
  if (sel.archiveAudio !== false && hasAudio) files.push('audio.wav')
  if (sel.archiveTranscript !== false) files.push('transcript.txt')
  if (sel.archiveOutput !== false) files.push('output.txt')
  if (sel.archiveMeta !== false) files.push('meta.json')
  return files
}

export function buildArchiveEntry(item: HistoryItem, sel: Sel, folder: string): ArchiveEntry {
  return {
    path: `${folder.replace(/[\\/]+$/, '')}/${entryRelPath(item.created_at, item.kind, item.id)}`,
    files: archiveFiles(sel, !!item.has_audio),
    historyId: item.id,
    kind: item.kind,
    createdAt: item.created_at,
    preview: item.text.replace(/\s+/g, ' ').trim().slice(0, 80)
  }
}

/**
 * A short, pleasant 16-bit mono WAV so playback works in a plain browser: a few soft sine "syllables"
 * with a gentle envelope, deterministic per `seed`. Returns the complete file.
 */
export function makeWav(durationMs: number, seed = 1, sampleRate = 16000): ArrayBuffer {
  const n = Math.max(1, Math.round((Math.min(Math.max(durationMs, 300), 20_000) / 1000) * sampleRate))
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + n * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, n * 2, true)
  const syllable = Math.round(sampleRate * 0.16)
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i / syllable)
    const t = (i % syllable) / syllable
    const freq = 180 + ((k * 37 + seed * 53) % 7) * 40
    const env = Math.sin(Math.PI * t) ** 2 * (k % 5 === 4 ? 0 : 1) // short pause every 5th syllable
    const fade = Math.min(1, i / 400, (n - i) / 400)
    const x = 0.22 * env * fade * (Math.sin((2 * Math.PI * freq * i) / sampleRate) + 0.4 * Math.sin((4 * Math.PI * freq * i) / sampleRate))
    v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x)) * 32767), true)
  }
  return buf
}

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryItem } from '@shared/api'
import type { ArchiveEntry } from '@shared/ipc'
import { defaultSettings, type ClientSettings } from '../shared/settings'
import { ArchiveService, isValidHistoryId, type ArchiveDeps, type ArchiveJob } from './archive-service'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wisprram-svc-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function make(over: Partial<ClientSettings> = {}, api: Partial<ArchiveDeps['api']> = {}) {
  const settings: ClientSettings = { ...defaultSettings('darwin'), archiveEnabled: true, archiveDir: root, serverUrl: 'http://192.168.1.50:8790', ...over }
  const saved: ArchiveEntry[] = []
  const hints: (string | null)[] = []
  const deps: ArchiveDeps = {
    getSettings: () => settings,
    defaultDir: () => join(root, 'default'),
    client: () => ({ version: '0.2.0', platform: 'darwin', arch: 'arm64' }),
    api: {
      historyGet: vi.fn(async (id: string): Promise<HistoryItem> => ({ id, created_at: '2026-11-09T10:00:00Z', kind: 'dictation', raw_text: 'raw', text: 'Final.', app_name: 'Notes', audio_ms: 1000, word_count: 1 })),
      historyAudio: vi.fn(async () => ({ data: new Uint8Array(6).buffer as ArrayBuffer, mimeType: 'audio/wav' })),
      ...api
    },
    onSaved: (e) => void saved.push(e),
    setHint: (t) => void hints.push(t),
    log: () => undefined
  }
  return { svc: new ArchiveService(deps), saved, hints, deps, settings }
}

const job = (over: Partial<ArchiveJob> = {}): ArchiveJob => ({
  kind: 'dictation',
  mode: 'ptt',
  createdAt: new Date(2026, 10, 9, 8, 5, 3).getTime(),
  audio: { data: new Uint8Array(8).buffer as ArrayBuffer, mimeType: 'audio/webm' },
  audioMs: 1500,
  app: { name: 'Notes', bundle_id: 'com.apple.Notes' },
  requested: { language: 'auto', cleanup: 'full', style: 'casual' },
  result: {
    id: 'abcdef0123456789', raw_text: 'hello', text: 'Hello.', language: 'en', audio_ms: 1480, word_count: 1,
    timings: { stt_ms: 1, llm_ms: 2, total_ms: 3 }, applied_snippets: ['x'], cleanup_used: 'llm', stt_model: 'large-v3', llm_model: 'qwen'
  },
  ...over
})

describe('ArchiveService.saveJob', () => {
  it('writes the entry with the documented meta and notifies', async () => {
    const { svc, saved, hints } = make()
    await svc.saveJob(job())
    expect(saved).toHaveLength(1)
    const e = saved[0]!
    expect(e.path).toBe(join(root, '2026-11-09', '080503-dictation-abcdef01'))
    const meta = JSON.parse(await readFile(join(e.path, 'meta.json'), 'utf8'))
    expect(meta).toMatchObject({
      schema: 1, source: 'auto', history_id: 'abcdef0123456789', kind: 'dictation', mode: 'ptt',
      app: { name: 'Notes', bundle_id: 'com.apple.Notes' }, language: 'en', cleanup: 'full', style: 'casual',
      server_url: 'http://192.168.1.50:8790', stt_model: 'large-v3', llm_model: 'qwen', cleanup_used: 'llm',
      applied_snippets: ['x'], audio_ms: 1480, word_count: 1, client: { app: 'WisprRam', version: '0.2.0', platform: 'darwin', arch: 'arm64' }
    })
    expect(meta.timings).toEqual({ stt_ms: 1, llm_ms: 2, total_ms: 3 })
    expect(hints.at(-1)).toBeNull()
  })

  it('does nothing when archiving is disabled', async () => {
    const { svc, saved } = make({ archiveEnabled: false })
    await svc.saveJob(job())
    expect(saved).toEqual([])
  })

  it('command: transcript is the instruction, input.txt the selection', async () => {
    const { svc, saved } = make()
    await svc.saveJob(job({ kind: 'command', mode: 'command', selectedText: 'old text', result: { id: 'c0ffee00aa', instruction: 'shorten it', text: 'new', timings: { stt_ms: 1, llm_ms: 1, total_ms: 2 } } }))
    const p = saved[0]!.path
    expect(await readFile(join(p, 'transcript.txt'), 'utf8')).toBe('shorten it')
    expect(await readFile(join(p, 'input.txt'), 'utf8')).toBe('old text')
    expect(await readFile(join(p, 'output.txt'), 'utf8')).toBe('new')
  })

  it('failed request: audio + meta with error, no text files', async () => {
    const { svc, saved } = make()
    await svc.saveJob(job({ result: undefined, error: "Can't reach the server at 192.168.1.50:8790" }))
    const e = saved[0]!
    expect(e.files).toEqual(['audio.webm', 'meta.json'])
    const meta = JSON.parse(await readFile(join(e.path, 'meta.json'), 'utf8'))
    expect(meta.error).toMatch(/Can't reach/)
    expect(meta.history_id).toBeNull()
    expect(meta.audio_ms).toBe(1500)
  })

  it('never throws: an unusable folder becomes a hint', async () => {
    const { svc, saved, hints } = make({ archiveDir: 'not/absolute' })
    await expect(svc.saveJob(job())).resolves.toBeUndefined()
    expect(saved).toEqual([])
    expect(hints.at(-1)).toMatch(/Couldn't save to the archive folder.*absolute.*still inserted/)
  })

  it('serializes concurrent writes into one well-formed index', async () => {
    const { svc } = make()
    await Promise.all([1, 2, 3, 4, 5].map((i) => svc.saveJob(job({ createdAt: new Date(2026, 10, 9, 8, 5, i).getTime(), result: { ...job().result!, id: `id${i}aaaaaaaa` } }))))
    const lines = (await readFile(join(root, 'index.jsonl'), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(5)
    lines.forEach((l) => JSON.parse(l))
    expect(await svc.recent(10)).toHaveLength(5)
  })
})

describe('ArchiveService.saveHistoryItem', () => {
  it('saves text + server audio even when archiveEnabled is off', async () => {
    const { svc, deps } = make({ archiveEnabled: false }, { historyGet: async (id) => ({ id, created_at: '2026-11-09T10:00:00Z', kind: 'dictation', raw_text: 'raw', text: 'Final.', app_name: 'Notes', audio_ms: 1000, word_count: 1, has_audio: true, meta: { stt_model: 'm', language: 'en' } }) })
    const e = await svc.saveHistoryItem('abc123def456')
    expect(e.files).toEqual(['audio.wav', 'meta.json', 'output.txt', 'transcript.txt'])
    expect(deps.api.historyAudio).toHaveBeenCalledWith('abc123def456')
    const meta = JSON.parse(await readFile(join(e.path, 'meta.json'), 'utf8'))
    expect(meta).toMatchObject({ source: 'history', history_id: 'abc123def456', stt_model: 'm', language: 'en', has_server_audio: true })
  })

  it('skips the audio download when the toggle is off, and keeps selected_text out of meta', async () => {
    const { svc, deps } = make(
      { archiveAudio: false },
      { historyGet: async (id) => ({ id, created_at: '2026-11-09T10:00:00Z', kind: 'command', raw_text: 'make it loud', text: 'LOUD', app_name: null, audio_ms: 1, word_count: 1, has_audio: true, meta: { selected_text: 'quiet' } }) }
    )
    const e = await svc.saveHistoryItem('cmd0001')
    expect(deps.api.historyAudio).not.toHaveBeenCalled()
    expect(await readFile(join(e.path, 'input.txt'), 'utf8')).toBe('quiet')
    expect(await readFile(join(e.path, 'meta.json'), 'utf8')).not.toContain('quiet')
  })

  it('is idempotent and tops up an existing entry instead of creating a duplicate', async () => {
    const { svc } = make()
    const a = await svc.saveHistoryItem('same-id-1')
    const b = await svc.saveHistoryItem('same-id-1')
    expect(b.path).toBe(a.path)
    expect(await svc.recent(10)).toHaveLength(1)
  })

  it('rejects bad ids, all-off toggles and failed audio downloads with readable messages', async () => {
    const { svc } = make()
    await expect(svc.saveHistoryItem('../x')).rejects.toThrow('Invalid history item')
    const off = make({ archiveAudio: false, archiveTranscript: false, archiveOutput: false, archiveMeta: false })
    await expect(off.svc.saveHistoryItem('abc')).rejects.toThrow(/every archive file type is turned off/)
    const bad = make({}, { historyGet: async (id) => ({ id, created_at: 'x', kind: 'dictation', raw_text: '', text: 't', app_name: null, audio_ms: 0, word_count: 1, has_audio: true }), historyAudio: async () => { throw new Error('gone') } })
    await expect(bad.svc.saveHistoryItem('abc')).rejects.toThrow("Couldn't download the recording: gone")
  })
})

describe('ArchiveService paths', () => {
  it('folder() falls back to the default dir', () => {
    expect(make({ archiveDir: '' }).svc.folder()).toBe(join(root, 'default'))
    expect(make({ archiveDir: '   ' }).svc.folder()).toBe(join(root, 'default'))
  })

  it('resolveInside accepts entries and rejects outside / relative / missing paths', async () => {
    const { svc, saved } = make()
    await svc.saveJob(job())
    expect(await svc.resolveInside(saved[0]!.path)).toBeTruthy()
    await expect(svc.resolveInside('/etc')).rejects.toThrow(/Not a path inside/)
    await expect(svc.resolveInside(join(root, '..', 'x'))).rejects.toThrow(/Not a path inside/)
    await expect(svc.resolveInside('relative')).rejects.toThrow(/Not a path inside/)
    await expect(svc.resolveInside(undefined)).rejects.toThrow(/Not a path inside/)
    await expect(svc.resolveInside(join(root, 'nope'))).rejects.toThrow(/no longer exists/)
  })

  it('validates history ids', () => {
    expect(isValidHistoryId('6ab1e37e-1111-2222-3333-444455556666')).toBe(true)
    for (const bad of ['', '../x', 'a/b', 'a b', 5, null, 'x'.repeat(65)]) expect(isValidHistoryId(bad)).toBe(false)
  })
})

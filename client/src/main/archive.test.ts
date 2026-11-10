import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  entryRelPath,
  extForMime,
  findEntryByHistoryId,
  isInside,
  NothingToSaveError,
  readIndexTail,
  readRecent,
  realInside,
  togglesFromSettings,
  writeArchiveEntry,
  type ArchiveToggles,
  type ArchiveWrite
} from './archive'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wisprram-archive-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const ALL: ArchiveToggles = { audio: true, transcript: true, output: true, meta: true }
const audio = (n = 10) => ({ data: new Uint8Array(n).fill(7), mimeType: 'audio/webm;codecs=opus' })
const base = (over: Partial<ArchiveWrite> = {}): ArchiveWrite => ({
  kind: 'dictation',
  createdAt: new Date(2026, 10, 9, 19, 34, 12), // local time
  historyId: '6ab1e37e-1111-2222-3333-444455556666',
  audio: audio(),
  transcript: 'hello world raw',
  output: 'Hello, world.',
  meta: { kind: 'dictation', mode: 'ptt' },
  ...over
})
const ls = (p: string) => readdir(p).then((f) => f.sort())

describe('helpers', () => {
  it('maps mime types to extensions (default webm)', () => {
    expect(extForMime('audio/webm;codecs=opus')).toBe('webm')
    expect(extForMime('audio/ogg')).toBe('ogg')
    expect(extForMime('audio/wav')).toBe('wav')
    expect(extForMime('audio/x-wav')).toBe('wav')
    expect(extForMime('audio/mp4')).toBe('m4a')
    expect(extForMime('audio/x-m4a')).toBe('m4a')
    expect(extForMime('application/octet-stream')).toBe('webm')
    expect(extForMime(undefined)).toBe('webm')
  })

  it('builds <local date>/<HHMMSS>-<kind>-<id8>', () => {
    expect(entryRelPath(base())).toBe('2026-11-09/193412-dictation-6ab1e37e')
    expect(entryRelPath(base({ kind: 'command', historyId: undefined }))).toMatch(/^2026-11-09\/193412-command-[0-9a-f]{8}$/)
  })

  it('toggles default to on when settings predate v0.2', () => {
    expect(togglesFromSettings({})).toEqual(ALL)
    expect(togglesFromSettings({ archiveAudio: false })).toEqual({ ...ALL, audio: false })
  })

  it('isInside / realInside contain paths', async () => {
    expect(isInside('/a/b', '/a/b')).toBe(true)
    expect(isInside('/a/b', '/a/b/c/d')).toBe(true)
    expect(isInside('/a/b', '/a/bc')).toBe(false)
    expect(isInside('/a/b', '/a/b/../c')).toBe(false)
    expect(isInside('/a/b', '/etc/passwd')).toBe(false)
    expect(isInside('/a/b', '')).toBe(false)
    expect(isInside('/a/b', '/a/b/..x')).toBe(true) // a name that merely starts with two dots
    // symlink escaping the root is rejected, a real child is accepted
    const outside = await mkdtemp(join(tmpdir(), 'wisprram-outside-'))
    try {
      await symlink(outside, join(root, 'link'))
      await mkdir(join(root, 'real'))
      expect(await realInside(root, join(root, 'link'))).toBeNull()
      expect(await realInside(root, join(root, 'real'))).not.toBeNull()
      expect(await realInside(root, join(root, 'missing'))).toBeNull()
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})

describe('writeArchiveEntry', () => {
  it('writes the full layout and an index line', async () => {
    const { entry, warnings } = await writeArchiveEntry(root, base(), ALL)
    expect(warnings).toEqual([])
    expect(entry.path).toBe(join(root, '2026-11-09', '193412-dictation-6ab1e37e'))
    expect(entry.files).toEqual(['audio.webm', 'meta.json', 'output.txt', 'transcript.txt'])
    expect(entry.kind).toBe('dictation')
    expect(entry.historyId).toBe('6ab1e37e-1111-2222-3333-444455556666')
    expect(entry.preview).toBe('Hello, world.')
    expect(await ls(entry.path)).toEqual(entry.files)
    expect((await readFile(join(entry.path, 'audio.webm'))).length).toBe(10)
    expect(await readFile(join(entry.path, 'transcript.txt'), 'utf8')).toBe('hello world raw')
    expect(await readFile(join(entry.path, 'output.txt'), 'utf8')).toBe('Hello, world.')
    const meta = JSON.parse(await readFile(join(entry.path, 'meta.json'), 'utf8'))
    expect(meta).toMatchObject({ schema: 1, kind: 'dictation', mode: 'ptt', files: entry.files })
    const lines = (await readFile(join(root, 'index.jsonl'), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({ rel: '2026-11-09/193412-dictation-6ab1e37e', kind: 'dictation', historyId: entry.historyId })
  })

  it('command mode writes input.txt only with the transcript toggle', async () => {
    const w = base({ kind: 'command', input: 'selected text', transcript: 'make it formal' })
    const a = await writeArchiveEntry(root, w, ALL)
    expect(a.entry.files).toContain('input.txt')
    expect(await readFile(join(a.entry.path, 'input.txt'), 'utf8')).toBe('selected text')
    const b = await writeArchiveEntry(root, { ...w, historyId: 'bbbbbbbb' }, { ...ALL, transcript: false })
    expect(b.entry.files).not.toContain('input.txt')
    expect(b.entry.files).not.toContain('transcript.txt')
  })

  it('honours every toggle', async () => {
    const cases: [keyof ArchiveToggles, string][] = [
      ['audio', 'audio.webm'],
      ['transcript', 'transcript.txt'],
      ['output', 'output.txt'],
      ['meta', 'meta.json']
    ]
    let i = 0
    for (const [key, file] of cases) {
      const { entry } = await writeArchiveEntry(root, base({ historyId: `id${i++}xxxxxx` }), { ...ALL, [key]: false })
      expect(entry.files).not.toContain(file)
      expect(entry.files).toHaveLength(3)
    }
  })

  it('does not leak text into the index preview when text files are off', async () => {
    const { entry } = await writeArchiveEntry(root, base(), { audio: true, transcript: false, output: false, meta: true })
    expect(entry.preview).toBe('')
  })

  it('throws NothingToSaveError (and leaves no folder) when nothing would be written', async () => {
    const off = { audio: false, transcript: false, output: false, meta: false }
    await expect(writeArchiveEntry(root, base(), off)).rejects.toBeInstanceOf(NothingToSaveError)
    expect(await readdir(root)).toEqual([])
  })

  it('error entries keep the audio and meta (with error) but no transcript/output', async () => {
    const w = base({ historyId: undefined, transcript: undefined, output: undefined, error: "Can't reach the server" })
    const { entry } = await writeArchiveEntry(root, w, ALL)
    expect(entry.files).toEqual(['audio.webm', 'meta.json'])
    expect(entry.preview).toBe("Failed: Can't reach the server")
    const meta = JSON.parse(await readFile(join(entry.path, 'meta.json'), 'utf8'))
    expect(meta.error).toBe("Can't reach the server")
    const idx = JSON.parse((await readFile(join(root, 'index.jsonl'), 'utf8')).trim())
    expect(idx.error).toBe("Can't reach the server")
  })

  it('error entries record the failure even if the meta toggle is off', async () => {
    const { entry } = await writeArchiveEntry(root, base({ historyId: undefined, transcript: undefined, output: undefined, error: 'boom' }), { ...ALL, meta: false })
    expect(entry.files).toContain('meta.json')
  })

  it('writes atomically: no temp files left behind, and a failed write leaves nothing partial', async () => {
    const { entry } = await writeArchiveEntry(root, base(), ALL)
    expect((await ls(entry.path)).filter((f) => f.endsWith('.tmp'))).toEqual([])
    // make the entry path a file so mkdir fails
    const w = base({ historyId: 'ffffffff' })
    await mkdir(join(root, '2026-11-09'), { recursive: true })
    await writeFile(join(root, '2026-11-09', '193412-dictation-ffffffff'), 'in the way')
    await expect(writeArchiveEntry(root, w, ALL)).rejects.toBeTruthy()
    expect((await readFile(join(root, 'index.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it('rejects a relative archive folder', async () => {
    await expect(writeArchiveEntry('relative/dir', base(), ALL)).rejects.toThrow(/absolute/)
  })

  it('a non-newline-terminated index does not swallow the next entry', async () => {
    await writeFile(join(root, 'index.jsonl'), '{"half":')
    await writeArchiveEntry(root, base(), ALL)
    const list = await readRecent(root, 10)
    expect(list).toHaveLength(1)
  })

  it('top-up: reuses an entry folder, writes only missing files, never a second audio file', async () => {
    const first = await writeArchiveEntry(root, base(), { ...ALL, audio: false, output: false })
    expect(first.entry.files).toEqual(['meta.json', 'transcript.txt'])
    const found = await findEntryByHistoryId(root, first.entry.historyId!)
    expect(found?.path).toBe(first.entry.path)
    const second = await writeArchiveEntry(root, base({ createdAt: new Date(2030, 0, 1), audio: { data: new Uint8Array(5), mimeType: 'audio/wav' } }), ALL, { reuse: found })
    expect(second.entry.path).toBe(first.entry.path)
    expect(second.entry.files).toEqual(['audio.wav', 'meta.json', 'output.txt', 'transcript.txt'])
    // already has audio → a different-format audio is skipped
    const third = await writeArchiveEntry(root, base({ audio: { data: new Uint8Array(5), mimeType: 'audio/webm' } }), ALL, { reuse: second.entry })
    expect(third.entry.files).not.toContain('audio.webm')
    // everything present → no-op, no new index line
    const lines = (await readFile(join(root, 'index.jsonl'), 'utf8')).trim().split('\n').length
    expect(lines).toBe(2)
  })
})

describe('index.jsonl reading', () => {
  const write = (i: number, over: Partial<ArchiveWrite> = {}) =>
    writeArchiveEntry(root, base({ createdAt: new Date(2026, 10, 9, 10, 0, i), historyId: `h${String(i).padStart(7, '0')}`, output: `text ${i}`, ...over }), ALL)

  it('returns [] for a missing index', async () => {
    expect(await readRecent(root)).toEqual([])
    expect(await readIndexTail(join(root, 'nope'))).toEqual([])
  })

  it('returns newest first and honours the limit', async () => {
    for (let i = 1; i <= 5; i++) await write(i)
    const r = await readRecent(root, 3)
    expect(r.map((e) => e.preview)).toEqual(['text 5', 'text 4', 'text 3'])
    expect(r[0]!.path.startsWith(root)).toBe(true)
  })

  it('skips corrupt lines, foreign paths and entries whose folder was deleted', async () => {
    const a = await write(1)
    const b = await write(2)
    await writeFile(
      join(root, 'index.jsonl'),
      (await readFile(join(root, 'index.jsonl'), 'utf8')) +
        'garbage\n[]\n{"kind":"nope"}\n' +
        JSON.stringify({ kind: 'dictation', createdAt: 'x', path: '/etc/passwd', files: [], preview: '' }) + '\n' +
        JSON.stringify({ kind: 'dictation', createdAt: 'x', rel: '../escape', files: [], preview: '' }) + '\n'
    )
    expect((await readRecent(root, 10)).map((e) => e.path)).toEqual([b.entry.path, a.entry.path])
    await rm(b.entry.path, { recursive: true })
    expect((await readRecent(root, 10)).map((e) => e.path)).toEqual([a.entry.path])
  })

  it('follows a moved archive folder via the relative path', async () => {
    const a = await write(1)
    const moved = await mkdtemp(join(tmpdir(), 'wisprram-moved-'))
    try {
      await rm(moved, { recursive: true })
      const { rename } = await import('node:fs/promises')
      await rename(root, moved)
      const r = await readRecent(moved, 5)
      expect(r).toHaveLength(1)
      expect(r[0]!.path).toBe(join(moved, '2026-11-09', a.entry.path.split('/').pop()!))
    } finally {
      await rm(moved, { recursive: true, force: true })
      root = await mkdtemp(join(tmpdir(), 'wisprram-archive-'))
    }
  })

  it('reads only the tail of a large index and drops the cut first line', async () => {
    const pad = JSON.stringify({ kind: 'dictation', createdAt: 'x', rel: 'a/b', files: [], preview: 'p'.repeat(200) }) + '\n'
    await writeFile(join(root, 'index.jsonl'), pad.repeat(500))
    const w = await write(9)
    const tail = await readIndexTail(root, 4096)
    expect(tail[0]!.path).toBe(w.entry.path)
    expect(tail.length).toBeLessThan(30)
  })

  it('dedupes a re-saved entry', async () => {
    const a = await write(1)
    await writeArchiveEntry(root, base({ createdAt: new Date(2026, 10, 9, 10, 0, 1), historyId: 'h0000001', audio: undefined, output: 'x' }), { ...ALL, meta: false }, { reuse: a.entry })
    // second call found nothing new to write → still one entry
    expect(await readRecent(root, 10)).toHaveLength(1)
  })
})

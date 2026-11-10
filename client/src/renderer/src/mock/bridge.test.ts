import { describe, expect, it, vi } from 'vitest'
import { createMockBridge } from './bridge'
import { makeMockHistory } from './data'
import { buildArchiveEntry, entryRelPath, makeWav } from './archive'
import type { RecState } from '../../../shared/ipc'

const mk = (o = {}) => createMockBridge({ latency: 0, ...o })

describe('mock bridge', () => {
  it('serves history pages with search', async () => {
    const b = mk()
    const page = await b.history.list({ limit: 10 })
    expect(page.items).toHaveLength(10)
    expect(page.total).toBeGreaterThan(30)
    const next = await b.history.list({ limit: 10, offset: 10 })
    expect(next.items[0].id).not.toBe(page.items[0].id)
    const hit = await b.history.list({ q: 'kubernetes' })
    expect(hit.total).toBeGreaterThan(0)
    expect(hit.items.every((i) => (i.text + i.raw_text).toLowerCase().includes('kuber'))).toBe(true)
  })

  it('history is sorted newest first and spans several days', () => {
    const items = makeMockHistory(Date.UTC(2026, 10, 9, 12))
    const times = items.map((i) => Date.parse(i.created_at))
    expect([...times].sort((a, b) => b - a)).toEqual(times)
    expect(new Set(items.map((i) => i.created_at.slice(0, 10))).size).toBeGreaterThan(3)
  })

  it('removes and clears history', async () => {
    const b = mk()
    const first = (await b.history.list({ limit: 1 })).items[0]
    await b.history.remove(first.id)
    expect((await b.history.list({ q: undefined, limit: 500 })).items.some((i) => i.id === first.id)).toBe(false)
    await b.history.clear()
    expect((await b.history.list()).total).toBe(0)
  })

  it('does dictionary and snippet CRUD', async () => {
    const b = mk()
    const e = await b.dictionary.add({ term: 'Zed', sounds_like: ['zee'] })
    expect((await b.dictionary.list()).some((d) => d.id === e.id)).toBe(true)
    const u = await b.dictionary.update(e.id, { term: 'Zed2' })
    expect(u.term).toBe('Zed2')
    expect(u.sounds_like).toEqual([])
    await b.dictionary.remove(e.id)
    expect((await b.dictionary.list()).some((d) => d.id === e.id)).toBe(false)

    const s = await b.snippets.add({ trigger: 'hi', expansion: 'hello\nthere' })
    expect((await b.snippets.update(s.id, { trigger: 'hi', expansion: 'x' })).expansion).toBe('x')
    await b.snippets.remove(s.id)
    expect((await b.snippets.list()).find((x) => x.id === s.id)).toBeUndefined()
  })

  it('returns copies, not shared references', async () => {
    const b = mk()
    const a = await b.settings.get()
    a.playSounds = !a.playSounds
    expect((await b.settings.get()).playSounds).not.toBe(a.playSounds)
  })

  it('settings.set merges, emits onChange and keeps hasToken', async () => {
    const b = mk()
    const cb = vi.fn()
    b.settings.onChange(cb)
    const s = await b.settings.set({ theme: 'dark', cleanup: 'light' })
    expect(s.theme).toBe('dark')
    expect(s.hasToken).toBe(true)
    expect(cb).toHaveBeenCalledOnce()
  })

  it('pairs with the demo code and rejects bad input', async () => {
    const b = mk({ paired: false })
    expect((await b.connection.status()).connection).toBe('unpaired')
    await expect(b.connection.pair('http://192.168.1.50:8790', '000000')).rejects.toThrow(/wrong|expired/)
    await expect(b.connection.pair('nope', '123456')).rejects.toThrow(/URL/)
    await expect(b.connection.pair('http://bad-host:8790', '123456')).rejects.toThrow(/reach/)
    const seen: string[] = []
    b.connection.onStatus((s) => seen.push(s.connection))
    const st = await b.connection.pair('http://192.168.1.50:8790', '123456')
    expect(st.connection).toBe('connected')
    expect(st.health?.gpu?.name).toMatch(/4060/)
    expect(seen).toContain('connected')
    await b.connection.unpair()
    expect((await b.connection.status()).connection).toBe('unpaired')
    expect((await b.settings.get()).hasToken).toBe(false)
  })

  it('accepts a long token as a credential', async () => {
    const b = mk({ paired: false })
    expect((await b.connection.pair('http://192.168.1.50:8790', 'a'.repeat(40))).connection).toBe('connected')
  })

  it('simulates hands-free recording → processing → done → idle and records history', async () => {
    vi.useFakeTimers()
    const b = createMockBridge({ latency: 140 })
    const phases: RecState['phase'][] = []
    b.recorder.onRecState((s) => phases.push(s.phase))
    const results = vi.fn()
    b.dictation.onResult(results)
    const startCb = vi.fn()
    const stopCb = vi.fn()
    b.recorder.onStart(startCb)
    b.recorder.onStop(stopCb)

    await b.dictation.toggleHandsFree()
    expect(b.mock.getRec().phase).toBe('recording')
    expect(startCb).toHaveBeenCalledWith({ deviceId: 'default', mode: 'handsfree' })
    await b.dictation.toggleHandsFree()
    expect(stopCb).toHaveBeenCalled()
    expect(b.mock.getRec().phase).toBe('processing')
    await vi.advanceTimersByTimeAsync(1000)
    expect(b.mock.getRec().phase).toBe('done')
    expect(results).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2000)
    expect(b.mock.getRec().phase).toBe('idle')
    expect(phases).toEqual(['recording', 'processing', 'done', 'idle'])
    vi.useRealTimers()
  })

  it('sendAudio from the overlay completes a dictation and capture errors surface', async () => {
    const b = mk()
    const results = vi.fn()
    b.dictation.onResult(results)
    b.mock.emitStart({ mode: 'ptt' })
    await b.recorder.sendAudio(new ArrayBuffer(1234), 'audio/webm;codecs=opus', 900)
    expect(b.mock.lastAudio()).toEqual({ bytes: 1234, mimeType: 'audio/webm;codecs=opus', durationMs: 900 })
    await new Promise((r) => setTimeout(r, 5))
    expect(results).toHaveBeenCalled()
    await b.recorder.sendCaptureError('Microphone access was denied')
    expect(b.mock.getRec()).toEqual({ phase: 'error', message: 'Microphone access was denied' })
  })

  it('server settings merge partial updates', async () => {
    const b = mk()
    const s = await b.serverSettings.set({ styles_by_app: { Slack: 'casual' }, default_cleanup: 'light' })
    expect(s.styles_by_app).toEqual({ Slack: 'casual' })
    expect(s.llm_model).toBeTruthy()
  })

  it('reports permissions only on macOS', async () => {
    const mac = mk()
    expect((await mac.permissions.get()).accessibility).toBe('denied')
    expect(await mac.permissions.request('accessibility')).toBe('granted')
    const lin = mk({ platform: 'linux' })
    expect((await lin.permissions.get()).microphone).toBe('not-applicable')
  })

  it('has no personal data in the sample content', () => {
    const blob = JSON.stringify(makeMockHistory(Date.now()))
    expect(blob).not.toMatch(/gmail|anirudh|\b10\.\d+\.\d+\.\d+/i)
  })

  it('marks some history items with audio and metadata, and the oldest without metadata', () => {
    const items = makeMockHistory(Date.UTC(2026, 10, 9, 12))
    expect(items.some((i) => i.has_audio && i.audio_mime)).toBe(true)
    expect(items.some((i) => !i.has_audio)).toBe(true)
    expect(items[0].meta?.stt_model).toBeTruthy()
    expect(items[items.length - 1].meta).toBeUndefined()
  })

  it('getAudio returns a WAV for items with audio and rejects otherwise', async () => {
    const b = mk()
    const items = (await b.history.list({ limit: 40 })).items
    const withAudio = items.find((i) => i.has_audio)!
    const without = items.find((i) => !i.has_audio)!
    const a = await b.history.getAudio!(withAudio.id)
    expect(a.mimeType).toBe('audio/wav')
    expect(new TextDecoder().decode(a.data.slice(0, 4))).toBe('RIFF')
    await expect(b.history.getAudio!(without.id)).rejects.toThrow(/No recording/)
    await expect(b.history.getAudio!('nope')).rejects.toThrow(/no longer exists/)
  })

  it('archive: resolves the folder, chooses another and reports settings changes', async () => {
    const b = mk()
    const cb = vi.fn()
    b.settings.onChange(cb)
    expect(await b.archive!.folder()).toMatch(/WisprRam$/)
    const picked = await b.archive!.chooseFolder()
    expect(picked).toBeTruthy()
    expect(await b.archive!.folder()).toBe(picked)
    expect((await b.settings.get()).archiveDir).toBe(picked)
    expect(cb).toHaveBeenCalled()
    await b.settings.set({ archiveDir: '' })
    expect(await b.archive!.folder()).toMatch(/WisprRam$/)
  })

  it('archive: saveHistoryItem writes the selected files, emits onSaved and lists it as recent', async () => {
    const b = mk()
    const saved = vi.fn()
    b.archive!.onSaved(saved)
    expect(await b.archive!.recent(5)).toEqual([])
    const withAudio = (await b.history.list({ limit: 40 })).items.find((i) => i.has_audio)!
    await b.settings.set({ archiveTranscript: false })
    const e = await b.archive!.saveHistoryItem(withAudio.id)
    expect(e.historyId).toBe(withAudio.id)
    expect(e.files).toEqual(['audio.wav', 'output.txt', 'meta.json'])
    expect(e.path).toMatch(/^\/Users\/you\/Documents\/WisprRam\/\d{4}-\d{2}-\d{2}\/\d{6}-dictation-/)
    expect(saved).toHaveBeenCalledOnce()
    expect((await b.archive!.recent(5))[0].path).toBe(e.path)
    // saving again does not duplicate
    await b.archive!.saveHistoryItem(withAudio.id)
    expect(await b.archive!.recent(5)).toHaveLength(1)
    await expect(b.archive!.saveHistoryItem('nope')).rejects.toThrow()
    await b.archive!.open(e.path)
    expect(b.mock.opened()).toEqual([e.path])
  })

  it('archive: new dictations are saved automatically only when archiveEnabled', async () => {
    const b = mk()
    const saved = vi.fn()
    b.archive!.onSaved(saved)
    b.mock.emitStart({ mode: 'ptt' })
    await b.recorder.sendAudio(new ArrayBuffer(10), 'audio/webm', 500)
    await new Promise((r) => setTimeout(r, 5))
    expect(saved).not.toHaveBeenCalled()
    await b.settings.set({ archiveEnabled: true })
    b.mock.emitStart({ mode: 'ptt' })
    await b.recorder.sendAudio(new ArrayBuffer(10), 'audio/webm', 500)
    await new Promise((r) => setTimeout(r, 5))
    expect(saved).toHaveBeenCalledOnce()
  })

  it('server settings: save_audio/audio_dir round-trip and relative paths fail with bad_audio_dir', async () => {
    const b = mk()
    expect((await b.serverSettings.get()).save_audio).toBe(true)
    const ok = await b.serverSettings.set({ save_audio: false, audio_dir: ' /srv/audio ' })
    expect(ok.save_audio).toBe(false)
    expect(ok.audio_dir).toBe('/srv/audio')
    await expect(b.serverSettings.set({ audio_dir: 'relative/dir' })).rejects.toMatchObject({ code: 'bad_audio_dir', message: expect.stringMatching(/absolute/) })
    expect((await b.serverSettings.get()).audio_dir).toBe('/srv/audio')
  })

  it('new dictations record has_audio and meta from the server settings', async () => {
    const b = mk()
    b.mock.emitStart({ mode: 'ptt' })
    await b.recorder.sendAudio(new ArrayBuffer(10), 'audio/webm', 500)
    await new Promise((r) => setTimeout(r, 5))
    const top = (await b.history.list({ limit: 1 })).items[0]
    expect(top.has_audio).toBe(true)
    expect(top.meta).toMatchObject({ stt_model: 'large-v3-turbo', cleanup_used: 'llm' })
  })
})

describe('mock archive helpers', () => {
  it('builds <date>/<time>-<kind>-<id8> folders in local time', () => {
    const d = new Date(2026, 10, 9, 19, 34, 12)
    expect(entryRelPath(d.toISOString(), 'dictation', 'h1040')).toBe('2026-11-09/193412-dictation-000h1040')
    expect(entryRelPath(d.toISOString(), 'command', '6ab1e37e-0000-aaaa-bbbb-1234567890ab')).toBe('2026-11-09/193412-command-567890ab')
  })
  it('only lists audio when it exists and is selected', () => {
    const item = { id: 'h1', created_at: new Date().toISOString(), kind: 'dictation' as const, raw_text: 'a', text: 'A', app_name: null, audio_ms: 1, word_count: 1 }
    expect(buildArchiveEntry(item, {}, '/x/').files).toEqual(['transcript.txt', 'output.txt', 'meta.json'])
    expect(buildArchiveEntry({ ...item, has_audio: true }, { archiveAudio: false }, '/x').files).toEqual(['transcript.txt', 'output.txt', 'meta.json'])
    expect(buildArchiveEntry({ ...item, has_audio: true }, {}, '/x').path.startsWith('/x/')).toBe(true)
  })
  it('generates a valid PCM WAV of the right length', () => {
    const buf = makeWav(1000, 3)
    const v = new DataView(buf)
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint32(40, true)).toBe(16000 * 2)
    expect(buf.byteLength).toBe(44 + 32000)
    let peak = 0
    for (let i = 44; i < buf.byteLength; i += 2) peak = Math.max(peak, Math.abs(v.getInt16(i, true)))
    expect(peak).toBeGreaterThan(1000)
    expect(makeWav(5, 1).byteLength).toBeGreaterThan(44) // minimum length clamp
  })
})

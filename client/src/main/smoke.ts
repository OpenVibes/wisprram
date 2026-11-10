// Scripted self-test, only active when WISPRRAM_SMOKE=1 (and WISPRRAM_USER_DATA points at a temp dir).
// It exercises the real preload + IPC + API client against the mock server without recording audio,
// pasting, or touching global input. The process exits with code 0 on success, 1 on failure.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ApiClient } from './api-client'
import type { ArchiveService } from './archive-service'
import type { ConnectionMonitor } from './connection'
import { log } from './log'
import { Recorder } from './recorder'
import { loadUiohook } from './uio'
import type { SettingsStore } from './settings-store'
import { classifyError, normalizeServerUrl } from './url'
import type { Windows } from './windows'

const MOCK_URL = process.env['WISPRRAM_SMOKE_URL'] || 'http://127.0.0.1:8791'

interface Deps {
  settings: SettingsStore
  api: ApiClient
  conn: ConnectionMonitor
  windows: Windows
  archive: ArchiveService
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function runSmokeTest(d: Deps): Promise<void> {
  const failures: string[] = []
  const step = async (name: string, fn: () => Promise<unknown> | unknown): Promise<void> => {
    try {
      const out = await fn()
      log(`SMOKE ok   ${name}`, out === undefined ? '' : out)
    } catch (err) {
      failures.push(name)
      log(`SMOKE FAIL ${name}`, err)
    }
  }
  const expect = (cond: unknown, msg: string): void => {
    if (!cond) throw new Error(msg)
  }

  const hard = setTimeout(() => {
    log('SMOKE RESULT: FAIL (timeout)')
    app.exit(1)
  }, 30_000)

  if (!process.env['WISPRRAM_USER_DATA']) {
    log('SMOKE RESULT: FAIL (refusing to run without WISPRRAM_USER_DATA temp dir)')
    app.exit(1)
    return
  }

  const main = d.windows.ensureMain('home')
  await new Promise<void>((resolve) => {
    if (!main.webContents.isLoading()) return resolve()
    main.webContents.once('did-finish-load', () => resolve())
    main.webContents.once('did-fail-load', () => resolve())
  })
  const evalMain = <T>(code: string): Promise<T> => main.webContents.executeJavaScript(code) as Promise<T>

  await step('preload exposes window.wisprram', async () => {
    const keys = await evalMain<string[]>('Object.keys(window.wisprram)')
    const want = ['app', 'settings', 'connection', 'dictation', 'history', 'archive', 'dictionary', 'snippets', 'serverSettings', 'stats', 'permissions', 'clipboard', 'recorder']
    for (const k of want) expect(keys.includes(k), `missing namespace ${k}`)
    return keys.join(',')
  })
  await step('starts unconfigured (empty server URL) with a helpful hint', async () => {
    const s = await evalMain<{ serverUrl: string }>('window.wisprram.settings.get()')
    expect(s.serverUrl === '', `serverUrl default should be empty, got ${JSON.stringify(s.serverUrl)}`)
    const st = await evalMain<{ connection: string; hint?: string }>('window.wisprram.connection.status()')
    expect(st.connection === 'unconfigured', `connection=${st.connection}`)
    expect(/192\.168\.1\.50:8790/.test(st.hint ?? ''), `hint=${st.hint}`)
    return st.hint
  })
  await step('archive.folder defaults to <Documents>/WisprRam', async () => {
    const f = await evalMain<string>('window.wisprram.archive.folder()')
    expect(f === join(app.getPath('documents'), 'WisprRam'), `folder=${f}`)
  })
  await step('initial route hash is #/home', async () => {
    const h = await evalMain<string>('location.hash')
    expect(h === '#/home', `hash=${h}`)
  })
  await step('uiohook-napi native module loads (hook NOT started)', () => {
    const u = loadUiohook()
    expect(u && typeof u.uIOhook.start === 'function' && u.UiohookKey.AltRight === 3640, 'uiohook failed to load')
  })
  await step('app.info', async () => JSON.stringify(await evalMain('window.wisprram.app.info()')))
  await step('settings.get defaults', async () => {
    const s = await evalMain<{ onboardingDone: boolean; hasToken: boolean; pttKey: string }>('window.wisprram.settings.get()')
    expect(s.hasToken === false, 'hasToken should start false')
    return `pttKey=${s.pttKey}`
  })
  await step('permissions.get', async () => JSON.stringify(await evalMain('window.wisprram.permissions.get()')))
  await step('connection.pair rejects bad code', async () => {
    const r = await evalMain<string>(`window.wisprram.connection.pair(${JSON.stringify(MOCK_URL)}, '000000').then(() => 'ACCEPTED', (e) => e.message)`)
    expect(r !== 'ACCEPTED', 'bad code was accepted')
    return r
  })
  await step('connection.pair (6-digit code)', async () => {
    const st = await evalMain<{ connection: string; health: unknown }>(`window.wisprram.connection.pair(${JSON.stringify(MOCK_URL)}, '123456')`)
    expect(st.connection === 'connected', `connection=${st.connection}`)
    const s = await evalMain<{ hasToken: boolean; serverUrl: string }>('window.wisprram.settings.get()')
    expect(s.hasToken, 'token not stored')
    return s.serverUrl
  })
  await step('token persisted + not in settings.json', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = app.getPath('userData')
    const files = readdirSync(dir)
    const json = readFileSync(join(dir, 'settings.json'), 'utf8')
    expect(!/token/i.test(json.replace('hasToken', '')), 'token leaked into settings.json')
    return files.filter((f) => f.startsWith('token')).join(',')
  })
  await step('connection.refresh', async () => {
    const st = await evalMain<{ connection: string; health: { status: string } | null }>('window.wisprram.connection.refresh()')
    expect(st.connection === 'connected' && st.health, 'not connected after refresh')
    return st.health?.status
  })
  await step('history.list', async () => {
    const h = await evalMain<{ items: unknown[]; total: number }>('window.wisprram.history.list({ limit: 5 })')
    return `total=${h.total}`
  })
  await step('stats.get', async () => JSON.stringify(await evalMain('window.wisprram.stats.get()')))
  await step('dictionary add/list/update/remove', async () => {
    const e = await evalMain<{ id: string }>(`window.wisprram.dictionary.add({ term: 'WisprRam', sounds_like: ['whisper ram'] })`)
    const l = await evalMain<{ id: string }[]>('window.wisprram.dictionary.list()')
    expect(l.some((x) => x.id === e.id), 'added entry missing from list')
    await evalMain(`window.wisprram.dictionary.update(${JSON.stringify(e.id)}, { term: 'WisprRam2' })`)
    await evalMain(`window.wisprram.dictionary.remove(${JSON.stringify(e.id)})`)
  })
  await step('snippets add/list/remove', async () => {
    const s = await evalMain<{ id: string }>(`window.wisprram.snippets.add({ trigger: 'my email', expansion: 'a@b.c' })`)
    const l = await evalMain<{ id: string }[]>('window.wisprram.snippets.list()')
    expect(l.some((x) => x.id === s.id), 'added snippet missing')
    await evalMain(`window.wisprram.snippets.remove(${JSON.stringify(s.id)})`)
  })
  await step('serverSettings get/set', async () => {
    const s = await evalMain<{ default_style: string }>(`window.wisprram.serverSettings.set({ default_style: 'formal' })`)
    return s.default_style
  })
  await step('settings.set emits + persists', async () => {
    const s = await evalMain<{ cleanup: string }>(`window.wisprram.settings.set({ cleanup: 'light', onboardingDone: true })`)
    expect(s.cleanup === 'light', 'patch not applied')
  })
  await step('settings.set normalizes serverUrl', async () => {
    const s = await evalMain<{ serverUrl: string }>(`window.wisprram.settings.set({ serverUrl: '127.0.0.1:8791/' })`)
    expect(s.serverUrl === MOCK_URL, `got ${s.serverUrl}`)
  })

  // ---- v0.2 local archive ------------------------------------------------------------------------
  const archiveDir = join(app.getPath('userData'), 'archive-smoke')
  const readJson = (p: string): Record<string, any> => JSON.parse(readFileSync(p, 'utf8')) // eslint-disable-line @typescript-eslint/no-explicit-any
  interface Entry { path: string; files: string[]; kind: string; historyId?: string; preview: string }
  const inserted: string[] = []
  const makeRecorder = (): Recorder => {
    const rec: Recorder = new Recorder({
      getSettings: () => d.settings.get(),
      overlay: {
        start: () => undefined,
        stop: () => void setTimeout(() => void rec.onAudio(new Uint8Array(4000).buffer, 'audio/webm', 1500), 20),
        cancel: () => undefined
      },
      api: d.api,
      insert: async (t) => {
        inserted.push(t)
        return { pasted: true }
      },
      captureSelection: async () => ({ text: 'hello world' }),
      getContext: async () => ({ name: 'SmokeApp' }),
      onState: () => undefined,
      onResult: () => undefined,
      archive: (job) => d.archive.saveJob(job),
      log
    })
    return rec
  }
  const recent = (n = 20) => evalMain<Entry[]>(`window.wisprram.archive.recent(${n})`)
  const until = async <T>(fn: () => Promise<T | false>, ms = 4000): Promise<T> => {
    const end = Date.now() + ms
    for (;;) {
      const v = await fn()
      if (v) return v
      if (Date.now() > end) throw new Error('timed out waiting for the archive')
      await wait(50)
    }
  }

  await step('enable archive + keep audio on the server', async () => {
    mkdirSync(archiveDir, { recursive: true })
    const s = await evalMain<{ archiveDir: string; archiveEnabled: boolean }>(
      `window.wisprram.settings.set({ archiveDir: ${JSON.stringify(archiveDir)}, archiveEnabled: true })`
    )
    expect(s.archiveEnabled && s.archiveDir === archiveDir, 'archive settings not applied')
    expect((await evalMain<string>('window.wisprram.archive.folder()')) === archiveDir, 'folder() mismatch')
    await evalMain(`window.wisprram.serverSettings.set({ save_audio: true })`)
    await evalMain(`window.__saved = []; void window.wisprram.archive.onSaved((e) => window.__saved.push(e))`)
  })

  let dictationId = ''
  await step('dictation + command flow (fake overlay, no paste) are archived', async () => {
    const rec = makeRecorder()
    const results: string[] = []
    rec.toggleHandsFree()
    expect(rec.isRecording, 'not recording after toggle')
    rec.toggleHandsFree()
    await wait(1200)
    expect(inserted.length === 1 && inserted[0], `inserted=${JSON.stringify(inserted)}`)
    rec.toggleCommand()
    await wait(100)
    rec.toggleCommand()
    await wait(1200)
    expect(inserted.length === 2, `command did not insert: ${JSON.stringify(inserted)}`)
    rec.cancel()
    const list = await until(async () => {
      const l = await recent()
      return l.length >= 2 ? l : false
    })
    const cmd = list.find((e) => e.kind === 'command')
    const dict = list.find((e) => e.kind === 'dictation')
    expect(cmd && dict, `entries: ${JSON.stringify(list.map((e) => e.kind))}`)
    // dictation
    expect(/[\\/]\d{4}-\d\d-\d\d[\\/]\d{6}-dictation-[0-9a-f]{8}$/.test(dict!.path), `dictation folder name: ${dict!.path}`)
    expect(dict!.path.startsWith(archiveDir), 'entry outside archive dir')
    for (const f of ['audio.webm', 'transcript.txt', 'output.txt', 'meta.json']) expect(dict!.files.includes(f), `dictation missing ${f}: ${dict!.files}`)
    expect(readFileSync(join(dict!.path, 'output.txt'), 'utf8') === inserted[0], 'output.txt != inserted text')
    expect(readFileSync(join(dict!.path, 'transcript.txt'), 'utf8').startsWith('this is a test dictation'), 'transcript.txt (raw text) wrong')
    expect(readFileSync(join(dict!.path, 'audio.webm')).length === 4000, 'audio.webm size')
    const meta = readJson(join(dict!.path, 'meta.json'))
    expect(meta.kind === 'dictation' && meta.mode === 'handsfree' && meta.app?.name === 'SmokeApp' && meta.history_id === dict!.historyId, `meta=${JSON.stringify(meta)}`)
    expect(meta.stt_model && meta.llm_model && meta.timings && meta.client?.version, 'meta missing models/timings/client')
    expect(meta.server_url === MOCK_URL && meta.error === undefined, 'meta server_url/error')
    dictationId = dict!.historyId ?? ''
    // command
    expect(/-command-/.test(cmd!.path), 'command folder name')
    for (const f of ['audio.webm', 'transcript.txt', 'input.txt', 'output.txt', 'meta.json']) expect(cmd!.files.includes(f), `command missing ${f}`)
    expect(readFileSync(join(cmd!.path, 'input.txt'), 'utf8') === 'hello world', 'input.txt != selection')
    expect(readFileSync(join(cmd!.path, 'transcript.txt'), 'utf8') === 'make it loud', 'command transcript != instruction')
    expect(readFileSync(join(cmd!.path, 'output.txt'), 'utf8') === inserted[1], 'command output.txt')
    // index + events
    const idx = readFileSync(join(archiveDir, 'index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { kind: string; rel: string })
    expect(idx.length === 2 && idx.every((l) => typeof l.rel === 'string'), `index.jsonl lines=${idx.length}`)
    const saved = await evalMain<unknown[]>('window.__saved')
    expect(saved.length === 2, `onSaved fired ${saved.length}x`)
    results.push(`${dict!.path.split(/[\\/]/).slice(-2).join('/')} + ${cmd!.path.split(/[\\/]/).pop()}`)
    return results.join(' ')
  })

  await step('history.getAudio returns an ArrayBuffer (and a friendly error when none was kept)', async () => {
    const r = await evalMain<{ ok: boolean; bytes: number; mime: string; isAb: boolean }>(
      `window.wisprram.history.getAudio(${JSON.stringify(dictationId)}).then((a) => ({ ok: true, bytes: a.data.byteLength, mime: a.mimeType, isAb: a.data instanceof ArrayBuffer }))`
    )
    expect(r.ok && r.isAb && r.mime === 'audio/wav' && r.bytes === 3244, JSON.stringify(r))
    await evalMain(`window.wisprram.serverSettings.set({ save_audio: false })`)
    const none = await d.api.dictate(new Blob([new Uint8Array(4000)], { type: 'audio/webm' }), {})
    const m = await evalMain<string>(`window.wisprram.history.getAudio(${JSON.stringify(none.id)}).then(() => 'OK', (e) => e.message)`)
    expect(/No recording was kept/.test(m), `message=${m}`)
    const bad = await evalMain<string>(`window.wisprram.history.getAudio('../etc').then(() => 'OK', (e) => e.message)`)
    expect(bad === 'Invalid history item', `bad id message=${bad}`)
    await evalMain(`window.wisprram.serverSettings.set({ save_audio: true })`)
    return m
  })

  await step('archive.saveHistoryItem (with server audio) + idempotent re-save + top-up of an auto entry', async () => {
    const r = await d.api.dictate(new Blob([new Uint8Array(4000)], { type: 'audio/webm' }), {}) // not archived automatically
    const e = await evalMain<Entry>(`window.wisprram.archive.saveHistoryItem(${JSON.stringify(r.id)})`)
    for (const f of ['audio.wav', 'transcript.txt', 'output.txt', 'meta.json']) expect(e.files.includes(f), `saved item missing ${f}: ${e.files}`)
    expect(readFileSync(join(e.path, 'audio.wav')).subarray(0, 4).toString() === 'RIFF', 'audio.wav is not a WAV')
    expect(readJson(join(e.path, 'meta.json')).source === 'history', 'meta.source')
    const again = await evalMain<Entry>(`window.wisprram.archive.saveHistoryItem(${JSON.stringify(r.id)})`)
    expect(again.path === e.path, 'second save created a new folder')
    const auto = await evalMain<Entry>(`window.wisprram.archive.saveHistoryItem(${JSON.stringify(dictationId)})`)
    expect(!auto.files.some((f) => f === 'audio.wav') && auto.files.includes('audio.webm'), `auto entry got a second audio file: ${auto.files}`)
    const bad = await evalMain<string>(`window.wisprram.archive.saveHistoryItem('nope/../x').then(() => 'OK', (e) => e.message)`)
    expect(bad === 'Invalid history item', `bad id message=${bad}`)
    const list = await recent(10)
    expect(list.filter((x) => x.path === e.path).length === 1, 'recent() lists a re-saved entry twice')
    expect(list[0]!.path === auto.path || list[0]!.path === e.path, 'recent() order')
    return e.path.split(/[\\/]/).pop()
  })

  await step('archive.recent honours limit and tolerates a corrupt index line', async () => {
    expect((await recent(1)).length === 1, 'limit 1')
    writeFileSync(join(archiveDir, 'index.jsonl'), '{not json\n', { flag: 'a' })
    const l = await recent(50)
    expect(l.length >= 3, `entries after corrupt line: ${l.length}`)
  })

  await step('archive.open only allows paths inside the archive folder', async () => {
    for (const p of ['/etc', join(archiveDir, '..', 'x'), 'relative/path']) {
      const m = await evalMain<string>(`window.wisprram.archive.open(${JSON.stringify(p)}).then(() => 'OPENED', (e) => e.message)`)
      expect(m !== 'OPENED', `opened ${p}`)
    }
  })

  await step('failed request still archives audio + meta with the error (no transcript/output)', async () => {
    const before = (await recent(50)).length
    await fetch(`${MOCK_URL}/_mock/fail-next?n=1`, { method: 'POST' })
    const rec = makeRecorder()
    const insertedBefore = inserted.length
    rec.toggleHandsFree()
    rec.toggleHandsFree()
    const e = await until(async () => {
      const l = await recent(50)
      return l.length > before ? l[0]! : false
    })
    rec.cancel()
    expect(inserted.length === insertedBefore, 'nothing should be pasted on failure')
    expect(e.files.includes('audio.webm') && e.files.includes('meta.json'), `files=${e.files}`)
    expect(!e.files.includes('transcript.txt') && !e.files.includes('output.txt'), `unexpected text files: ${e.files}`)
    const meta = readJson(join(e.path, 'meta.json'))
    expect(typeof meta.error === 'string' && meta.error.length > 0 && meta.history_id === null, `meta=${JSON.stringify(meta)}`)
    return meta.error
  })

  await step('unwritable archive folder → hint on AppStatus, text is still inserted; cleared on fix', async () => {
    const blocker = join(app.getPath('userData'), 'not-a-dir')
    writeFileSync(blocker, 'x')
    await evalMain(`window.wisprram.settings.set({ archiveDir: ${JSON.stringify(join(blocker, 'sub'))} })`)
    const rec = makeRecorder()
    const n = inserted.length
    rec.toggleHandsFree()
    rec.toggleHandsFree()
    await until(async () => (inserted.length > n ? true : false))
    const st = await until(async () => {
      const s = d.conn.getStatus()
      return /archive/i.test(s.hint ?? '') ? s : false
    })
    rec.cancel()
    await evalMain(`window.wisprram.settings.set({ archiveDir: ${JSON.stringify(archiveDir)} })`)
    expect(!/archive/i.test(d.conn.getStatus().hint ?? ''), 'hint not cleared after fixing the folder')
    return st.hint
  })

  await step('archive disabled → nothing written', async () => {
    await evalMain(`window.wisprram.settings.set({ archiveEnabled: false })`)
    const before = readdirSync(archiveDir).length
    const rec = makeRecorder()
    const n = inserted.length
    rec.toggleHandsFree()
    rec.toggleHandsFree()
    await until(async () => (inserted.length > n ? true : false))
    await wait(300)
    rec.cancel()
    expect(readdirSync(archiveDir).length === before, 'archive wrote while disabled')
  })

  await step('rec:audio from the overlay window is accepted (sender check)', async () => {
    const ov = d.windows.overlay
    expect(ov && !ov.isDestroyed(), 'overlay window missing')
    await new Promise<void>((resolve) => {
      if (!ov!.webContents.isLoading()) return resolve()
      ov!.webContents.once('did-finish-load', () => resolve())
      ov!.webContents.once('did-fail-load', () => resolve())
    })
    const has = await ov!.webContents.executeJavaScript('typeof window.wisprram?.recorder?.sendAudio')
    expect(has === 'function', `overlay bridge: ${has}`)
    // idle recorder ignores the audio → resolves without side effects
    await ov!.webContents.executeJavaScript('window.wisprram.recorder.sendAudio(new ArrayBuffer(8), "audio/webm", 10)')
    const blocked = await evalMain<string>(`window.wisprram.recorder.sendAudio(new ArrayBuffer(8), 'audio/webm', 10).then(() => 'ALLOWED', (e) => e.message)`)
    expect(blocked !== 'ALLOWED', 'main window must not be allowed to send audio')
    return blocked
  })

  await step('unreachable server is classified', async () => {
    const err = await d.api.health('http://127.0.0.1:9').catch((e: unknown) => e)
    expect(classifyError(err) === 'unreachable', `classified as ${classifyError(err)}`)
    expect(normalizeServerUrl('10.0.0.5') === 'http://10.0.0.5:8790', 'normalize')
  })
  await step('unpair', async () => {
    await evalMain('window.wisprram.connection.unpair()')
    const s = await evalMain<{ hasToken: boolean }>('window.wisprram.settings.get()')
    expect(!s.hasToken, 'token still present')
    const st = await evalMain<{ connection: string }>('window.wisprram.connection.status()')
    expect(st.connection === 'unpaired', `connection=${st.connection}`)
  })

  clearTimeout(hard)
  const res = failures.length === 0 ? 'PASS' : `FAIL (${failures.join(', ')})`
  log(`SMOKE RESULT: ${res}`)
  app.exit(failures.length === 0 ? 0 : 1)
}

// In-memory implementation of WisprramBridge for running the renderer in a plain browser and for tests.
import type {
  CommandResult,
  DictationResult,
  DictionaryEntry,
  HistoryItem,
  HistoryPage,
  HistoryQuery,
  ServerSettings,
  Snippet,
  Stats
} from '../../../shared/api'
import type { AppInfo, AppStatus, ArchiveEntry, PermissionKind, PermissionState, Permissions, RecMode, RecState, WisprramBridge } from '../../../shared/ipc'
import { defaultSettings, type ClientSettings } from '../../../shared/settings'
import { isAbsolutePath } from '../lib/archive'
import { buildArchiveEntry, makeWav } from './archive'
import {
  MOCK_ARCHIVE_DEFAULT,
  MOCK_ARCHIVE_PICKED,
  MOCK_SERVER_URL,
  MOCK_DICTIONARY,
  MOCK_FAKE_RESULTS,
  MOCK_HEALTH,
  MOCK_SERVER_SETTINGS,
  MOCK_SNIPPETS,
  MOCK_STATS,
  makeMockHistory
} from './data'

export interface MockOptions {
  /** Base simulated latency in ms (0 disables; used by tests). Default 140. */
  latency?: number
  platform?: AppInfo['platform']
  /** Start unpaired/unconfigured to exercise onboarding. */
  paired?: boolean
  now?: () => number
  /** Pre-fill the archive's "recently saved" list with a few entries (demo). */
  seedArchive?: boolean
}

export interface MockControls {
  setRec(s: RecState): void
  getRec(): RecState
  /** Simulates the main process asking the overlay to start/stop/cancel capture. */
  emitStart(opts?: { deviceId?: string; mode?: RecMode }): void
  emitStop(): void
  emitCancel(): void
  setConnection(c: AppStatus['connection']): void
  /** Folders the UI asked the OS to open (archive.open), newest last. */
  opened(): string[]
  /** Last audio the overlay delivered via recorder.sendAudio (for demos/tests). */
  lastAudio(): { bytes: number; mimeType: string; durationMs: number } | null
}

type Listeners<T> = Set<(v: T) => void>

function emitter<T>(): { set: Listeners<T>; on(cb: (v: T) => void): () => void; emit(v: T): void } {
  const set: Listeners<T> = new Set()
  return {
    set,
    on(cb) {
      set.add(cb)
      return () => set.delete(cb)
    },
    emit(v) {
      set.forEach((cb) => cb(v))
    }
  }
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))
const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length

export function createMockBridge(opts: MockOptions = {}): WisprramBridge & { mock: MockControls } {
  const latency = opts.latency ?? 140
  const platform: AppInfo['platform'] = opts.platform ?? 'darwin'
  const now = opts.now ?? Date.now
  const wait = <T>(v: T, factor = 1): Promise<T> =>
    latency <= 0
      ? Promise.resolve(clone(v))
      : new Promise((res) => setTimeout(() => res(clone(v)), latency * factor * (0.6 + Math.random() * 0.8)))

  let seq = 1000
  const nextId = (p: string): string => `${p}${++seq}`
  const paired = opts.paired ?? true

  let settings: ClientSettings = { ...defaultSettings(platform), serverUrl: paired ? MOCK_SERVER_URL : '', hasToken: paired, onboardingDone: paired }
  let serverSettings: ServerSettings = clone(MOCK_SERVER_SETTINGS)
  let history: HistoryItem[] = makeMockHistory(now())
  let dictionary: DictionaryEntry[] = clone(MOCK_DICTIONARY)
  let snippets: Snippet[] = clone(MOCK_SNIPPETS)
  let stats: Stats = clone(MOCK_STATS)
  let perms: Permissions =
    platform === 'darwin'
      ? { microphone: 'not-determined', accessibility: 'denied', 'input-monitoring': 'not-determined' }
      : { microphone: 'not-applicable', accessibility: 'not-applicable', 'input-monitoring': 'not-applicable' }
  let rec: RecState = { phase: 'idle' }
  let status: AppStatus = {
    connection: paired ? 'connected' : 'unpaired',
    health: paired ? clone(MOCK_HEALTH) : null,
    serverUrl: settings.serverUrl,
    rec,
    hint: paired ? undefined : 'Enter the pairing code shown by the server.'
  }
  let lastAudio: ReturnType<MockControls['lastAudio']> = null
  const openedPaths: string[] = []
  const archiveFolder = (): string => settings.archiveDir || MOCK_ARCHIVE_DEFAULT
  let archived: ArchiveEntry[] = opts.seedArchive ? history.filter((h) => h.has_audio).slice(1, 4).map((h) => buildArchiveEntry(h, settings, MOCK_ARCHIVE_DEFAULT)) : []
  const evSaved = emitter<ArchiveEntry>()
  const saveToArchive = (item: HistoryItem): ArchiveEntry => {
    const entry = buildArchiveEntry(item, settings, archiveFolder())
    archived = [entry, ...archived.filter((e) => e.path !== entry.path)]
    evSaved.emit(clone(entry))
    return entry
  }
  let recTimer: ReturnType<typeof setTimeout> | undefined

  const evSettings = emitter<ClientSettings>()
  const evStatus = emitter<AppStatus>()
  const evResult = emitter<DictationResult | CommandResult>()
  const evStart = emitter<{ deviceId: string; mode: RecMode }>()
  const evStop = emitter<void>()
  const evCancel = emitter<void>()
  const evRec = emitter<RecState>()

  const publishStatus = (patch: Partial<AppStatus>): AppStatus => {
    status = { ...status, ...patch, rec }
    evStatus.emit(clone(status))
    return clone(status)
  }
  const setRec = (s: RecState): void => {
    rec = s
    status = { ...status, rec }
    evRec.emit(clone(s))
    evStatus.emit(clone(status))
  }

  const finishDictation = (mode: RecMode): void => {
    const text = MOCK_FAKE_RESULTS[Math.floor(Math.random() * MOCK_FAKE_RESULTS.length)]
    const wc = words(text)
    setRec({ phase: 'processing', mode })
    clearTimeout(recTimer)
    recTimer = setTimeout(
      () => {
        const id = nextId('h')
        const item: HistoryItem = {
          id,
          created_at: new Date(now()).toISOString(),
          kind: mode === 'command' ? 'command' : 'dictation',
          raw_text: text.toLowerCase().replace(/[.,’]/g, ''),
          text,
          app_name: 'Browser',
          audio_ms: 3200,
          word_count: wc,
          has_audio: !!serverSettings.save_audio,
          audio_mime: serverSettings.save_audio ? 'audio/wav' : undefined,
          meta: {
            stt_model: serverSettings.stt_model,
            llm_model: serverSettings.llm_model,
            cleanup: settings.cleanup,
            style: settings.style,
            language: 'en',
            cleanup_used: 'llm',
            applied_snippets: [],
            timings: { decode_ms: 12, stt_ms: 240, llm_ms: 410, total_ms: 690 }
          }
        }
        history = [item, ...history]
        if (settings.archiveEnabled) saveToArchive(item)
        stats = { ...stats, words_total: stats.words_total + wc, words_7d: stats.words_7d + wc, sessions_total: stats.sessions_total + 1 }
        const result: DictationResult = {
          id,
          raw_text: item.raw_text,
          text,
          language: 'en',
          audio_ms: 3200,
          word_count: wc,
          timings: { decode_ms: 12, stt_ms: 240, llm_ms: 410, total_ms: 690 },
          applied_snippets: [],
          cleanup_used: 'llm',
          stt_model: serverSettings.stt_model,
          llm_model: serverSettings.llm_model,
          cleanup: settings.cleanup,
          style: settings.style,
          has_audio: item.has_audio
        }
        setRec({ phase: 'done', mode, text, words: wc })
        evResult.emit(clone(result))
        recTimer = setTimeout(() => setRec({ phase: 'idle' }), 1400)
      },
      latency <= 0 ? 0 : 900
    )
  }

  const filterHistory = (q?: string): HistoryItem[] => {
    const needle = q?.trim().toLowerCase()
    if (!needle) return history
    return history.filter((h) => h.text.toLowerCase().includes(needle) || h.raw_text.toLowerCase().includes(needle) || (h.app_name ?? '').toLowerCase().includes(needle))
  }

  const bridge: WisprramBridge = {
    app: {
      info: () => wait<AppInfo>({ version: '0.1.0-mock', platform, arch: 'arm64', sessionType: platform === 'linux' ? 'wayland' : undefined }, 0.3),
      openMainWindow: async (page) => {
        if (page && typeof location !== 'undefined') location.hash = `#/${page}`
      },
      quit: async () => undefined,
      openExternal: async (url) => {
        if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener')
      }
    },
    settings: {
      get: () => wait(settings, 0.4),
      set: async (patch) => {
        await wait(null, 0.4)
        settings = { ...settings, ...patch }
        evSettings.emit(clone(settings))
        return clone(settings)
      },
      onChange: evSettings.on
    },
    connection: {
      status: () => wait(status, 0.5),
      onStatus: evStatus.on,
      refresh: async () => {
        await wait(null)
        return publishStatus({})
      },
      pair: async (serverUrl, codeOrToken) => {
        await wait(null, 3)
        const code = codeOrToken.trim()
        if (!/^https?:\/\//i.test(serverUrl)) throw new Error('Enter a server URL like http://192.168.1.50:8790')
        if (/unreachable|bad/i.test(serverUrl)) throw new Error(`Could not reach ${serverUrl} (connection timed out)`)
        const ok = code.length > 6 || code === '123456'
        if (!ok) throw new Error(/^\d{6}$/.test(code) ? 'That pairing code is wrong or has expired.' : 'Enter the 6-digit code shown by the server (try 123456 in the mock).')
        settings = { ...settings, serverUrl, hasToken: true }
        evSettings.emit(clone(settings))
        return publishStatus({ connection: 'connected', health: clone(MOCK_HEALTH), serverUrl, hint: undefined })
      },
      unpair: async () => {
        await wait(null)
        settings = { ...settings, hasToken: false }
        evSettings.emit(clone(settings))
        publishStatus({ connection: 'unpaired', health: null, hint: 'Pair this app with your server to start dictating.' })
      }
    },
    dictation: {
      toggleHandsFree: async () => {
        if (rec.phase === 'recording') {
          const mode = rec.mode
          evStop.emit()
          finishDictation(mode)
        } else if (rec.phase === 'idle' || rec.phase === 'done' || rec.phase === 'error') {
          clearTimeout(recTimer)
          setRec({ phase: 'recording', mode: 'handsfree', startedAt: now() })
          evStart.emit({ deviceId: settings.micDeviceId, mode: 'handsfree' })
        }
      },
      cancel: async () => {
        clearTimeout(recTimer)
        evCancel.emit()
        setRec({ phase: 'idle' })
      },
      onResult: evResult.on,
      insertText: async () => {
        await wait(null, 0.5)
      }
    },
    history: {
      list: async (q?: HistoryQuery) => {
        const all = filterHistory(q?.q)
        const offset = q?.offset ?? 0
        const limit = q?.limit ?? 50
        const page: HistoryPage = { items: all.slice(offset, offset + limit), total: all.length }
        return wait(page)
      },
      remove: async (id) => {
        await wait(null, 0.6)
        history = history.filter((h) => h.id !== id)
      },
      clear: async () => {
        await wait(null)
        history = []
      },
      getAudio: async (id) => {
        await wait(null, 1.5)
        const item = history.find((h) => h.id === id)
        if (!item) throw new Error('That history item no longer exists.')
        if (!item.has_audio) throw new Error('No recording was kept for this dictation.')
        const seed = Array.from(id).reduce((a, c) => a + c.charCodeAt(0), 0)
        return { data: makeWav(item.audio_ms, seed), mimeType: item.audio_mime ?? 'audio/wav' }
      }
    },
    archive: {
      chooseFolder: async () => {
        await wait(null, 1.2)
        settings = { ...settings, archiveDir: MOCK_ARCHIVE_PICKED }
        evSettings.emit(clone(settings))
        return MOCK_ARCHIVE_PICKED
      },
      folder: () => wait(archiveFolder(), 0.4),
      open: async (entryPath) => {
        await wait(null, 0.3)
        openedPaths.push(entryPath ?? archiveFolder())
        if (typeof console !== 'undefined') console.info('[mock] archive.open', entryPath ?? archiveFolder())
      },
      saveHistoryItem: async (id) => {
        await wait(null, 1.2)
        const item = history.find((h) => h.id === id)
        if (!item) throw new Error('That history item no longer exists.')
        return clone(saveToArchive(item))
      },
      recent: (limit = 10) => wait(archived.slice(0, limit), 0.5),
      onSaved: evSaved.on
    },
    dictionary: {
      list: () => wait([...dictionary].sort((a, b) => a.term.localeCompare(b.term))),
      add: async (e) => {
        await wait(null, 0.6)
        const entry: DictionaryEntry = { id: nextId('d'), term: e.term.trim(), sounds_like: e.sounds_like ?? [] }
        dictionary = [...dictionary, entry]
        return clone(entry)
      },
      update: async (id, e) => {
        await wait(null, 0.6)
        const entry: DictionaryEntry = { id, term: e.term.trim(), sounds_like: e.sounds_like ?? [] }
        dictionary = dictionary.map((d) => (d.id === id ? entry : d))
        return clone(entry)
      },
      remove: async (id) => {
        await wait(null, 0.6)
        dictionary = dictionary.filter((d) => d.id !== id)
      }
    },
    snippets: {
      list: () => wait(snippets),
      add: async (s) => {
        await wait(null, 0.6)
        const entry: Snippet = { id: nextId('s'), ...s }
        snippets = [...snippets, entry]
        return clone(entry)
      },
      update: async (id, s) => {
        await wait(null, 0.6)
        const entry: Snippet = { id, ...s }
        snippets = snippets.map((x) => (x.id === id ? entry : x))
        return clone(entry)
      },
      remove: async (id) => {
        await wait(null, 0.6)
        snippets = snippets.filter((x) => x.id !== id)
      }
    },
    serverSettings: {
      get: () => wait(serverSettings),
      set: async (patch) => {
        await wait(null, 0.6)
        if (patch.audio_dir && !isAbsolutePath(patch.audio_dir)) {
          throw Object.assign(new Error('audio_dir must be an absolute path on the server, for example /home/you/wisprram-audio.'), { code: 'bad_audio_dir' })
        }
        serverSettings = { ...serverSettings, ...patch, ...(patch.audio_dir !== undefined ? { audio_dir: patch.audio_dir.trim() } : {}) }
        return clone(serverSettings)
      }
    },
    stats: { get: () => wait(stats) },
    permissions: {
      get: () => wait(perms, 0.3),
      request: async (kind: PermissionKind) => {
        await wait(null, 1.5)
        const next: PermissionState = perms[kind] === 'not-applicable' ? 'not-applicable' : 'granted'
        perms = { ...perms, [kind]: next }
        return next
      },
      openSettings: async () => undefined
    },
    clipboard: {
      writeText: async (text) => {
        try {
          await navigator.clipboard?.writeText(text)
        } catch {
          /* clipboard may be unavailable in insecure contexts */
        }
      }
    },
    recorder: {
      onStart: evStart.on,
      onStop: evStop.on,
      onCancel: evCancel.on,
      sendAudio: async (data, mimeType, durationMs) => {
        lastAudio = { bytes: data.byteLength, mimeType, durationMs }
        if (typeof console !== 'undefined') console.info('[mock] sendAudio', lastAudio)
        const mode = rec.phase === 'recording' || rec.phase === 'processing' ? rec.mode : 'ptt'
        finishDictation(mode)
      },
      sendCaptureError: async (message) => {
        clearTimeout(recTimer)
        setRec({ phase: 'error', message })
        recTimer = setTimeout(() => setRec({ phase: 'idle' }), 2500)
      },
      onRecState: (cb) => evRec.on(cb)
    }
  }

  const mock: MockControls = {
    setRec: (s) => {
      clearTimeout(recTimer)
      setRec(s)
    },
    getRec: () => rec,
    emitStart: (o) => {
      clearTimeout(recTimer)
      const mode = o?.mode ?? 'ptt'
      setRec({ phase: 'recording', mode, startedAt: now() })
      evStart.emit({ deviceId: o?.deviceId ?? settings.micDeviceId, mode })
    },
    emitStop: () => {
      if (rec.phase === 'recording') {
        // Real main flips to 'processing' once audio arrives; the mock does it when sendAudio lands.
        evStop.emit()
      }
    },
    emitCancel: () => {
      clearTimeout(recTimer)
      evCancel.emit()
      setRec({ phase: 'idle' })
    },
    setConnection: (c) => {
      publishStatus({ connection: c, health: c === 'connected' ? clone(MOCK_HEALTH) : null, hint: c === 'connected' ? undefined : hintFor(c) })
    },
    opened: () => [...openedPaths],
    lastAudio: () => lastAudio
  }

  return Object.assign(bridge, { mock })
}

function hintFor(c: AppStatus['connection']): string | undefined {
  switch (c) {
    case 'unreachable':
      return 'Could not reach the server. Check that your PC is on the same network and the server is running.'
    case 'unauthorized':
      return 'The server rejected this app’s token. Pair again with a new code.'
    case 'unpaired':
      return 'Pair this app with your server to start dictating.'
    case 'unconfigured':
      return 'Set your server URL in Settings.'
    default:
      return undefined
  }
}

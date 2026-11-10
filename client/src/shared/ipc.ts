// IPC contract between main, preload and renderer. FROZEN: only add optional members.
//
// The preload exposes `window.wisprram: WisprramBridge` via contextBridge. Every method returns a
// Promise; failures reject with an Error whose message is human-readable (main maps ApiError → message).
// Subscriptions return an unsubscribe function.
import type {
  CommandResult,
  DictationResult,
  DictionaryEntry,
  DictionaryInput,
  Health,
  HistoryPage,
  HistoryQuery,
  ServerSettings,
  Snippet,
  SnippetInput,
  Stats
} from './api'
import type { ClientSettings } from './settings'

export type ConnectionState = 'unconfigured' | 'unpaired' | 'connecting' | 'connected' | 'unreachable' | 'unauthorized'

export type RecMode = 'ptt' | 'handsfree' | 'command'

/** Overlay pill state machine */
export type RecState =
  | { phase: 'idle' }
  | { phase: 'recording'; mode: RecMode; startedAt: number }
  | { phase: 'processing'; mode: RecMode }
  | { phase: 'done'; mode: RecMode; text: string; words: number }
  | { phase: 'error'; message: string }

export interface AppStatus {
  connection: ConnectionState
  health: Health | null
  serverUrl: string
  rec: RecState
  /** Human hint when connection is not 'connected' */
  hint?: string
}

export type PermissionKind = 'microphone' | 'accessibility' | 'input-monitoring'
export type PermissionState = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown' | 'not-applicable'
export type Permissions = Record<PermissionKind, PermissionState>

export interface AppInfo {
  version: string
  platform: 'darwin' | 'win32' | 'linux'
  arch: string
  /** Linux session type when known */
  sessionType?: 'wayland' | 'x11'
}

/** v0.2 — one dictation/command saved in the local archive */
export interface ArchiveEntry {
  /** absolute path of the entry folder, e.g. <archive>/2026-11-09/193412-dictation-6ab1e37e */
  path: string
  /** files written, relative to `path`: audio.webm, transcript.txt, output.txt, meta.json */
  files: string[]
  historyId?: string
  kind: 'dictation' | 'command'
  createdAt: string
  /** first ~80 chars of the output text */
  preview: string
}

export interface WisprramBridge {
  app: {
    info(): Promise<AppInfo>
    openMainWindow(page?: string): Promise<void>
    quit(): Promise<void>
    openExternal(url: string): Promise<void>
  }
  settings: {
    get(): Promise<ClientSettings>
    /** Partial update; returns the full new settings. Re-registers hotkeys when they change. */
    set(patch: Partial<Omit<ClientSettings, 'hasToken'>>): Promise<ClientSettings>
    onChange(cb: (s: ClientSettings) => void): () => void
  }
  connection: {
    status(): Promise<AppStatus>
    onStatus(cb: (s: AppStatus) => void): () => void
    /** Force a health check now */
    refresh(): Promise<AppStatus>
    /** Pair using a 6-digit code OR paste a raw token (anything longer than 6 chars is treated as a token). */
    pair(serverUrl: string, codeOrToken: string): Promise<AppStatus>
    unpair(): Promise<void>
  }
  dictation: {
    /** Start/stop from the UI (same as the hotkeys) */
    toggleHandsFree(): Promise<void>
    cancel(): Promise<void>
    onResult(cb: (r: DictationResult | CommandResult) => void): () => void
    /** Re-insert a text (e.g. "paste again" from History) into the previously focused app */
    insertText(text: string): Promise<void>
  }
  history: {
    list(q?: HistoryQuery): Promise<HistoryPage>
    remove(id: string): Promise<void>
    clear(): Promise<void>
    /** v0.2: recording kept on the server (HistoryItem.has_audio). Rejects if none. */
    getAudio?(id: string): Promise<{ data: ArrayBuffer; mimeType: string }>
  }
  /** v0.2 — Local archive on this device (see ClientSettings.archive*) */
  archive?: {
    /** Native folder picker; saves the choice to settings.archiveDir and returns it (null if cancelled) */
    chooseFolder(): Promise<string | null>
    /** Resolved absolute folder in use (archiveDir or the default <Documents>/WisprRam) */
    folder(): Promise<string>
    /** Reveal the archive folder (or one entry's folder) in Finder/Explorer/file manager */
    open(entryPath?: string): Promise<void>
    /** Save a past history item into the archive now (fetches audio from the server if it was kept).
     *  Writes the files selected in settings regardless of archiveEnabled. Returns the entry folder. */
    saveHistoryItem(id: string): Promise<ArchiveEntry>
    /** Most recent entries written to the archive (newest first) */
    recent(limit?: number): Promise<ArchiveEntry[]>
    /** Fired after each automatic or manual save */
    onSaved(cb: (e: ArchiveEntry) => void): () => void
  }
  dictionary: {
    list(): Promise<DictionaryEntry[]>
    add(e: DictionaryInput): Promise<DictionaryEntry>
    update(id: string, e: DictionaryInput): Promise<DictionaryEntry>
    remove(id: string): Promise<void>
  }
  snippets: {
    list(): Promise<Snippet[]>
    add(s: SnippetInput): Promise<Snippet>
    update(id: string, s: SnippetInput): Promise<Snippet>
    remove(id: string): Promise<void>
  }
  serverSettings: {
    get(): Promise<ServerSettings>
    set(patch: Partial<ServerSettings>): Promise<ServerSettings>
  }
  stats: {
    get(): Promise<Stats>
  }
  permissions: {
    get(): Promise<Permissions>
    /** Triggers the OS prompt where possible; returns the new state */
    request(kind: PermissionKind): Promise<PermissionState>
    openSettings(kind: PermissionKind): Promise<void>
  }
  clipboard: {
    writeText(text: string): Promise<void>
  }

  /**
   * Overlay-only: audio capture lives in the overlay renderer (it has getUserMedia).
   * Main → overlay: onStart / onStop / onCancel. Overlay → main: sendAudio / sendCaptureError.
   */
  recorder: {
    onStart(cb: (opts: { deviceId: string; mode: RecMode }) => void): () => void
    onStop(cb: () => void): () => void
    onCancel(cb: () => void): () => void
    /** Complete recording as webm/opus (or wav) bytes */
    sendAudio(data: ArrayBuffer, mimeType: string, durationMs: number): Promise<void>
    sendCaptureError(message: string): Promise<void>
    /** Overlay subscribes to drive the pill UI */
    onRecState(cb: (s: RecState) => void): () => void
  }
}

/** Raw channel names (main ↔ preload). Invoke channels use ipcRenderer.invoke; events use webContents.send. */
export const IPC = {
  appInfo: 'app:info',
  appOpenMain: 'app:open-main',
  appQuit: 'app:quit',
  appOpenExternal: 'app:open-external',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  evSettings: 'ev:settings',

  connStatus: 'conn:status',
  connRefresh: 'conn:refresh',
  connPair: 'conn:pair',
  connUnpair: 'conn:unpair',
  evStatus: 'ev:status',

  dictToggleHandsFree: 'dict:toggle-handsfree',
  dictCancel: 'dict:cancel',
  dictInsert: 'dict:insert',
  evResult: 'ev:result',

  historyList: 'history:list',
  historyRemove: 'history:remove',
  historyClear: 'history:clear',
  historyAudio: 'history:audio',

  archiveChoose: 'archive:choose',
  archiveFolder: 'archive:folder',
  archiveOpen: 'archive:open',
  archiveSaveHistory: 'archive:save-history',
  archiveRecent: 'archive:recent',
  evArchiveSaved: 'ev:archive-saved',

  dictList: 'dictionary:list',
  dictAdd: 'dictionary:add',
  dictUpdate: 'dictionary:update',
  dictRemove: 'dictionary:remove',

  snipList: 'snippets:list',
  snipAdd: 'snippets:add',
  snipUpdate: 'snippets:update',
  snipRemove: 'snippets:remove',

  srvSettingsGet: 'srv-settings:get',
  srvSettingsSet: 'srv-settings:set',
  statsGet: 'stats:get',

  permGet: 'perm:get',
  permRequest: 'perm:request',
  permOpen: 'perm:open',

  clipboardWrite: 'clipboard:write',

  evRecStart: 'ev:rec-start',
  evRecStop: 'ev:rec-stop',
  evRecCancel: 'ev:rec-cancel',
  evRecState: 'ev:rec-state',
  recAudio: 'rec:audio',
  recError: 'rec:error'
} as const

declare global {
  interface Window {
    wisprram: WisprramBridge
  }
}

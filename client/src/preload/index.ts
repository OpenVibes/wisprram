// Preload: implements `window.wisprram: WisprramBridge` (see src/shared/ipc.ts) over ipcRenderer.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type WisprramBridge } from '../shared/ipc'

/** ipcRenderer.invoke wraps errors as "Error invoking remote method 'x': Error: msg" — unwrap to just msg. */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    throw new Error(raw.replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/, ''))
  }
}

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const bridge: WisprramBridge = {
  app: {
    info: () => invoke(IPC.appInfo),
    openMainWindow: (page) => invoke(IPC.appOpenMain, page),
    quit: () => invoke(IPC.appQuit),
    openExternal: (url) => invoke(IPC.appOpenExternal, url)
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    set: (patch) => invoke(IPC.settingsSet, patch),
    onChange: (cb) => on(IPC.evSettings, cb)
  },
  connection: {
    status: () => invoke(IPC.connStatus),
    onStatus: (cb) => on(IPC.evStatus, cb),
    refresh: () => invoke(IPC.connRefresh),
    pair: (serverUrl, codeOrToken) => invoke(IPC.connPair, serverUrl, codeOrToken),
    unpair: () => invoke(IPC.connUnpair)
  },
  dictation: {
    toggleHandsFree: () => invoke(IPC.dictToggleHandsFree),
    cancel: () => invoke(IPC.dictCancel),
    onResult: (cb) => on(IPC.evResult, cb),
    insertText: (text) => invoke(IPC.dictInsert, text)
  },
  history: {
    list: (q) => invoke(IPC.historyList, q),
    remove: (id) => invoke(IPC.historyRemove, id),
    clear: () => invoke(IPC.historyClear),
    getAudio: (id) => invoke(IPC.historyAudio, id)
  },
  archive: {
    chooseFolder: () => invoke(IPC.archiveChoose),
    folder: () => invoke(IPC.archiveFolder),
    open: (entryPath) => invoke(IPC.archiveOpen, entryPath),
    saveHistoryItem: (id) => invoke(IPC.archiveSaveHistory, id),
    recent: (limit) => invoke(IPC.archiveRecent, limit),
    onSaved: (cb) => on(IPC.evArchiveSaved, cb)
  },
  dictionary: {
    list: () => invoke(IPC.dictList),
    add: (e) => invoke(IPC.dictAdd, e),
    update: (id, e) => invoke(IPC.dictUpdate, id, e),
    remove: (id) => invoke(IPC.dictRemove, id)
  },
  snippets: {
    list: () => invoke(IPC.snipList),
    add: (s) => invoke(IPC.snipAdd, s),
    update: (id, s) => invoke(IPC.snipUpdate, id, s),
    remove: (id) => invoke(IPC.snipRemove, id)
  },
  serverSettings: {
    get: () => invoke(IPC.srvSettingsGet),
    set: (patch) => invoke(IPC.srvSettingsSet, patch)
  },
  stats: {
    get: () => invoke(IPC.statsGet)
  },
  permissions: {
    get: () => invoke(IPC.permGet),
    request: (kind) => invoke(IPC.permRequest, kind),
    openSettings: (kind) => invoke(IPC.permOpen, kind)
  },
  clipboard: {
    writeText: (text) => invoke(IPC.clipboardWrite, text)
  },
  recorder: {
    onStart: (cb) => on(IPC.evRecStart, cb),
    onStop: (cb) => on(IPC.evRecStop, cb),
    onCancel: (cb) => on(IPC.evRecCancel, cb),
    sendAudio: (data, mimeType, durationMs) => invoke(IPC.recAudio, data, mimeType, durationMs),
    sendCaptureError: (message) => invoke(IPC.recError, message),
    onRecState: (cb) => on(IPC.evRecState, cb)
  }
}

contextBridge.exposeInMainWorld('wisprram', bridge)

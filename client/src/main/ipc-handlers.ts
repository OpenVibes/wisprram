// IPC handlers for every WisprramBridge method. `createHandlers` returns a plain channel → function map
// (also used by the smoke test); `registerIpc` wires it into ipcMain with sender validation.
import { app, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { existsSync } from 'node:fs'
import type { DictionaryInput, HistoryQuery, ServerSettings, SnippetInput } from '@shared/api'
import { IPC, type AppInfo, type ArchiveEntry, type PermissionKind } from '@shared/ipc'
import type { ClientSettings } from '@shared/settings'
import type { ApiClient } from './api-client'
import { isValidHistoryId, type ArchiveService } from './archive-service'
import type { ConnectionMonitor } from './connection'
import { log } from './log'
import { insertText } from './paste'
import { getPermissions, openPermissionSettings, requestPermission } from './permissions'
import type { Recorder } from './recorder'
import type { SettingsStore, SettingsPatch } from './settings-store'
import { ApiError, describeError } from './url'
import type { Windows } from './windows'

export interface IpcContext {
  settings: SettingsStore
  api: ApiClient
  conn: ConnectionMonitor
  recorder: Recorder
  archive: ArchiveService
  windows: Windows
  retryHook(): void
  /** app.hide() etc. before re-inserting text from the UI */
  prepareForeignInsert(): Promise<void>
  finishForeignInsert(): void
}

type Handler = (...args: any[]) => unknown // eslint-disable-line @typescript-eslint/no-explicit-any

const PERMISSION_KINDS: readonly PermissionKind[] = ['microphone', 'accessibility', 'input-monitoring']

export function createHandlers(c: IpcContext): Record<string, Handler> {
  const wrap = <T>(fn: () => Promise<T>): Promise<T> =>
    fn().catch((err) => {
      throw new Error(describeError(err, c.settings.get().serverUrl))
    })

  return {
    [IPC.appInfo]: (): AppInfo => {
      const info: AppInfo = {
        version: app.getVersion(),
        platform: process.platform as AppInfo['platform'],
        arch: process.arch
      }
      if (process.platform === 'linux') info.sessionType = process.env['XDG_SESSION_TYPE'] === 'wayland' ? 'wayland' : 'x11'
      return info
    },
    [IPC.appOpenMain]: (page?: string) => c.windows.openMainWindow(typeof page === 'string' ? page : undefined),
    [IPC.appQuit]: () => app.quit(),
    [IPC.appOpenExternal]: async (url: string) => {
      if (typeof url === 'string' && /^(https?:\/\/|mailto:)/i.test(url)) await shell.openExternal(url)
    },

    [IPC.settingsGet]: (): ClientSettings => c.settings.get(),
    [IPC.settingsSet]: (patch: SettingsPatch): ClientSettings => c.settings.set(patch ?? {}),

    [IPC.connStatus]: () => c.conn.getStatus(),
    [IPC.connRefresh]: () => c.conn.refresh(true),
    [IPC.connPair]: (url: string, codeOrToken: string) => c.conn.pair(String(url ?? ''), String(codeOrToken ?? '')),
    [IPC.connUnpair]: () => c.conn.unpair(),

    [IPC.dictToggleHandsFree]: () => c.recorder.toggleHandsFree(),
    [IPC.dictCancel]: () => c.recorder.cancel(),
    [IPC.dictInsert]: async (text: string) => {
      if (typeof text !== 'string' || !text) return
      await c.prepareForeignInsert()
      try {
        const s = c.settings.get()
        const out = await insertText(text, s.pasteMethod, s.restoreClipboard)
        if (out.hint) c.recorder.flash(out.hint)
      } finally {
        c.finishForeignInsert()
      }
    },

    [IPC.historyList]: (q?: HistoryQuery) => wrap(() => c.api.historyList(q)),
    [IPC.historyRemove]: (id: string) => wrap(() => c.api.historyRemove(id)),
    [IPC.historyClear]: () => wrap(() => c.api.historyClear()),

    [IPC.historyAudio]: async (id: string) => {
      if (!isValidHistoryId(id)) throw new Error('Invalid history item')
      try {
        return await c.api.historyAudio(id)
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.code === 'no_audio')) {
          throw new Error('No recording was kept for this item. Turn on "Save audio" in the server settings to keep future recordings.')
        }
        throw new Error(describeError(err, c.settings.get().serverUrl))
      }
    },

    [IPC.archiveChoose]: async (): Promise<string | null> => {
      const win = c.windows.main && !c.windows.main.isDestroyed() ? c.windows.main : null
      const current = c.archive.folder()
      const opts: OpenDialogOptions = {
        title: 'Choose the archive folder',
        buttonLabel: 'Use this folder',
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
        ...(existsSync(current) ? { defaultPath: current } : {})
      }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      const dir = r.canceled ? undefined : r.filePaths[0]
      if (!dir) return null
      c.settings.set({ archiveDir: dir })
      return dir
    },
    [IPC.archiveFolder]: (): string => c.archive.folder(),
    [IPC.archiveOpen]: async (entryPath?: string): Promise<void> => {
      if (entryPath === undefined || entryPath === null || entryPath === '') {
        const dir = await c.archive.ensureFolder()
        const err = await shell.openPath(dir)
        if (err) throw new Error(`Couldn't open the archive folder: ${err}`)
        return
      }
      shell.showItemInFolder(await c.archive.resolveInside(entryPath))
    },
    [IPC.archiveSaveHistory]: (id: string): Promise<ArchiveEntry> => {
      if (!isValidHistoryId(id)) throw new Error('Invalid history item')
      return c.archive.saveHistoryItem(id).catch((err) => {
        throw new Error(describeError(err, c.settings.get().serverUrl))
      })
    },
    [IPC.archiveRecent]: (limit?: number): Promise<ArchiveEntry[]> =>
      c.archive.recent(typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 200)) : 20),

    [IPC.dictList]: () => wrap(() => c.api.dictionaryList()),
    [IPC.dictAdd]: (e: DictionaryInput) => wrap(() => c.api.dictionaryAdd(e)),
    [IPC.dictUpdate]: (id: string, e: DictionaryInput) => wrap(() => c.api.dictionaryUpdate(id, e)),
    [IPC.dictRemove]: (id: string) => wrap(() => c.api.dictionaryRemove(id)),

    [IPC.snipList]: () => wrap(() => c.api.snippetsList()),
    [IPC.snipAdd]: (s: SnippetInput) => wrap(() => c.api.snippetsAdd(s)),
    [IPC.snipUpdate]: (id: string, s: SnippetInput) => wrap(() => c.api.snippetsUpdate(id, s)),
    [IPC.snipRemove]: (id: string) => wrap(() => c.api.snippetsRemove(id)),

    [IPC.srvSettingsGet]: () => wrap(() => c.api.serverSettingsGet()),
    [IPC.srvSettingsSet]: (patch: Partial<ServerSettings>) => wrap(() => c.api.serverSettingsSet(patch)),
    [IPC.statsGet]: () => wrap(() => c.api.statsGet()),

    [IPC.permGet]: () => getPermissions(),
    [IPC.permRequest]: (kind: PermissionKind) => {
      assertKind(kind)
      return requestPermission(kind, c.retryHook)
    },
    [IPC.permOpen]: (kind: PermissionKind) => {
      assertKind(kind)
      return openPermissionSettings(kind)
    },

    [IPC.clipboardWrite]: async (text: string) => {
      await clipboard.writeText(String(text ?? ''))
    },

    // overlay → main
    [IPC.recAudio]: (data: ArrayBuffer | Uint8Array, mimeType: string, durationMs: number) => {
      const ab = data instanceof ArrayBuffer ? data : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
      return c.recorder.onAudio(ab, String(mimeType || 'audio/webm'), Number(durationMs) || 0)
    },
    [IPC.recError]: (message: string) => c.recorder.onCaptureError(String(message ?? ''))
  }
}

function assertKind(kind: unknown): asserts kind is PermissionKind {
  if (!PERMISSION_KINDS.includes(kind as PermissionKind)) throw new Error('Unknown permission')
}

const OVERLAY_ONLY = new Set<string>([IPC.recAudio, IPC.recError])

export function registerIpc(c: IpcContext, handlers = createHandlers(c)): void {
  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!c.windows.isOurs(event.sender)) {
        log('rejected IPC from unknown sender', channel)
        throw new Error('Not allowed')
      }
      if (OVERLAY_ONLY.has(channel) && !c.windows.isOverlay(event.sender)) throw new Error('Not allowed')
      return fn(...args)
    })
  }
}

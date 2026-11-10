// WisprRam main process bootstrap.
import { join } from 'node:path'
import { homedir } from 'node:os'
import { app, nativeTheme, powerMonitor } from 'electron'
import { IPC } from '@shared/ipc'
import { ApiClient } from './api-client'
import { ArchiveService } from './archive-service'
import { ConnectionMonitor } from './connection'
import { getFrontmostApp } from './context'
import { Hotkeys } from './hotkeys'
import { registerIpc, type IpcContext } from './ipc-handlers'
import { log } from './log'
import { captureSelection, insertText } from './paste'
import { Recorder } from './recorder'
import { SettingsStore } from './settings-store'
import { runSmokeTest } from './smoke'
import { AppTray } from './tray'
import { Windows } from './windows'

const SMOKE = process.env['WISPRRAM_SMOKE'] === '1'
const isMac = process.platform === 'darwin'

// ---- before ready ----------------------------------------------------------------------------------
app.setName('WisprRam')
// Pin userData so dev and packaged builds share one folder (and allow tests to use a temp one).
app.setPath('userData', process.env['WISPRRAM_USER_DATA'] || join(app.getPath('appData'), 'WisprRam'))

if (process.platform === 'linux' && process.env['XDG_SESSION_TYPE'] === 'wayland') {
  // Lets globalShortcut work on Wayland through the XDG GlobalShortcuts portal.
  app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')
}

process.on('uncaughtException', (err) => log('uncaughtException', err))
process.on('unhandledRejection', (err) => log('unhandledRejection', err))

const windows = new Windows()

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (app.isReady()) windows.openMainWindow()
  })
  void app.whenReady().then(boot).catch((err) => {
    log('fatal boot error', err)
    app.exit(1)
  })
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function boot(): Promise<void> {
  log('starting', app.getVersion(), process.platform, process.arch, SMOKE ? '(smoke)' : '')
  const settings = new SettingsStore()
  await settings.init()
  nativeTheme.themeSource = settings.get().theme

  const api = new ApiClient(() => ({ baseUrl: settings.get().serverUrl, token: settings.getToken() }))
  const conn = new ConnectionMonitor(api, settings)

  const archive = new ArchiveService({
    getSettings: () => settings.get(),
    defaultDir: () => {
      let docs: string
      try {
        docs = app.getPath('documents')
      } catch {
        docs = join(homedir(), 'Documents')
      }
      return join(docs, 'WisprRam')
    },
    client: () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch }),
    api: { historyGet: (id) => api.historyGet(id), historyAudio: (id) => api.historyAudio(id) },
    onSaved: (e) => windows.sendToMain(IPC.evArchiveSaved, e),
    setHint: (t) => conn.setExtraHint('archive', t),
    log
  })

  let hotkeys: Hotkeys | null = null
  const recorder = new Recorder({
    getSettings: () => settings.get(),
    overlay: {
      start: (opts) => windows.sendToOverlay(IPC.evRecStart, opts),
      stop: () => windows.sendToOverlay(IPC.evRecStop),
      cancel: () => windows.sendToOverlay(IPC.evRecCancel)
    },
    api,
    insert: (text) => {
      const s = settings.get()
      return insertText(text, s.pasteMethod, s.restoreClipboard)
    },
    captureSelection,
    getContext: getFrontmostApp,
    onState: (s) => {
      windows.broadcast(IPC.evRecState, s)
      conn.setRecState(s)
      windows.onRecState(s, settings.get().showOverlay)
      hotkeys?.onRecState()
    },
    onResult: (r) => windows.sendToMain(IPC.evResult, r),
    archive: (job) => archive.saveJob(job),
    log
  })

  hotkeys = new Hotkeys(recorder, () => settings.get(), { setHint: (k, t) => conn.setExtraHint(k, t) })

  windows.installPermissionHandlers()
  windows.createOverlay()

  const tray = new AppTray({
    open: (page) => windows.openMainWindow(page),
    toggleHandsFree: () => recorder.toggleHandsFree(),
    quit: () => app.quit()
  })
  tray.create(conn.getStatus())
  conn.onStatus((s) => {
    tray.update(s)
    windows.broadcast(IPC.evStatus, s)
  })

  settings.onChange((cur, prev) => {
    windows.broadcast(IPC.evSettings, cur)
    if (cur.archiveDir !== prev.archiveDir || cur.archiveEnabled !== prev.archiveEnabled) conn.setExtraHint('archive', null)
    if (cur.theme !== prev.theme) nativeTheme.themeSource = cur.theme
    if (!SMOKE && (cur.pttKey !== prev.pttKey || cur.handsFreeShortcut !== prev.handsFreeShortcut || cur.commandShortcut !== prev.commandShortcut)) {
      hotkeys?.applySettings(cur)
    }
    if (!cur.showOverlay && prev.showOverlay) windows.onRecState({ phase: 'idle' }, false)
  })
  if (app.isPackaged) settings.applyLoginItem()

  const ctx: IpcContext = {
    settings,
    api,
    conn,
    recorder,
    archive,
    windows,
    retryHook: () => hotkeys?.retryHook(),
    prepareForeignInsert: async () => {
      windows.hideMain()
      if (isMac) app.hide()
      await sleep(250)
    },
    finishForeignInsert: () => {
      if (isMac) app.show() // un-hide without stealing focus from the target app
    }
  }
  registerIpc(ctx)

  powerMonitor.on('resume', () => void conn.refresh())
  powerMonitor.on('unlock-screen', () => void conn.refresh())

  app.on('activate', () => windows.openMainWindow())
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  })
  app.on('before-quit', () => {
    windows.isQuitting = true
    conn.stop()
    hotkeys?.stop()
    tray.destroy()
  })

  conn.start()

  if (SMOKE) {
    void runSmokeTest({ settings, api, conn, windows, archive })
    return
  }

  hotkeys.start(settings.get())

  const s = settings.get()
  if (!s.onboardingDone) {
    windows.openMainWindow('onboarding')
  } else if (app.getLoginItemSettings().wasOpenedAtLogin || process.argv.includes('--hidden')) {
    if (isMac) app.dock?.hide()
  } else {
    windows.openMainWindow('home')
  }
}

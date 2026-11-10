// Main window + overlay window management.
import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, screen, session, shell, type WebContents } from 'electron'
import type { RecState } from '@shared/ipc'
import { log } from './log'

export const PAGES = ['home', 'history', 'dictionary', 'snippets', 'style', 'settings', 'onboarding'] as const
export type Page = (typeof PAGES)[number]

const OVERLAY_W = 280
const OVERLAY_H = 80
const OVERLAY_BOTTOM_GAP = 24
/** PTT recordings start on key-down; hold the pill back briefly so accidental taps don't flash it. */
const PTT_OVERLAY_DELAY_MS = 180

const isMac = process.platform === 'darwin'

export function resourcesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')
}

function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

function rendererTarget(file: 'index.html' | 'overlay.html', hash?: string): { url?: string; file?: string; hash?: string } {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) return { url: `${dev.replace(/\/$/, '')}/${file}${hash ? `#${hash}` : ''}` }
  return { file: join(__dirname, '../renderer', file), ...(hash ? { hash } : {}) }
}

function load(win: BrowserWindow, file: 'index.html' | 'overlay.html', hash?: string): void {
  const t = rendererTarget(file, hash)
  const p = t.url ? win.loadURL(t.url) : win.loadFile(t.file as string, t.hash ? { hash: t.hash } : undefined)
  p.catch((err) => log('failed to load', file, err))
}

function hardenWebContents(wc: WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (e, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    const ok = dev ? url.startsWith(new URL(dev).origin) : url.startsWith('file://')
    if (!ok) {
      e.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })
}

export class Windows {
  main: BrowserWindow | null = null
  overlay: BrowserWindow | null = null
  isQuitting = false
  private pendingPage: Page | null = null
  private overlayShowTimer: ReturnType<typeof setTimeout> | null = null
  /** invoked when the main window becomes visible/hidden (tray refresh, dock) */
  onMainVisibility?: (visible: boolean) => void

  /** Allow microphone for our own windows only; deny every other permission request. */
  installPermissionHandlers(): void {
    const ses = session.defaultSession
    const allowed = (p: string) => p === 'media' || p === 'clipboard-sanitized-write'
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed(permission)))
    ses.setPermissionCheckHandler((_wc, permission) => allowed(permission))
  }

  // ---- main window -------------------------------------------------------------------------------
  private createMain(page: Page): BrowserWindow {
    const win = new BrowserWindow({
      width: 960,
      height: 680,
      minWidth: 820,
      minHeight: 560,
      show: false,
      title: 'WisprRam',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#121212' : '#ffffff',
      ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } } : { autoHideMenuBar: true }),
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    hardenWebContents(win.webContents)
    win.on('close', (e) => {
      if (!this.isQuitting) {
        e.preventDefault()
        win.hide()
      }
    })
    win.on('show', () => this.mainVisibility(true))
    win.on('hide', () => this.mainVisibility(false))
    win.on('closed', () => {
      this.main = null
    })
    win.webContents.on('did-finish-load', () => {
      if (this.pendingPage) {
        const p = this.pendingPage
        this.pendingPage = null
        void this.setHash(win, p)
      }
    })
    load(win, 'index.html', `/${page}`)
    return win
  }

  private mainVisibility(visible: boolean): void {
    if (isMac) {
      if (visible) void app.dock?.show()
      else app.dock?.hide()
    }
    this.onMainVisibility?.(visible)
  }

  private async setHash(win: BrowserWindow, page: Page): Promise<void> {
    try {
      await win.webContents.executeJavaScript(`location.hash = '#/${page}'`)
    } catch (err) {
      log('could not navigate to page', page, err)
    }
  }

  /** Create the main window if needed without showing it (used by smoke tests). */
  ensureMain(page: Page = 'home'): BrowserWindow {
    if (!this.main || this.main.isDestroyed()) this.main = this.createMain(page)
    return this.main
  }

  openMainWindow(pageIn?: string): void {
    const page: Page = (PAGES as readonly string[]).includes(pageIn ?? '') ? (pageIn as Page) : 'home'
    const fresh = !this.main || this.main.isDestroyed()
    const win = this.ensureMain(page)
    if (!fresh) {
      if (win.webContents.isLoading()) this.pendingPage = page
      else void this.setHash(win, page)
    }
    if (fresh && win.webContents.isLoading()) {
      // avoid flashing a blank window: show once the first frame is ready
      win.once('ready-to-show', () => {
        win.show()
        win.focus()
      })
      return
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  hideMain(): void {
    if (this.main && !this.main.isDestroyed() && this.main.isVisible()) this.main.hide()
  }

  get mainVisible(): boolean {
    return !!this.main && !this.main.isDestroyed() && this.main.isVisible()
  }

  // ---- overlay window ----------------------------------------------------------------------------
  createOverlay(): BrowserWindow {
    const win = new BrowserWindow({
      width: OVERLAY_W,
      height: OVERLAY_H,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      ...(isMac ? { type: 'panel' as const } : {}),
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required' // overlay sound cues
      }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true)
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    hardenWebContents(win.webContents)
    win.on('closed', () => {
      this.overlay = null
    })
    load(win, 'overlay.html')
    this.overlay = win
    return win
  }

  private positionOverlay(): void {
    const win = this.overlay
    if (!win || win.isDestroyed()) return
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const wa = display.workArea
    win.setBounds({
      x: Math.round(wa.x + (wa.width - OVERLAY_W) / 2),
      y: Math.round(wa.y + wa.height - OVERLAY_H - OVERLAY_BOTTOM_GAP),
      width: OVERLAY_W,
      height: OVERLAY_H
    })
  }

  /** React to recorder state: show (inactive!) while busy, hide when idle. */
  onRecState(state: RecState, showOverlay: boolean): void {
    const win = this.overlay
    if (!win || win.isDestroyed()) return
    if (this.overlayShowTimer) {
      clearTimeout(this.overlayShowTimer)
      this.overlayShowTimer = null
    }
    if (state.phase === 'idle' || !showOverlay) {
      if (win.isVisible()) win.hide()
      return
    }
    const show = () => {
      if (win.isDestroyed()) return
      this.positionOverlay()
      if (!win.isVisible()) win.showInactive()
      win.setAlwaysOnTop(true, 'screen-saver')
    }
    if (state.phase === 'recording' && state.mode === 'ptt' && !win.isVisible()) {
      this.overlayShowTimer = setTimeout(show, PTT_OVERLAY_DELAY_MS)
    } else {
      show()
    }
  }

  // ---- messaging ---------------------------------------------------------------------------------
  /** webContents of every live window (main + overlay) */
  private all(): WebContents[] {
    return [this.main, this.overlay].filter((w): w is BrowserWindow => !!w && !w.isDestroyed()).map((w) => w.webContents)
  }

  broadcast(channel: string, ...args: unknown[]): void {
    for (const wc of this.all()) if (!wc.isDestroyed()) wc.send(channel, ...args)
  }

  sendToMain(channel: string, ...args: unknown[]): void {
    if (this.main && !this.main.isDestroyed()) this.main.webContents.send(channel, ...args)
  }

  sendToOverlay(channel: string, ...args: unknown[]): void {
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.webContents.send(channel, ...args)
  }

  isOurs(wc: WebContents): boolean {
    return this.all().some((x) => x.id === wc.id)
  }

  isOverlay(wc: WebContents): boolean {
    return !!this.overlay && !this.overlay.isDestroyed() && this.overlay.webContents.id === wc.id
  }
}

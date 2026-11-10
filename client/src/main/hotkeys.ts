// Global input: uiohook (hold-to-talk key, Esc) + Electron globalShortcut (hands-free / command toggles).
import { globalShortcut } from 'electron'
import type { ClientSettings } from '@shared/settings'
import { noteKey, setModifierTracking } from './input-state'
import { log } from './log'
import { setInputMonitoringState } from './permissions'
import { PttDetector } from './ptt'
import type { Recorder } from './recorder'
import { loadUiohook } from './uio'

const ESC = 1 // UiohookKey.Escape
const isWayland = process.platform === 'linux' && process.env['XDG_SESSION_TYPE'] === 'wayland'

export interface HotkeyHints {
  setHint(key: string, text: string | null): void
}

export class Hotkeys {
  private ptt: PttDetector
  private hookRunning = false
  private sawKey = false
  private registered: string[] = []
  private escRegistered = false
  private settings: ClientSettings

  constructor(
    private readonly recorder: Recorder,
    getSettings: () => ClientSettings,
    private readonly hints: HotkeyHints
  ) {
    this.settings = getSettings()
    this.ptt = new PttDetector({ keycode: -1 }, (e) => {
      switch (e.type) {
        case 'start':
          return this.recorder.pttPress()
        case 'lock':
          return this.recorder.lockHandsFree()
        case 'stop':
          return this.recorder.pttRelease()
        case 'cancel':
          return this.recorder.pttCancel()
      }
    })
  }

  /** Start the low-level hook (once) and register shortcuts. Safe to call again. */
  start(settings: ClientSettings): void {
    this.settings = settings
    this.startHook()
    this.applySettings(settings)
  }

  /** Re-register everything that depends on settings. */
  applySettings(settings: ClientSettings): void {
    this.settings = settings
    this.updatePttKey()
    this.registerShortcuts()
  }

  /** Retry the hook (e.g. after the user grants Input Monitoring). */
  retryHook(): void {
    if (this.hookRunning) return
    this.startHook()
    this.updatePttKey()
  }

  stop(): void {
    globalShortcut.unregisterAll()
    this.registered = []
    this.escRegistered = false
    const uio = loadUiohook()
    if (uio && this.hookRunning) {
      try {
        uio.uIOhook.stop()
      } catch (err) {
        log('uiohook stop failed', err)
      }
    }
    this.hookRunning = false
    setModifierTracking(false)
  }

  /** Called by the app on every recorder state change. */
  onRecState(): void {
    // Without the low-level hook we can't see Esc, so grab it as a global shortcut only while recording.
    if (this.hookRunning) return
    const recording = this.recorder.isRecording
    if (recording && !this.escRegistered) {
      try {
        this.escRegistered = globalShortcut.register('Escape', () => this.recorder.cancel())
      } catch {
        this.escRegistered = false
      }
    } else if (!recording && this.escRegistered) {
      globalShortcut.unregister('Escape')
      this.escRegistered = false
    }
  }

  // ---- internals ---------------------------------------------------------------------------------
  private startHook(): void {
    if (this.hookRunning) return
    const uio = loadUiohook()
    if (!uio) {
      this.hints.setHint('hook', 'Hold-to-talk is unavailable (keyboard hook failed to load). The hands-free shortcut still works.')
      setInputMonitoringState(process.platform === 'darwin' ? false : null)
      return
    }
    try {
      uio.uIOhook.on('keydown', (e) => {
        if (!this.sawKey) {
          this.sawKey = true
          setInputMonitoringState(true)
        }
        noteKey(e.keycode, true)
        if (e.keycode === ESC && this.recorder.isRecording) this.recorder.cancel()
        this.ptt.keyDown(e.keycode, Date.now())
      })
      uio.uIOhook.on('keyup', (e) => {
        noteKey(e.keycode, false)
        this.ptt.keyUp(e.keycode, Date.now())
      })
      uio.uIOhook.start()
      this.hookRunning = true
      setModifierTracking(true)
      if (process.platform === 'darwin') {
        // Starting succeeded, but macOS can still silently deliver nothing without Input Monitoring.
        setInputMonitoringState(null)
        this.hints.setHint('hook', null)
      } else if (isWayland) {
        this.hints.setHint(
          'hook',
          'Wayland: hold-to-talk only works while an XWayland app is focused. Use the hands-free shortcut instead.'
        )
      } else {
        this.hints.setHint('hook', null)
      }
    } catch (err) {
      log('uiohook failed to start', err)
      this.hookRunning = false
      if (process.platform === 'darwin') {
        setInputMonitoringState(false)
        this.hints.setHint('hook', 'Grant Input Monitoring in System Settings → Privacy & Security to use hold-to-talk. The hands-free shortcut still works.')
      } else {
        this.hints.setHint('hook', 'Hold-to-talk is unavailable (keyboard hook failed). The hands-free shortcut still works.')
      }
    }
  }

  private updatePttKey(): void {
    const uio = loadUiohook()
    const code = uio ? (uio.UiohookKey as Record<string, number>)[this.settings.pttKey] : undefined
    if (code === undefined) {
      log('unknown pttKey', this.settings.pttKey)
      this.ptt.setKeycode(-1)
      if (uio) this.hints.setHint('ptt', `Unknown hold-to-talk key "${this.settings.pttKey}" — pick another in Settings.`)
      return
    }
    this.hints.setHint('ptt', null)
    this.ptt.setKeycode(code)
  }

  private registerShortcuts(): void {
    for (const acc of this.registered) globalShortcut.unregister(acc)
    this.registered = []
    const failed: string[] = []
    const reg = (acc: string, fn: () => void) => {
      if (!acc) return
      try {
        if (globalShortcut.register(acc, fn)) this.registered.push(acc)
        else failed.push(acc)
      } catch (err) {
        log('invalid shortcut', acc, err)
        failed.push(acc)
      }
    }
    reg(this.settings.handsFreeShortcut, () => this.recorder.toggleHandsFree())
    if (this.settings.commandShortcut !== this.settings.handsFreeShortcut) {
      reg(this.settings.commandShortcut, () => this.recorder.toggleCommand())
    }
    this.hints.setHint('shortcuts', failed.length ? `Couldn't register shortcut${failed.length > 1 ? 's' : ''}: ${failed.join(', ')} (already in use?)` : null)
  }
}

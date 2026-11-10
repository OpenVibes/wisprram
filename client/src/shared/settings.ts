// Client-side settings, persisted by the main process. FROZEN: only add optional fields.
import type { CleanupLevel, Language, Style } from './api'

export type PasteMethod = 'auto' | 'clipboard-only'

export interface ClientSettings {
  /** e.g. "http://192.168.1.50:8790" — empty until the user connects */
  serverUrl: string
  /** Bearer token from pairing. Main process stores it encrypted; renderer only ever sees `hasToken`. */
  hasToken: boolean
  /** uiohook key name held for push-to-talk, e.g. "AltRight", "CtrlRight", "MetaRight" (see uiohook-napi UiohookKey) */
  pttKey: string
  /** Electron accelerator toggling hands-free recording */
  handsFreeShortcut: string
  /** Electron accelerator for command mode (edit selected text by voice) */
  commandShortcut: string
  /** MediaDeviceInfo.deviceId, or "default" */
  micDeviceId: string
  language: Language
  cleanup: CleanupLevel
  style: Style
  playSounds: boolean
  showOverlay: boolean
  launchAtLogin: boolean
  pasteMethod: PasteMethod
  restoreClipboard: boolean
  onboardingDone: boolean
  theme: 'system' | 'light' | 'dark'

  // v0.2 — Local archive: copies of each dictation saved on THIS device
  /** master switch (default false) */
  archiveEnabled?: boolean
  /** absolute folder chosen in the app; "" = <Documents>/WisprRam */
  archiveDir?: string
  /** what to write per dictation */
  archiveAudio?: boolean
  archiveTranscript?: boolean
  archiveOutput?: boolean
  archiveMeta?: boolean
}

export function defaultSettings(platform: string): ClientSettings {
  return {
    serverUrl: '',
    hasToken: false,
    pttKey: platform === 'darwin' ? 'AltRight' : 'CtrlRight',
    handsFreeShortcut: 'CommandOrControl+Shift+Space',
    commandShortcut: 'CommandOrControl+Shift+E',
    micDeviceId: 'default',
    language: 'auto',
    cleanup: 'full',
    style: 'casual',
    playSounds: true,
    showOverlay: true,
    launchAtLogin: false,
    pasteMethod: 'auto',
    restoreClipboard: true,
    onboardingDone: false,
    theme: 'system',
    archiveEnabled: false,
    archiveDir: '',
    archiveAudio: true,
    archiveTranscript: true,
    archiveOutput: true,
    archiveMeta: true
  }
}

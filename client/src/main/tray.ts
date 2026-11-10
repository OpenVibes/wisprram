// Tray / menu-bar icon and menu.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Menu, nativeImage, Tray, type NativeImage } from 'electron'
import type { AppStatus } from '@shared/ipc'
import { drawCircleBitmap } from './icon-draw'
import { log } from './log'
import { hostPort } from './url'
import { resourcesDir } from './windows'

const isMac = process.platform === 'darwin'

export interface TrayActions {
  open(page?: string): void
  toggleHandsFree(): void
  quit(): void
}

function fallbackIcon(recording: boolean): NativeImage {
  const size = isMac ? 22 : 32
  const rgb: [number, number, number] = isMac ? [0, 0, 0] : recording ? [229, 57, 53] : [120, 120, 130]
  const img = nativeImage.createFromBitmap(drawCircleBitmap(size, rgb, isMac && !recording), { width: size, height: size })
  if (isMac) img.setTemplateImage(true)
  return img
}

function loadIcon(recording: boolean): NativeImage {
  const dir = join(resourcesDir(), 'tray')
  const file = isMac ? (recording ? 'trayRecordingTemplate.png' : 'trayTemplate.png') : recording ? 'tray-recording.png' : 'tray.png'
  const path = join(dir, file)
  if (existsSync(path)) {
    const img = nativeImage.createFromPath(path)
    if (!img.isEmpty()) {
      if (isMac) img.setTemplateImage(true)
      return img
    }
  }
  log('tray icon missing, drawing fallback:', path)
  return fallbackIcon(recording)
}

export function statusLine(s: AppStatus): string {
  switch (s.connection) {
    case 'connected':
      return `Connected · ${hostPort(s.serverUrl)}`
    case 'connecting':
      return 'Connecting…'
    case 'unconfigured':
      return 'Server not set up'
    case 'unpaired':
      return 'Not paired — open Settings'
    case 'unauthorized':
      return 'Pairing rejected — pair again'
    case 'unreachable':
      return `Can't reach server (${hostPort(s.serverUrl)})`
  }
}

function tooltip(s: AppStatus): string {
  switch (s.rec.phase) {
    case 'recording':
      return s.rec.mode === 'command' ? 'WisprRam — listening (command)' : 'WisprRam — listening'
    case 'processing':
      return 'WisprRam — transcribing…'
    case 'done':
      return 'WisprRam — inserted'
    case 'error':
      return `WisprRam — ${s.rec.message}`
    default:
      return s.connection === 'connected' ? 'WisprRam — ready' : `WisprRam — ${statusLine(s)}`
  }
}

export class AppTray {
  private tray: Tray | null = null
  private icons: { idle: NativeImage; rec: NativeImage } | null = null
  private lastKey = ''
  private lastRecording: boolean | null = null

  constructor(private readonly actions: TrayActions) {}

  create(initial: AppStatus): void {
    try {
      this.icons = { idle: loadIcon(false), rec: loadIcon(true) }
      this.tray = new Tray(this.icons.idle)
      if (!isMac) this.tray.on('click', () => this.actions.open())
      this.update(initial)
    } catch (err) {
      log('tray creation failed', err)
      this.tray = null
    }
  }

  update(s: AppStatus): void {
    const t = this.tray
    if (!t || t.isDestroyed() || !this.icons) return
    const recording = s.rec.phase === 'recording'
    if (recording !== this.lastRecording) {
      t.setImage(recording ? this.icons.rec : this.icons.idle)
      this.lastRecording = recording
    }
    t.setToolTip(tooltip(s))
    const key = `${statusLine(s)}|${s.rec.phase}|${s.rec.phase === 'recording' ? s.rec.mode : ''}`
    if (key === this.lastKey) return
    this.lastKey = key
    const rec = s.rec.phase === 'recording'
    t.setContextMenu(
      Menu.buildFromTemplate([
        { label: statusLine(s), enabled: false },
        { type: 'separator' },
        { label: 'Open WisprRam', click: () => this.actions.open('home') },
        {
          label: rec ? 'Stop dictation' : 'Start hands-free dictation',
          enabled: s.rec.phase === 'idle' || rec,
          click: () => this.actions.toggleHandsFree()
        },
        { type: 'separator' },
        { label: 'History', click: () => this.actions.open('history') },
        { label: 'Settings…', click: () => this.actions.open('settings') },
        { type: 'separator' },
        { label: 'Quit WisprRam', click: () => this.actions.quit() }
      ])
    )
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}

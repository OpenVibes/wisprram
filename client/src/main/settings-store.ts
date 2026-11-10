// Persistent client settings (JSON in userData) + the bearer token stored separately (safeStorage-encrypted).
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import { defaultSettings, type ClientSettings } from '@shared/settings'
import { log } from './log'
import { normalizeServerUrl } from './url'

type Stored = Omit<ClientSettings, 'hasToken'>
export type SettingsPatch = Partial<Omit<ClientSettings, 'hasToken'>>

export class SettingsStore {
  private readonly dir: string
  private readonly settingsFile: string
  private readonly tokenEnc: string
  private readonly tokenPlain: string
  private data: Stored
  private token: string | null = null
  private listeners = new Set<(s: ClientSettings, prev: ClientSettings) => void>()

  constructor(dir = app.getPath('userData')) {
    this.dir = dir
    this.settingsFile = join(dir, 'settings.json')
    this.tokenEnc = join(dir, 'token.enc')
    this.tokenPlain = join(dir, 'token.txt')
    const defaults = stripToken(defaultSettings(process.platform))
    this.data = { ...defaults, ...this.load(defaults) }
  }

  /** Load the (possibly encrypted) token. Must be awaited once after construction. */
  async init(): Promise<void> {
    this.token = await this.loadToken()
  }

  get(): ClientSettings {
    return { ...this.data, hasToken: this.token !== null }
  }

  getToken(): string | null {
    return this.token
  }

  /** Partial update. Persists, applies launch-at-login, notifies listeners. Returns the full settings. */
  set(patch: SettingsPatch): ClientSettings {
    const prev = this.get()
    const next: Stored = { ...this.data }
    const defaults = stripToken(defaultSettings(process.platform))
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in defaults) || v === undefined) continue
      ;(next as Record<string, unknown>)[k] = v
    }
    if (patch.serverUrl !== undefined && patch.serverUrl.trim() !== '') next.serverUrl = normalizeServerUrl(patch.serverUrl)
    this.data = next
    this.save()
    if (patch.launchAtLogin !== undefined && patch.launchAtLogin !== prev.launchAtLogin) this.applyLoginItem()
    this.emit(prev)
    return this.get()
  }

  /** Updates the in-memory token immediately; resolves once it is persisted. */
  async setToken(token: string | null): Promise<void> {
    const prev = this.get()
    this.token = token && token.length > 0 ? token : null
    this.emit(prev)
    await this.saveToken()
  }

  onChange(cb: (s: ClientSettings, prev: ClientSettings) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  applyLoginItem(): void {
    // setLoginItemSettings is only meaningful for packaged apps on mac/win; harmless elsewhere.
    try {
      if (process.platform === 'linux') return
      // Only touch the OS login items when the state actually differs: on macOS an unsigned app
      // outside /Applications gets "Operation not permitted" for every call, even openAtLogin:false.
      if (app.getLoginItemSettings().openAtLogin === this.data.launchAtLogin) return
      app.setLoginItemSettings({ openAtLogin: this.data.launchAtLogin, ...(process.platform === 'win32' ? { args: ['--hidden'] } : {}) })
    } catch (err) {
      log('setLoginItemSettings failed', err)
    }
  }

  // ---- persistence -------------------------------------------------------------------------------
  private emit(prev: ClientSettings): void {
    const cur = this.get()
    for (const l of this.listeners) {
      try {
        l(cur, prev)
      } catch (err) {
        log('settings listener failed', err)
      }
    }
  }

  private load(defaults: Stored): Partial<Stored> {
    try {
      if (!existsSync(this.settingsFile)) return {}
      const raw = JSON.parse(readFileSync(this.settingsFile, 'utf8')) as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(defaults)) {
        const v = raw[k]
        if (v !== undefined && typeof v === typeof (defaults as Record<string, unknown>)[k]) out[k] = v
      }
      return out as Partial<Stored>
    } catch (err) {
      log('could not read settings.json, using defaults', err)
      return {}
    }
  }

  private save(): void {
    try {
      atomicWrite(this.settingsFile, JSON.stringify(this.data, null, 2))
    } catch (err) {
      log('could not write settings.json', err)
    }
  }

  private async encryptionAvailable(): Promise<boolean> {
    try {
      if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false // no real keyring
      return await safeStorage.isAsyncEncryptionAvailable()
    } catch {
      return false
    }
  }

  private async loadToken(): Promise<string | null> {
    try {
      if (existsSync(this.tokenEnc)) {
        if (await this.encryptionAvailable()) {
          const buf = Buffer.from(readFileSync(this.tokenEnc, 'utf8'), 'base64')
          return (await safeStorage.decryptStringAsync(buf)).result
        }
        log('token.enc present but encryption unavailable')
      }
      if (existsSync(this.tokenPlain)) return readFileSync(this.tokenPlain, 'utf8').trim() || null
    } catch (err) {
      log('could not read token', err)
    }
    return null
  }

  private async saveToken(): Promise<void> {
    try {
      rmSync(this.tokenEnc, { force: true })
      rmSync(this.tokenPlain, { force: true })
      if (!this.token) return
      if (await this.encryptionAvailable()) {
        atomicWrite(this.tokenEnc, (await safeStorage.encryptStringAsync(this.token)).toString('base64'), 0o600)
      } else {
        atomicWrite(this.tokenPlain, this.token, 0o600)
      }
    } catch (err) {
      log('could not write token', err)
    }
  }
}

function stripToken(s: ClientSettings): Stored {
  const { hasToken: _h, ...rest } = s
  return rest
}

function atomicWrite(file: string, content: string, mode?: number): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, content, mode ? { mode } : undefined)
  if (mode) chmodSync(tmp, mode)
  renameSync(tmp, file)
}

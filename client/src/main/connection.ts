// Connection monitor: health polling, pairing, and the AppStatus object broadcast to windows/tray.
import { hostname } from 'node:os'
import type { Health } from '@shared/api'
import type { AppStatus, ConnectionState, RecState } from '@shared/ipc'
import type { ApiClient } from './api-client'
import { log } from './log'
import type { SettingsStore } from './settings-store'
import { classifyError, describeError, normalizeServerUrl, unreachableHint } from './url'

export const POLL_MS = 10_000

export class ConnectionMonitor {
  private connection: ConnectionState = 'connecting'
  private health: Health | null = null
  private hint: string | undefined
  private rec: RecState = { phase: 'idle' }
  private extraHints = new Map<string, string>()
  private authVerified = false
  private timer: ReturnType<typeof setInterval> | null = null
  private inflight: Promise<AppStatus> | null = null
  private gen = 0
  private pairing = false
  private listeners = new Set<(s: AppStatus) => void>()
  private lastJson = ''
  private lastKey = ''

  constructor(
    private readonly api: ApiClient,
    private readonly settings: SettingsStore
  ) {
    api.onUnauthorized = () => {
      this.authVerified = false
      this.apply('unauthorized', this.health, 'The server rejected this device. Pair again with a new code.')
    }
    settings.onChange((cur, prev) => {
      if (!this.pairing && (cur.serverUrl !== prev.serverUrl || cur.hasToken !== prev.hasToken)) {
        this.authVerified = false
        void this.refresh(true)
      }
    })
  }

  start(): void {
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  onStatus(cb: (s: AppStatus) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  getStatus(): AppStatus {
    const s = this.settings.get()
    const status: AppStatus = { connection: this.connection, health: this.health, serverUrl: s.serverUrl, rec: this.rec }
    const hint = this.hint ?? [...this.extraHints.values()].join(' ')
    if (hint) status.hint = hint
    return status
  }

  setRecState(rec: RecState): void {
    this.rec = rec
    this.emit()
  }

  /** Persistent non-connection hints (e.g. "global hold-to-talk unavailable on Wayland"). */
  setExtraHint(key: string, text: string | null): void {
    if (text) this.extraHints.set(key, text)
    else this.extraHints.delete(key)
    this.emit()
  }

  /** Check now. Concurrent callers share one check unless `force` (config changed: start a fresh one, the stale result is dropped). */
  refresh(force = false): Promise<AppStatus> {
    if (this.inflight && !force) return this.inflight
    const p: Promise<AppStatus> = this.check().finally(() => {
      if (this.inflight === p) this.inflight = null
    })
    this.inflight = p
    return p
  }

  async pair(serverUrl: string, codeOrToken: string): Promise<AppStatus> {
    const base = normalizeServerUrl(serverUrl)
    const input = codeOrToken.trim()
    let token: string
    try {
      if (/^\d{6}$/.test(input.replace(/\s+/g, ''))) {
        token = await this.api.pairWithCode(base, input.replace(/\s+/g, ''), `${hostname()} (${process.platform})`)
      } else if (input.length > 6 && /^[\x21-\x7e]+$/.test(input)) {
        token = input
      } else {
        throw new Error('Enter the 6-digit pairing code shown by the server, or paste an access token')
      }
      await this.api.verifyToken(base, token)
    } catch (err) {
      if (classifyError(err) === 'unauthorized' && !/^\d{6}$/.test(input.replace(/\s+/g, ''))) {
        throw new Error('The server rejected that token')
      }
      throw new Error(describeError(err, base))
    }
    this.pairing = true // saving url + token shouldn't trigger two redundant checks
    try {
      this.settings.set({ serverUrl: base })
      await this.settings.setToken(token)
    } finally {
      this.pairing = false
    }
    this.authVerified = true
    return this.refresh(true)
  }

  async unpair(): Promise<void> {
    await this.settings.setToken(null)
    this.authVerified = false
    this.apply('unpaired', this.health, this.unpairedHint())
  }

  // ---- internals ---------------------------------------------------------------------------------
  private async check(): Promise<AppStatus> {
    const gen = ++this.gen
    const s = this.settings.get()
    if (!s.serverUrl.trim()) {
      this.apply('unconfigured', null, 'Enter your server\'s address to get started, e.g. http://192.168.1.50:8790', gen)
      return this.getStatus()
    }
    try {
      const health = await this.api.health()
      if (!s.hasToken) {
        this.apply('unpaired', health, this.unpairedHint(), gen)
      } else if (!this.authVerified) {
        await this.api.verifyToken(s.serverUrl, this.settings.getToken() ?? '')
        if (gen === this.gen) this.authVerified = true
        this.apply('connected', health, degradedHint(health), gen)
      } else {
        this.apply('connected', health, degradedHint(health), gen)
      }
    } catch (err) {
      const kind = classifyError(err)
      if (kind === 'unauthorized') {
        this.apply('unauthorized', this.health, 'The server rejected this device. Pair again with a new code.', gen)
      } else if (kind === 'unreachable' || kind === 'timeout') {
        if (gen === this.gen) this.authVerified = false
        this.apply('unreachable', null, unreachableHint(s.serverUrl), gen)
      } else {
        this.apply('unreachable', null, `${describeError(err, s.serverUrl)} (${s.serverUrl})`, gen)
      }
    }
    return this.getStatus()
  }

  private unpairedHint(): string {
    return 'Not paired yet. On the PC run `wisprram-server pair`, then enter the 6-digit code in Settings.'
  }

  private apply(connection: ConnectionState, health: Health | null, hint: string | undefined, gen = this.gen): void {
    if (gen !== this.gen) return // a newer check superseded this one
    this.connection = connection
    this.health = health
    this.hint = hint
    this.emit()
  }

  private emit(): void {
    const status = this.getStatus()
    const json = JSON.stringify(status)
    if (json === this.lastJson) return
    const key = `${status.connection}|${status.serverUrl}`
    if (key !== this.lastKey) log('connection', status.connection, status.serverUrl, status.hint ?? '')
    this.lastKey = key
    this.lastJson = json
    for (const l of this.listeners) {
      try {
        l(status)
      } catch (err) {
        log('status listener failed', err)
      }
    }
  }
}

function degradedHint(h: Health): string | undefined {
  if (h.status === 'ok') return undefined
  const parts: string[] = []
  if (!h.llm.reachable) parts.push('the text-cleanup model (Ollama) is unreachable — dictation falls back to simple rules')
  if (!h.stt.loaded) parts.push('the speech model is still loading')
  return parts.length ? `Server is up but degraded: ${parts.join('; ')}.` : 'Server is up but degraded.'
}

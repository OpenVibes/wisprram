// HTTP client for the WisprRam server. Runs in the main process only (Node fetch). No Electron imports.
import type {
  CommandOptions,
  CommandResult,
  DictateOptions,
  DictationResult,
  DictionaryEntry,
  DictionaryInput,
  Health,
  HistoryItem,
  HistoryPage,
  HistoryQuery,
  PairResponse,
  ServerSettings,
  Snippet,
  SnippetInput,
  Stats
} from '@shared/api'
import { ApiError, mapHttpError } from './url'

export const JSON_TIMEOUT_MS = 10_000
export const HEALTH_TIMEOUT_MS = 6_000
export const UPLOAD_TIMEOUT_MS = 60_000
export const DOWNLOAD_TIMEOUT_MS = 60_000

export interface ApiConfig {
  baseUrl: string
  token: string | null
}

interface ReqOpts {
  json?: unknown
  form?: FormData
  query?: Record<string, string | number | undefined>
  timeoutMs?: number
  signal?: AbortSignal
  auth?: boolean
  /** override config (pairing verification before anything is saved) */
  config?: ApiConfig
}

export class ApiClient {
  /** Called whenever the server answers 401 to an authenticated request. */
  onUnauthorized?: () => void

  constructor(
    private readonly getConfig: () => ApiConfig,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)
  ) {}

  async request<T>(method: string, path: string, o: ReqOpts = {}): Promise<T> {
    const cfg = o.config ?? this.getConfig()
    if (!cfg.baseUrl) throw new Error('No server configured — enter the server address in Settings')
    const auth = o.auth !== false
    if (auth && !cfg.token) throw new ApiError('This device is not paired yet', 401, 'unauthorized')
    const { url, init } = this.prepare(method, path, o, cfg, auth, 'application/json')
    const res = await this.fetchImpl(url, init)
    const text = await res.text()
    if (!res.ok) {
      const err = mapHttpError(res.status, text)
      if (res.status === 401 && auth) this.onUnauthorized?.()
      throw err
    }
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new ApiError('Unexpected response from the server', res.status, 'bad_response')
    }
  }

  /** Authenticated GET of a binary body (recordings). Errors map exactly like request(). */
  async download(path: string, o: Pick<ReqOpts, 'timeoutMs' | 'signal'> = {}): Promise<{ data: ArrayBuffer; mimeType: string }> {
    const cfg = this.getConfig()
    if (!cfg.baseUrl) throw new Error('No server configured — enter the server address in Settings')
    if (!cfg.token) throw new ApiError('This device is not paired yet', 401, 'unauthorized')
    const { url, init } = this.prepare('GET', path, { timeoutMs: DOWNLOAD_TIMEOUT_MS, ...o }, cfg, true, '*/*')
    const res = await this.fetchImpl(url, init)
    if (!res.ok) {
      const err = mapHttpError(res.status, await res.text())
      if (res.status === 401) this.onUnauthorized?.()
      throw err
    }
    const data = await res.arrayBuffer()
    const mimeType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim() || 'application/octet-stream'
    return { data, mimeType }
  }

  private prepare(method: string, path: string, o: ReqOpts, cfg: ApiConfig, auth: boolean, accept: string): { url: URL; init: RequestInit } {
    const url = new URL(path, cfg.baseUrl)
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    const headers: Record<string, string> = { Accept: accept }
    if (auth && cfg.token) headers['Authorization'] = `Bearer ${cfg.token}`
    let body: FormData | string | undefined
    if (o.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(o.json)
    } else if (o.form) {
      body = o.form
    }
    const timeout = AbortSignal.timeout(o.timeoutMs ?? JSON_TIMEOUT_MS)
    const signal = o.signal ? AbortSignal.any([timeout, o.signal]) : timeout
    return { url, init: { method, headers, ...(body !== undefined ? { body } : {}), signal } }
  }

  // ---- unauthenticated ---------------------------------------------------------------------------
  health(baseUrl?: string): Promise<Health> {
    const config = baseUrl ? { baseUrl, token: null } : undefined
    return this.request<Health>('GET', '/health', { auth: false, timeoutMs: HEALTH_TIMEOUT_MS, ...(config ? { config } : {}) })
  }

  async pairWithCode(baseUrl: string, code: string, clientName: string): Promise<string> {
    const r = await this.request<PairResponse>('POST', '/v1/pair', {
      auth: false,
      json: { code, client_name: clientName },
      config: { baseUrl, token: null }
    })
    if (!r || typeof r.token !== 'string' || !r.token) throw new ApiError('Server did not return a token', 200, 'bad_response')
    return r.token
  }

  /** Cheap authenticated call used to validate a token. */
  verifyToken(baseUrl: string, token: string): Promise<Stats> {
    return this.request<Stats>('GET', '/v1/stats', { config: { baseUrl, token } })
  }

  // ---- dictation ---------------------------------------------------------------------------------
  dictate(audio: Blob, options: DictateOptions, signal?: AbortSignal): Promise<DictationResult> {
    return this.request('POST', '/v1/dictate', { form: audioForm(audio, options), timeoutMs: UPLOAD_TIMEOUT_MS, ...(signal ? { signal } : {}) })
  }

  command(audio: Blob, options: CommandOptions, signal?: AbortSignal): Promise<CommandResult> {
    return this.request('POST', '/v1/command', { form: audioForm(audio, options), timeoutMs: UPLOAD_TIMEOUT_MS, ...(signal ? { signal } : {}) })
  }

  // ---- data routes -------------------------------------------------------------------------------
  historyList(q: HistoryQuery = {}): Promise<HistoryPage> {
    return this.request('GET', '/v1/history', { query: { limit: q.limit ?? 50, offset: q.offset ?? 0, q: q.q } })
  }
  historyGet(id: string): Promise<HistoryItem> {
    return this.request('GET', `/v1/history/${encodeURIComponent(id)}`)
  }
  /** The recording the server kept for a history item (rejects with code `no_audio` / 404 when none). */
  historyAudio(id: string): Promise<{ data: ArrayBuffer; mimeType: string }> {
    return this.download(`/v1/history/${encodeURIComponent(id)}/audio`)
  }
  async historyRemove(id: string): Promise<void> {
    await this.request('DELETE', `/v1/history/${encodeURIComponent(id)}`)
  }
  async historyClear(): Promise<void> {
    await this.request('DELETE', '/v1/history')
  }

  dictionaryList(): Promise<DictionaryEntry[]> {
    return this.request('GET', '/v1/dictionary')
  }
  dictionaryAdd(e: DictionaryInput): Promise<DictionaryEntry> {
    return this.request('POST', '/v1/dictionary', { json: { term: e.term, sounds_like: e.sounds_like ?? [] } })
  }
  dictionaryUpdate(id: string, e: DictionaryInput): Promise<DictionaryEntry> {
    return this.request('PUT', `/v1/dictionary/${encodeURIComponent(id)}`, { json: { term: e.term, sounds_like: e.sounds_like ?? [] } })
  }
  async dictionaryRemove(id: string): Promise<void> {
    await this.request('DELETE', `/v1/dictionary/${encodeURIComponent(id)}`)
  }

  snippetsList(): Promise<Snippet[]> {
    return this.request('GET', '/v1/snippets')
  }
  snippetsAdd(s: SnippetInput): Promise<Snippet> {
    return this.request('POST', '/v1/snippets', { json: s })
  }
  snippetsUpdate(id: string, s: SnippetInput): Promise<Snippet> {
    return this.request('PUT', `/v1/snippets/${encodeURIComponent(id)}`, { json: s })
  }
  async snippetsRemove(id: string): Promise<void> {
    await this.request('DELETE', `/v1/snippets/${encodeURIComponent(id)}`)
  }

  serverSettingsGet(): Promise<ServerSettings> {
    return this.request('GET', '/v1/settings')
  }
  serverSettingsSet(patch: Partial<ServerSettings>): Promise<ServerSettings> {
    return this.request('PUT', '/v1/settings', { json: patch })
  }

  statsGet(): Promise<Stats> {
    return this.request('GET', '/v1/stats')
  }
}

function audioForm(audio: Blob, options: unknown): FormData {
  const form = new FormData()
  form.append('audio', audio, 'audio.webm')
  form.append('options', JSON.stringify(options))
  return form
}

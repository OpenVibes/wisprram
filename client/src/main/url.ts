// Pure helpers: server URL normalization, API error mapping, connection hints. No Electron imports.
import { DEFAULT_SERVER_PORT } from '../shared/api'

/**
 * Normalize user input like "10.0.0.5", "pc.local:8790", "http://host/" into "http://host:8790".
 * Adds http:// when no scheme is present and the default port (8790) when none is given
 * (for http, or when the scheme was omitted). Throws a human-readable Error for garbage input.
 */
export function normalizeServerUrl(input: string): string {
  let raw = (input ?? '').trim()
  if (!raw) throw new Error('Enter the server address, e.g. 192.168.1.20:8790')
  const hadScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
  if (!hadScheme) raw = `http://${raw}`
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error(`"${input.trim()}" is not a valid server address`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Server address must start with http:// or https://')
  if (!u.hostname) throw new Error(`"${input.trim()}" is not a valid server address`)
  const authority = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0] ?? ''
  const hostPart = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority
  const explicitPort = /:\d+$/.test(hostPart)
  if (!explicitPort && u.protocol === 'http:') u.port = String(DEFAULT_SERVER_PORT)
  return u.origin
}

/** "10.0.0.5:8790" for display */
export function hostPort(serverUrl: string): string {
  try {
    const u = new URL(serverUrl)
    return u.host
  } catch {
    return serverUrl
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** Convert an HTTP error body ({"error":{code,message}} or FastAPI {"detail":…}) to an ApiError. */
export function mapHttpError(status: number, bodyText: string): ApiError {
  let code = `http_${status}`
  let message = ''
  try {
    const body = JSON.parse(bodyText) as unknown
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>
      const err = b['error']
      if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>
        if (typeof e['code'] === 'string') code = e['code']
        if (typeof e['message'] === 'string') message = e['message']
      } else if (typeof err === 'string') {
        message = err
      }
      const detail = b['detail']
      if (!message && typeof detail === 'string') message = detail
      if (!message && Array.isArray(detail) && detail.length) {
        const first = detail[0] as Record<string, unknown> | undefined
        if (first && typeof first['msg'] === 'string') message = first['msg']
      }
    }
  } catch {
    /* not JSON */
  }
  if (status === 401) {
    return new ApiError(message || 'Not authorized — pair this device again', 401, code === 'http_401' ? 'unauthorized' : code)
  }
  if (!message) {
    if (status === 413) message = 'Recording is too large for the server'
    else if (status === 429) message = 'Server is busy — try again'
    else if (status >= 500) message = `Server error (HTTP ${status})`
    else message = `Request failed (HTTP ${status})`
  }
  return new ApiError(message, status, code)
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET'
])

export type FailureKind = 'unauthorized' | 'unreachable' | 'timeout' | 'server' | 'other'

export function classifyError(err: unknown): FailureKind {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'unauthorized'
    return 'server'
  }
  if (err && typeof err === 'object') {
    const e = err as { name?: string; code?: string; cause?: { code?: string } }
    if (e.name === 'TimeoutError') return 'timeout'
    if (e.name === 'AbortError') return 'timeout'
    const code = e.cause?.code ?? e.code
    if (code && NETWORK_CODES.has(code)) return 'unreachable'
    if (err instanceof TypeError && /fetch failed|network/i.test(err.message)) return 'unreachable'
  }
  return 'other'
}

/** Full human message for UI (Settings, toasts). */
export function describeError(err: unknown, serverUrl?: string): string {
  switch (classifyError(err)) {
    case 'unreachable':
      return serverUrl ? `Can't reach the server at ${hostPort(serverUrl)}` : "Can't reach the server"
    case 'timeout':
      return 'The server took too long to respond'
    default:
      return err instanceof Error && err.message ? err.message : 'Something went wrong'
  }
}

/** Short message for the 280 px overlay pill. */
export function pillMessage(err: unknown): string {
  switch (classifyError(err)) {
    case 'unreachable':
      return "Can't reach server"
    case 'timeout':
      return 'Server timed out'
    case 'unauthorized':
      return 'Not paired — open Settings'
    default: {
      const m = err instanceof Error && err.message ? err.message : 'Something went wrong'
      return m.length > 60 ? `${m.slice(0, 57)}…` : m
    }
  }
}

export function unreachableHint(serverUrl: string): string {
  const u = hostPort(serverUrl)
  let port = String(DEFAULT_SERVER_PORT)
  try {
    port = new URL(serverUrl).port || port
  } catch {
    /* keep default */
  }
  return `Can't reach ${u} — is the PC on, and is port ${port} allowed in its firewall?`
}

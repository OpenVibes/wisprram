import { describe, expect, it } from 'vitest'
import { ApiError, classifyError, describeError, hostPort, mapHttpError, normalizeServerUrl, pillMessage, unreachableHint } from './url'

describe('normalizeServerUrl', () => {
  it.each([
    ['192.168.1.50', 'http://192.168.1.50:8790'],
    ['192.168.1.50:8790', 'http://192.168.1.50:8790'],
    ['  http://pc.local  ', 'http://pc.local:8790'],
    ['http://pc.local:9000/', 'http://pc.local:9000'],
    ['http://pc.local/some/path?x=1', 'http://pc.local:8790'],
    ['pc.local:1234', 'http://pc.local:1234'],
    ['HTTPS://Example.com', 'https://example.com'],
    ['https://example.com:8443', 'https://example.com:8443'],
    ['[::1]', 'http://[::1]:8790'],
    ['localhost', 'http://localhost:8790'],
    ['http://127.0.0.1:80', 'http://127.0.0.1']
  ])('%s → %s', (input, out) => {
    expect(normalizeServerUrl(input)).toBe(out)
  })

  it.each(['', '   ', 'ftp://host', 'http://', 'http://exa mple.com'])('rejects %j', (input) => {
    expect(() => normalizeServerUrl(input)).toThrow()
  })
})

describe('mapHttpError', () => {
  it('uses {"error":{code,message}}', () => {
    const e = mapHttpError(400, '{"error":{"code":"empty_audio","message":"No audio received"}}')
    expect(e).toBeInstanceOf(ApiError)
    expect(e.message).toBe('No audio received')
    expect(e.code).toBe('empty_audio')
    expect(e.status).toBe(400)
  })
  it('keeps server message on 401 and normalizes the code', () => {
    const e = mapHttpError(401, '{"detail":"Not authenticated"}')
    expect(e.code).toBe('unauthorized')
    expect(e.message).toBe('Not authenticated')
  })
  it('bad_code stays bad_code', () => {
    expect(mapHttpError(401, '{"error":{"code":"bad_code","message":"Invalid or expired pairing code"}}').code).toBe('bad_code')
  })
  it('handles FastAPI validation detail arrays', () => {
    expect(mapHttpError(422, '{"detail":[{"msg":"field required"}]}').message).toBe('field required')
  })
  it('falls back for non-JSON bodies', () => {
    expect(mapHttpError(502, '<html>bad gateway</html>').message).toBe('Server error (HTTP 502)')
    expect(mapHttpError(404, '').message).toBe('Request failed (HTTP 404)')
    expect(mapHttpError(401, '').message).toMatch(/pair/i)
  })
})

describe('classifyError / messages', () => {
  const fetchFailed = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } })
  it('classifies network failures', () => {
    expect(classifyError(fetchFailed('ECONNREFUSED'))).toBe('unreachable')
    expect(classifyError(fetchFailed('EHOSTUNREACH'))).toBe('unreachable')
    expect(classifyError(new TypeError('fetch failed'))).toBe('unreachable')
  })
  it('classifies timeouts', () => {
    expect(classifyError(new DOMException('timed out', 'TimeoutError'))).toBe('timeout')
    expect(classifyError(new DOMException('aborted', 'AbortError'))).toBe('timeout')
  })
  it('classifies api errors', () => {
    expect(classifyError(new ApiError('x', 401, 'unauthorized'))).toBe('unauthorized')
    expect(classifyError(new ApiError('x', 500, 'boom'))).toBe('server')
    expect(classifyError(new Error('?'))).toBe('other')
  })
  it('describeError / pillMessage', () => {
    expect(describeError(fetchFailed('ECONNREFUSED'), 'http://10.0.0.5:8790')).toBe("Can't reach the server at 10.0.0.5:8790")
    expect(pillMessage(fetchFailed('ECONNREFUSED'))).toBe("Can't reach server")
    expect(pillMessage(new ApiError('Not authorized', 401, 'unauthorized'))).toMatch(/Not paired/)
    expect(pillMessage(new Error('x'.repeat(100))).length).toBeLessThanOrEqual(60)
  })
  it('unreachableHint mentions host and port', () => {
    expect(unreachableHint('http://192.168.1.50:8790')).toBe("Can't reach 192.168.1.50:8790 — is the PC on, and is port 8790 allowed in its firewall?")
    expect(hostPort('http://a:1')).toBe('a:1')
  })
})

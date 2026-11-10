#!/usr/bin/env node
// Mock WisprRam backend for developing the client without the PC. Plain Node, no dependencies.
//   node dev/mock-server.mjs            # listens on 0.0.0.0:8791 (override with PORT / HOST)
// Pairing code: 123456 (also prints the issued token). Any token it has issued is accepted; so is MOCK_TOKEN
// (default "mock-token-for-dev-only").
// v0.2 extras: server-side audio retention (PUT /v1/settings {"save_audio": true} → history items get has_audio and
// GET /v1/history/{id}/audio serves a tiny WAV), GET /v1/history/{id}, and a test hook:
//   POST /_mock/fail-next[?n=1]   → the next n dictate/command calls answer HTTP 500 (no auth needed)
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'

const PORT = Number(process.env.PORT || 8791)
const HOST = process.env.HOST || '127.0.0.1'
const PAIR_CODE = '123456'
const FIXED_TOKEN = process.env.MOCK_TOKEN || 'mock-token-for-dev-only'
const DICTATE_TEXT = 'This is a test dictation from the mock server.'
const tokens = new Set([FIXED_TOKEN])
let failNext = 0

/** ~0.1 s of 16 kHz mono 16-bit silence: a valid, playable WAV. */
function tinyWav() {
  const samples = 1600
  const data = Buffer.alloc(samples * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(16000, 24)
  h.writeUInt32LE(32000, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}
const WAV = tinyWav()

const state = {
  history: [],
  dictionary: [],
  snippets: [{ id: 'sn-1', trigger: 'my email', expansion: 'me@example.com' }],
  settings: {
    stt_model: 'large-v3-turbo',
    llm_model: 'qwen2.5:3b',
    default_cleanup: 'full',
    default_style: 'casual',
    language: 'auto',
    styles_by_app: {},
    keep_history_days: 90,
    save_audio: false,
    audio_dir: ''
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0)

function send(res, status, body) {
  const json = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) })
  res.end(json)
}
const err = (res, status, code, message) => send(res, status, { error: { code, message } })

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** Extract the `options` JSON field from a multipart body (good enough for the mock). */
function multipartOptions(buf) {
  const m = /name="options"\r\n\r\n([\s\S]*?)\r\n--/.exec(buf.toString('latin1'))
  try {
    return m ? JSON.parse(Buffer.from(m[1], 'latin1').toString('utf8')) : {}
  } catch {
    return {}
  }
}

function addHistory(kind, raw_text, text, app, audio_ms, extraMeta = {}) {
  const keep = !!state.settings.save_audio
  const item = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    kind,
    raw_text,
    text,
    app_name: app?.name ?? null,
    audio_ms,
    word_count: words(text),
    has_audio: keep,
    ...(keep ? { audio_mime: 'audio/wav' } : {}),
    meta: {
      stt_model: state.settings.stt_model,
      llm_model: state.settings.llm_model,
      cleanup: state.settings.default_cleanup,
      style: state.settings.default_style,
      language: 'en',
      timings: { decode_ms: 5, stt_ms: 220, llm_ms: 150, total_ms: 400 },
      cleanup_used: 'llm',
      applied_snippets: [],
      ...extraMeta
    }
  }
  state.history.unshift(item)
  return item
}

function stats() {
  const total = state.history.reduce((n, h) => n + h.word_count, 0)
  return { words_total: total, words_7d: total, sessions_total: state.history.length, avg_wpm: 140, streak_days: state.history.length ? 1 : 0, minutes_saved: +(total / 40).toFixed(1) }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const path = url.pathname
  const m = req.method
  console.log(`${new Date().toISOString().slice(11, 19)} ${m} ${path}${url.search}`)
  try {
    if (m === 'GET' && path === '/health') {
      return send(res, 200, {
        status: 'ok',
        version: '0.0.0-mock',
        stt: { model: 'large-v3-turbo', device: 'cuda', loaded: true },
        llm: { provider: 'ollama', model: 'qwen2.5:3b', reachable: true },
        gpu: { name: 'Mock RTX 4060', mem_used_mb: 4200, mem_total_mb: 8188 }
      })
    }
    if (m === 'POST' && path === '/v1/pair') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      if (body.code !== PAIR_CODE) return err(res, 401, 'bad_code', 'Invalid or expired pairing code')
      const token = randomBytes(24).toString('hex')
      tokens.add(token)
      console.log(`  paired "${body.client_name}" → token ${token.slice(0, 8)}…`)
      return send(res, 200, { token })
    }
    if (m === 'POST' && path === '/_mock/fail-next') {
      failNext = Number(url.searchParams.get('n') || 1)
      return send(res, 200, { fail_next: failNext })
    }
    if (!path.startsWith('/v1/')) return err(res, 404, 'not_found', 'Not found')

    const auth = /^Bearer (.+)$/.exec(req.headers.authorization || '')
    if (!auth || !tokens.has(auth[1])) return err(res, 401, 'unauthorized', 'Missing or invalid token')

    if (m === 'POST' && (path === '/v1/dictate' || path === '/v1/command')) {
      const buf = await readBody(req)
      const opts = multipartOptions(buf)
      await sleep(400)
      if (failNext > 0) {
        failNext--
        return err(res, 500, 'internal', 'Mock failure (fail-next)')
      }
      if (buf.length < 100) return err(res, 400, 'empty_audio', 'No audio received')
      const timings = { decode_ms: 5, stt_ms: 220, llm_ms: 150, total_ms: 400 }
      if (path === '/v1/dictate') {
        const cleanup = opts.cleanup || state.settings.default_cleanup
        const style = opts.style || state.settings.default_style
        const item = addHistory('dictation', DICTATE_TEXT.toLowerCase().replace(/[.]/g, ''), DICTATE_TEXT, opts.app, 2500, { cleanup, style, cleanup_used: cleanup === 'none' ? 'none' : 'llm' })
        return send(res, 200, {
          id: item.id, raw_text: item.raw_text, text: DICTATE_TEXT, language: 'en', audio_ms: 2500, word_count: item.word_count, timings,
          applied_snippets: [], cleanup_used: cleanup === 'none' ? 'none' : 'llm',
          stt_model: state.settings.stt_model, llm_model: state.settings.llm_model, cleanup, style, has_audio: item.has_audio
        })
      }
      const out = `${String(opts.selected_text || '').toUpperCase()} (rewritten by mock)`
      const item = addHistory('command', 'make it loud', out, opts.app, 1800, { instruction: 'make it loud', selected_text: String(opts.selected_text || '') })
      return send(res, 200, {
        id: item.id, instruction: 'make it loud', text: out, timings,
        stt_model: state.settings.stt_model, llm_model: state.settings.llm_model, has_audio: item.has_audio
      })
    }

    if (path === '/v1/history') {
      if (m === 'GET') {
        const q = (url.searchParams.get('q') || '').toLowerCase()
        const limit = Number(url.searchParams.get('limit') || 50)
        const offset = Number(url.searchParams.get('offset') || 0)
        const all = q ? state.history.filter((h) => h.text.toLowerCase().includes(q) || h.raw_text.toLowerCase().includes(q)) : state.history
        return send(res, 200, { items: all.slice(offset, offset + limit), total: all.length })
      }
      if (m === 'DELETE') {
        state.history = []
        return send(res, 200, { ok: true })
      }
    }
    let mm = /^\/v1\/history\/([^/]+)\/audio$/.exec(path)
    if (mm && m === 'GET') {
      const item = state.history.find((h) => h.id === mm[1])
      if (!item) return err(res, 404, 'not_found', 'No such history item')
      if (!item.has_audio) return err(res, 404, 'no_audio', 'No recording was kept for this item')
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': WAV.length })
      return res.end(WAV)
    }
    mm = /^\/v1\/history\/([^/]+)$/.exec(path)
    if (mm && m === 'GET') {
      const item = state.history.find((h) => h.id === mm[1])
      return item ? send(res, 200, item) : err(res, 404, 'not_found', 'No such history item')
    }
    if (mm && m === 'DELETE') {
      state.history = state.history.filter((h) => h.id !== mm[1])
      return send(res, 200, { ok: true })
    }

    for (const [name, list, fields] of [
      ['dictionary', 'dictionary', (b) => ({ term: String(b.term || ''), sounds_like: b.sounds_like || [] })],
      ['snippets', 'snippets', (b) => ({ trigger: String(b.trigger || ''), expansion: String(b.expansion || '') })]
    ]) {
      if (path === `/v1/${name}`) {
        if (m === 'GET') return send(res, 200, state[list])
        if (m === 'POST') {
          const entry = { id: randomUUID(), ...fields(JSON.parse((await readBody(req)).toString('utf8') || '{}')) }
          state[list].push(entry)
          return send(res, 200, entry)
        }
      }
      mm = new RegExp(`^/v1/${name}/([^/]+)$`).exec(path)
      if (mm) {
        const i = state[list].findIndex((e) => e.id === mm[1])
        if (i < 0) return err(res, 404, 'not_found', 'No such entry')
        if (m === 'PUT') {
          state[list][i] = { id: mm[1], ...fields(JSON.parse((await readBody(req)).toString('utf8') || '{}')) }
          return send(res, 200, state[list][i])
        }
        if (m === 'DELETE') {
          state[list].splice(i, 1)
          return send(res, 200, { ok: true })
        }
      }
    }

    if (path === '/v1/settings') {
      if (m === 'GET') return send(res, 200, state.settings)
      if (m === 'PUT') {
        Object.assign(state.settings, JSON.parse((await readBody(req)).toString('utf8') || '{}'))
        return send(res, 200, state.settings)
      }
    }
    if (path === '/v1/stats' && m === 'GET') return send(res, 200, stats())

    return err(res, 404, 'not_found', `No route for ${m} ${path}`)
  } catch (e) {
    console.error(e)
    return err(res, 500, 'internal', String(e?.message || e))
  }
})

server.listen(PORT, HOST, () => {
  console.log(`WisprRam mock server on http://${HOST}:${PORT}  (pair code ${PAIR_CODE}, static token ${FIXED_TOKEN})`)
})

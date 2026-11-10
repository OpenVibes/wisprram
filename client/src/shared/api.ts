// Backend wire types — see docs/API.md for the full HTTP API. FROZEN: only add optional fields.
// The wire format is snake_case and is used as-is on the client (no case conversion).

export type CleanupLevel = 'none' | 'light' | 'full'
export type Style = 'formal' | 'casual' | 'very_casual'
export type Language = 'auto' | string // ISO 639-1 code, e.g. "en", "hi"

export interface ApiError {
  error: { code: string; message: string }
}

export interface Health {
  status: 'ok' | 'degraded'
  version: string
  stt: { model: string; device: 'cuda' | 'cpu'; loaded: boolean }
  llm: { provider: 'ollama'; model: string; reachable: boolean }
  gpu: { name: string; mem_used_mb: number; mem_total_mb: number } | null
}

export interface PairRequest {
  code: string
  client_name: string
}
export interface PairResponse {
  token: string
}

export interface AppContext {
  name: string
  bundle_id?: string
  window_title?: string
}

export interface DictateOptions {
  language?: Language
  cleanup?: CleanupLevel
  style?: Style
  app?: AppContext
}

export interface Timings {
  decode_ms?: number
  stt_ms: number
  llm_ms: number
  total_ms: number
}

export interface DictationResult {
  id: string
  raw_text: string
  text: string
  language: string
  audio_ms: number
  word_count: number
  timings: Timings
  applied_snippets: string[]
  cleanup_used: 'llm' | 'rules' | 'none'
  // v0.2 (optional): what the server actually applied, for archives/metadata
  stt_model?: string
  llm_model?: string
  cleanup?: CleanupLevel
  style?: Style
  /** true when the server kept the audio (ServerSettings.save_audio) */
  has_audio?: boolean
}

export interface CommandOptions {
  selected_text: string
  app?: AppContext
}

export interface CommandResult {
  id: string
  instruction: string
  text: string
  timings: Timings
  // v0.2 (optional)
  stt_model?: string
  llm_model?: string
  has_audio?: boolean
}

export interface HistoryItem {
  id: string
  created_at: string // ISO 8601
  kind: 'dictation' | 'command'
  raw_text: string
  text: string
  app_name: string | null
  audio_ms: number
  word_count: number
  // v0.2 (optional)
  /** server kept the recording; fetch it with GET /v1/history/{id}/audio */
  has_audio?: boolean
  audio_mime?: string
  /** full processing metadata (models, cleanup level, style, language, timings, cleanup_used,
   *  applied_snippets; for commands also selected_text) */
  meta?: Record<string, unknown>
}

export interface HistoryPage {
  items: HistoryItem[]
  total: number
}

export interface HistoryQuery {
  limit?: number
  offset?: number
  q?: string
}

export interface DictionaryEntry {
  id: string
  term: string
  sounds_like: string[]
}
export type DictionaryInput = Omit<DictionaryEntry, 'id' | 'sounds_like'> & { sounds_like?: string[] }

export interface Snippet {
  id: string
  trigger: string
  expansion: string
}
export type SnippetInput = Omit<Snippet, 'id'>

export interface ServerSettings {
  stt_model: string
  llm_model: string
  default_cleanup: CleanupLevel
  default_style: Style
  language: Language
  styles_by_app: Record<string, Style>
  keep_history_days: number
  // v0.2 (optional): server-side audio retention
  /** keep each recording on the server next to its history item (default false) */
  save_audio?: boolean
  /** absolute folder ON THE SERVER where kept audio is written; "" = <data_dir>/audio */
  audio_dir?: string
}

export interface Stats {
  words_total: number
  words_7d: number
  sessions_total: number
  avg_wpm: number
  streak_days: number
  minutes_saved: number
}

export const DEFAULT_SERVER_PORT = 8790

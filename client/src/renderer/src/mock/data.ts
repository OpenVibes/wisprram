// Realistic sample data for the mock bridge.
import type { DictionaryEntry, Health, HistoryItem, ServerSettings, Snippet, Stats } from '../../../shared/api'

export const MOCK_HEALTH: Health = {
  status: 'ok',
  version: '0.1.0',
  stt: { model: 'large-v3-turbo', device: 'cuda', loaded: true },
  llm: { provider: 'ollama', model: 'qwen2.5:3b', reachable: true },
  gpu: { name: 'NVIDIA GeForce RTX 4060 Laptop GPU', mem_used_mb: 4120, mem_total_mb: 8188 }
}

export const MOCK_SERVER_SETTINGS: ServerSettings = {
  stt_model: 'large-v3-turbo',
  llm_model: 'qwen2.5:3b',
  default_cleanup: 'full',
  default_style: 'casual',
  language: 'auto',
  styles_by_app: { Slack: 'very_casual', Mail: 'formal', Notes: 'casual' },
  keep_history_days: 90,
  save_audio: true,
  audio_dir: ''
}

export const MOCK_SERVER_URL = 'http://192.168.1.50:8790'
export const MOCK_ARCHIVE_DEFAULT = '/Users/you/Documents/WisprRam'
export const MOCK_ARCHIVE_PICKED = '/Users/you/Documents/Voice notes'

export const MOCK_STATS: Stats = {
  words_total: 48_212,
  words_7d: 6_840,
  sessions_total: 1_204,
  avg_wpm: 142,
  streak_days: 12,
  minutes_saved: 386
}

export const MOCK_DICTIONARY: DictionaryEntry[] = [
  { id: 'd1', term: 'WisprRam', sounds_like: ['whisper ram', 'wispr ram'] },
  { id: 'd2', term: 'Siobhan', sounds_like: ['shivawn', 'shuh vawn'] },
  { id: 'd3', term: 'Ollama', sounds_like: ['oh llama', 'o lama'] },
  { id: 'd4', term: 'Kubernetes', sounds_like: ['cuber netties', 'kuber nettis'] },
  { id: 'd5', term: 'PostgreSQL', sounds_like: ['post gress', 'postgres q l'] }
]

export const MOCK_SNIPPETS: Snippet[] = [
  { id: 's1', trigger: 'my email', expansion: 'you@example.com' },
  { id: 's2', trigger: 'my address', expansion: '123 Main Street\nSpringfield, IL 62701\nUSA' },
  {
    id: 's3',
    trigger: 'meeting reply',
    expansion: 'Thanks for the invite. That time works for me, see you then.\n\nBest,\nAlex'
  }
]

const SAMPLES: Array<{ raw: string; text: string; app: string | null; kind?: 'command' }> = [
  {
    raw: 'um so I think we should like move the standup to ten thirty because uh half the team is in a different time zone',
    text: 'I think we should move the standup to 10:30 because half the team is in a different time zone.',
    app: 'Slack'
  },
  {
    raw: 'hey can you send me the latest build at 4 no actually 5 pm',
    text: 'Hey, can you send me the latest build at 5 PM?',
    app: 'Messages'
  },
  {
    raw: 'dear team comma new paragraph thanks for the quick turnaround on the release period',
    text: 'Dear team,\n\nThanks for the quick turnaround on the release.',
    app: 'Mail'
  },
  {
    raw: 'remember to buy milk eggs bread and coffee',
    text: 'Remember to buy:\n- Milk\n- Eggs\n- Bread\n- Coffee',
    app: 'Notes'
  },
  {
    raw: 'make this more polite',
    text: 'Would you mind sending over the report when you get a chance? Thank you!',
    app: 'Mail',
    kind: 'command'
  },
  {
    raw: 'the whisper ram server is running on the rtx four zero six zero and latency looks great',
    text: 'The WisprRam server is running on the RTX 4060, and latency looks great.',
    app: 'Visual Studio Code'
  },
  {
    raw: 'i was thinking we could try the new kuber nettis cluster for the staging deploy',
    text: 'I was thinking we could try the new Kubernetes cluster for the staging deploy.',
    app: 'Slack'
  },
  {
    raw: 'quick note the invoice is due on the fifteenth so please approve it before friday',
    text: 'Quick note: the invoice is due on the 15th, so please approve it before Friday.',
    app: 'Notion'
  },
  {
    raw: 'translate to hindi',
    text: 'कृपया मुझे बैठक का समय बता दें।',
    app: 'Notes',
    kind: 'command'
  },
  {
    raw: 'thanks a lot that works for me see you tomorrow',
    text: 'Thanks a lot, that works for me. See you tomorrow!',
    app: 'Messages'
  }
]

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

function makeMeta(s: { raw: string; text: string; app: string | null; kind?: 'command' }, audioMs: number, i: number): Record<string, unknown> {
  const stt = 180 + ((i * 53) % 140)
  const llm = s.kind === 'command' ? 520 + ((i * 31) % 200) : 260 + ((i * 47) % 260)
  const meta: Record<string, unknown> = {
    stt_model: 'large-v3-turbo',
    llm_model: 'qwen2.5:3b',
    cleanup: 'full',
    style: s.app === 'Slack' ? 'very_casual' : s.app === 'Mail' ? 'formal' : 'casual',
    language: s.text.charCodeAt(0) > 0x900 ? 'hi' : 'en',
    cleanup_used: 'llm',
    applied_snippets: [],
    timings: { decode_ms: 12, stt_ms: stt, llm_ms: llm, total_ms: stt + llm + 14 },
    audio_ms: audioMs
  }
  if (s.kind === 'command') meta.selected_text = 'Send me the report when you can.'
  return meta
}

/** ~40 items spread over ~10 days, newest first. `now` is injectable for tests. */
export function makeMockHistory(now: number = Date.now(), count = 40): HistoryItem[] {
  const items: HistoryItem[] = []
  let t = now - 4 * 60_000
  for (let i = 0; i < count; i++) {
    const s = SAMPLES[i % SAMPLES.length]
    const words = wordCount(s.text)
    const audio_ms = Math.round((words / 2.4) * 1000)
    // the newest items and every third one kept their recording on the server; the oldest have no metadata (pre-0.2)
    const has_audio = i < 3 || i % 3 === 0
    items.push({
      id: `h${count - i}`,
      created_at: new Date(t).toISOString(),
      kind: s.kind ?? 'dictation',
      raw_text: s.raw,
      text: s.text,
      app_name: s.app,
      audio_ms,
      word_count: words,
      has_audio,
      audio_mime: has_audio ? 'audio/wav' : undefined,
      meta: i < count - 8 ? makeMeta(s, audio_ms, i) : undefined
    })
    // bigger gaps early on so several day groups exist
    t -= (i < 4 ? 35 : 95) * 60_000 + ((i * 7919) % 40) * 60_000
  }
  return items
}

export const MOCK_FAKE_RESULTS = [
  'Let me take a look at that and get back to you this afternoon.',
  'The meeting is moved to Thursday at 3 PM.',
  'Please review the pull request when you have a moment.',
  'Great, that sounds like a plan. Let’s sync tomorrow morning.'
]

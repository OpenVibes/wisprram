import type { CleanupLevel, Style } from '../../../shared/api'

export const CLEANUP_OPTIONS: Array<{ value: CleanupLevel; label: string; description: string }> = [
  { value: 'none', label: 'None', description: 'Your words exactly as transcribed. Fastest, no punctuation fixes.' },
  { value: 'light', label: 'Light', description: 'Rule-based: removes fillers like “um”, adds punctuation and capitals, understands “new line”.' },
  { value: 'full', label: 'Full AI', description: 'A language model also fixes self-corrections, formats lists and polishes phrasing. Adds a fraction of a second.' }
]

export const STYLE_OPTIONS: Array<{ value: Style; label: string; example: { before: string; after: string } }> = [
  {
    value: 'formal',
    label: 'Formal',
    example: {
      before: 'hey can u send the report by friday thx',
      after: 'Hello, could you please send the report by Friday? Thank you.'
    }
  },
  {
    value: 'casual',
    label: 'Casual',
    example: {
      before: 'hey can u send the report by friday thx',
      after: 'Hey, can you send the report by Friday? Thanks!'
    }
  },
  {
    value: 'very_casual',
    label: 'Very casual',
    example: {
      before: 'hey can u send the report by friday thx',
      after: 'hey, can u send the report by friday? thx'
    }
  }
]

export const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'ru', label: 'Russian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'tr', label: 'Turkish' }
]

export const styleLabel = (s: Style): string => STYLE_OPTIONS.find((o) => o.value === s)?.label ?? s

import type { RecState } from '../../../shared/ipc'
import type { Cue } from './sounds'

/** Which cue (if any) a rec-state transition should play. */
export function cueForTransition(prev: RecState, next: RecState): Cue | null {
  if (next.phase === 'error' && prev.phase !== 'error') return 'error'
  if (next.phase === 'recording' && prev.phase !== 'recording') return 'start'
  if (prev.phase === 'recording' && (next.phase === 'processing' || next.phase === 'idle' || next.phase === 'done')) return 'stop'
  return null
}

/** Error messages in the pill are short. */
export function pillMessage(s: string, max = 30): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…'
}

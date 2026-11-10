// Date helpers (local time). Pure and unit tested.
export interface DayGroup<T> {
  key: string // YYYY-MM-DD (local)
  label: string
  items: T[]
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function dayLabel(d: Date, now: Date): string {
  const diff = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('en-US', opts)
}

/** Groups items (already sorted newest first) by local calendar day, preserving order. */
export function groupByDay<T extends { created_at: string }>(items: T[], now: Date = new Date()): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  for (const item of items) {
    const d = new Date(item.created_at)
    if (Number.isNaN(d.getTime())) continue
    const key = dayKey(d)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(item)
    else groups.push({ key, label: dayLabel(d, now), items: [item] })
  }
  return groups
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const sec = Math.round((now.getTime() - d.getTime()) / 1000)
  if (Number.isNaN(sec)) return ''
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  if (hr < 24 && dayKey(d) === dayKey(now)) return `${hr} h ago`
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86_400_000))) return `Yesterday, ${formatTime(iso)}`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + formatTime(iso)
}

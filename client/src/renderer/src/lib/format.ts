export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n))
}

/** 83_000 ms → "01:23" */
export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

/** 410 → "410 ms", 1850 → "1.9 s" */
export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : t.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

export function greeting(hour: number): string {
  if (hour < 5) return 'Working late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)} min`
  const h = min / 60
  return `${h.toFixed(h < 10 ? 1 : 0)} h`
}

export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof Error && e.message) return e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  if (typeof e === 'string' && e) return e
  return fallback
}

/** Normalises comma/newline separated variants into a de-duplicated list. */
export function splitVariants(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,\n]/)) {
    const v = part.trim()
    const k = v.toLowerCase()
    if (v && !seen.has(k)) {
      seen.add(k)
      out.push(v)
    }
  }
  return out
}

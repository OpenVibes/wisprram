// Tiny logger: console + capped file in userData (so a packaged app can be debugged).
import { appendFileSync, mkdirSync, statSync, truncateSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

let file: string | null = null

function ensureFile(): string | null {
  if (file) return file
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'main.log')
    try {
      if (statSync(file).size > 1_000_000) truncateSync(file, 0)
    } catch {
      /* new file */
    }
  } catch {
    file = null
  }
  return file
}

function fmt(a: unknown): string {
  if (a instanceof Error) return a.stack ?? a.message
  if (typeof a === 'string') return a
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}

export function log(...args: unknown[]): void {
  const line = `${new Date().toISOString()} ${args.map(fmt).join(' ')}`
  // eslint-disable-next-line no-console
  console.log(`[wisprram] ${line}`)
  const f = app.isReady() ? ensureFile() : null
  if (f) {
    try {
      appendFileSync(f, `${line}\n`)
    } catch {
      /* ignore */
    }
  }
}

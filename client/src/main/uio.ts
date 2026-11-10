// Lazy loader for uiohook-napi: a missing/blocked native module must never crash the app.
import { log } from './log'

type Uio = typeof import('uiohook-napi')
let mod: Uio | null | undefined

export function loadUiohook(): Uio | null {
  if (mod !== undefined) return mod
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('uiohook-napi') as Uio
  } catch (err) {
    log('uiohook-napi failed to load', err)
    mod = null
  }
  return mod
}

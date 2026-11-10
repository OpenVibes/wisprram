// Keycap formatting and accelerator helpers. Pure functions (unit tested).
export type Platform = 'darwin' | 'win32' | 'linux'

const isMac = (p: Platform): boolean => p === 'darwin'

/** Human label for a uiohook key name used as push-to-talk key. */
export function pttKeyLabel(key: string, platform: Platform): string {
  const mac = isMac(platform)
  switch (key) {
    case 'AltRight':
      return mac ? 'Right ⌥' : 'Right Alt'
    case 'AltLeft':
      return mac ? 'Left ⌥' : 'Left Alt'
    case 'CtrlRight':
      return mac ? 'Right ⌃' : 'Right Ctrl'
    case 'CtrlLeft':
      return mac ? 'Left ⌃' : 'Left Ctrl'
    case 'MetaRight':
      return mac ? 'Right ⌘' : platform === 'win32' ? 'Right Win' : 'Right Super'
    case 'MetaLeft':
      return mac ? 'Left ⌘' : platform === 'win32' ? 'Left Win' : 'Left Super'
    case 'ShiftRight':
      return mac ? 'Right ⇧' : 'Right Shift'
    case 'ShiftLeft':
      return mac ? 'Left ⇧' : 'Left Shift'
    default:
      return key
  }
}

/** Longer label for pickers, e.g. "Right Option (⌥)". */
export function pttKeyName(key: string, platform: Platform): string {
  const mac = isMac(platform)
  switch (key) {
    case 'AltRight':
      return mac ? 'Right Option' : 'Right Alt'
    case 'CtrlRight':
      return mac ? 'Right Control' : 'Right Ctrl'
    case 'MetaRight':
      return mac ? 'Right Command' : platform === 'win32' ? 'Right Windows' : 'Right Super'
    case 'ShiftRight':
      return 'Right Shift'
    default:
      return pttKeyLabel(key, platform)
  }
}

export interface PttOption {
  value: string
  label: string
}

export function pttOptions(platform: Platform, current?: string): PttOption[] {
  const base = ['AltRight', 'CtrlRight', 'MetaRight', 'ShiftRight', 'F13', 'F14', 'F15']
  const keys = current && !base.includes(current) ? [...base, current] : base
  return keys.map((value) => ({ value, label: pttKeyName(value, platform) }))
}

const MODIFIERS = new Set(['commandorcontrol', 'cmdorctrl', 'command', 'cmd', 'control', 'ctrl', 'alt', 'option', 'altgr', 'shift', 'super', 'meta'])

/** Splits an Electron accelerator into tokens ("Ctrl+Plus" → ["Ctrl", "Plus"]). */
export function parseAccelerator(accel: string): string[] {
  return accel
    .split('+')
    .map((t) => t.trim())
    .filter(Boolean)
}

function modifierCap(token: string, platform: Platform): string {
  const mac = isMac(platform)
  switch (token.toLowerCase()) {
    case 'commandorcontrol':
    case 'cmdorctrl':
      return mac ? '⌘' : 'Ctrl'
    case 'command':
    case 'cmd':
      return mac ? '⌘' : 'Super'
    case 'control':
    case 'ctrl':
      return mac ? '⌃' : 'Ctrl'
    case 'alt':
    case 'option':
      return mac ? '⌥' : 'Alt'
    case 'altgr':
      return 'AltGr'
    case 'shift':
      return mac ? '⇧' : 'Shift'
    case 'super':
    case 'meta':
      return mac ? '⌘' : platform === 'win32' ? 'Win' : 'Super'
    default:
      return token
  }
}

const KEY_LABELS: Record<string, string> = {
  plus: '+',
  space: 'Space',
  return: 'Enter',
  enter: 'Enter',
  escape: 'Esc',
  esc: 'Esc',
  tab: 'Tab',
  backspace: '⌫',
  delete: 'Del',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→'
}

/** Keycap labels for an accelerator: "CommandOrControl+Shift+Space" → ["⌘","⇧","Space"] on mac. */
export function acceleratorKeycaps(accel: string, platform: Platform): string[] {
  const mods: string[] = []
  const keys: string[] = []
  for (const t of parseAccelerator(accel)) {
    if (MODIFIERS.has(t.toLowerCase())) mods.push(modifierCap(t, platform))
    else keys.push(KEY_LABELS[t.toLowerCase()] ?? (t.length === 1 ? t.toUpperCase() : t))
  }
  return [...mods, ...keys]
}

/** Keycaps for either a PTT key or an accelerator. */
export function pttKeycaps(key: string, platform: Platform): string[] {
  return [pttKeyLabel(key, platform)]
}

export interface KeyEventLike {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const CODE_TO_KEY: Record<string, string> = {
  Space: 'Space',
  Enter: 'Return',
  NumpadEnter: 'Return',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']'
}

/** Converts a keydown event to an Electron accelerator, or null when it is only a modifier / has no valid combo. */
export function eventToAccelerator(e: KeyEventLike, platform: Platform): string | null {
  let main: string | null = null
  if (/^Key[A-Z]$/.test(e.code)) main = e.code.slice(3)
  else if (/^Digit[0-9]$/.test(e.code)) main = e.code.slice(5)
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) main = e.code
  else if (/^Numpad[0-9]$/.test(e.code)) main = 'num' + e.code.slice(6)
  else if (e.code in CODE_TO_KEY) main = CODE_TO_KEY[e.code]
  if (!main) return null

  const mac = isMac(platform)
  const parts: string[] = []
  if (mac ? e.metaKey : e.ctrlKey) parts.push('CommandOrControl')
  if (mac && e.ctrlKey) parts.push('Control')
  if (!mac && e.metaKey) parts.push('Super')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  const isFunctionKey = /^F\d+$/.test(main)
  if (parts.length === 0 && !isFunctionKey) return null // a bare letter would hijack typing
  return [...parts, main].join('+')
}

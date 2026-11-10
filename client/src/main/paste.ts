// Text insertion: clipboard + simulated paste keystroke, and selection capture for command mode.
import { execFile } from 'node:child_process'
import { clipboard, ClipboardItem, systemPreferences } from 'electron'
import type { PasteMethod } from '@shared/settings'
import { waitForModifiersReleased } from './input-state'
import { log } from './log'
import type { InsertOutcome } from './recorder'
import { loadUiohook } from './uio'

const isMac = process.platform === 'darwin'
const isWayland = process.platform === 'linux' && process.env['XDG_SESSION_TYPE'] === 'wayland'

export const MAC_ACCESSIBILITY_HINT = 'Grant Accessibility to paste automatically'
export const COPIED_HINT = 'Copied — press Ctrl+V'
const RESTORE_AFTER_MS = 450

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Electron 45's clipboard API is async and ClipboardItem based (no sync readText/readHTML/readImage).
const SNAPSHOT_TYPES = ['text/plain', 'text/html', 'image/png']
type ClipboardSnapshot = Record<string, Blob>

/** Copy the standard flavors (text, html, image) out of the clipboard so they can be put back later. */
async function snapshot(): Promise<ClipboardSnapshot> {
  const snap: ClipboardSnapshot = {}
  try {
    for (const item of await clipboard.read()) {
      for (const type of item.types) {
        if (!SNAPSHOT_TYPES.includes(type) || snap[type]) continue
        const blob = (await item.getType(type)) as Blob
        // materialize now: the item is a lazy view onto the live clipboard
        snap[type] = new Blob([await blob.arrayBuffer()], { type })
      }
    }
  } catch (err) {
    log('clipboard snapshot failed', err)
  }
  return snap
}

async function restore(snap: ClipboardSnapshot): Promise<void> {
  try {
    if (Object.keys(snap).length === 0) clipboard.clear()
    else await clipboard.write([new ClipboardItem(snap)])
  } catch (err) {
    log('clipboard restore failed', err)
  }
}

async function readText(): Promise<string> {
  try {
    return await clipboard.readText()
  } catch {
    return ''
  }
}

function run(cmd: string, args: string[], timeout = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err) => resolve(!err))
  })
}

/** Writes to the clipboard; on Wayland also via wl-copy (Electron can't always own the selection while unfocused). */
async function writeClipboard(text: string): Promise<void> {
  await clipboard.writeText(text)
  if (isWayland && (await readText()) !== text) {
    await new Promise<void>((resolve) => {
      const child = execFile('wl-copy', [], { timeout: 1500 }, () => resolve())
      child.stdin?.end(text)
    })
  }
}

export function macAccessibilityTrusted(): boolean {
  return !isMac || systemPreferences.isTrustedAccessibilityClient(false)
}

/**
 * Simulate Ctrl/Cmd + <letter> (v or c). Returns false if no mechanism worked.
 * Wayland: wtype, then ydotool. Otherwise uiohook keyTap.
 */
async function sendChord(letter: 'v' | 'c'): Promise<boolean> {
  await waitForModifiersReleased()
  if (isWayland) {
    if (await run('wtype', ['-M', 'ctrl', letter, '-m', 'ctrl'])) return true
    // ydotool uses Linux input event codes: ctrl=29, v=47, c=46
    const code = letter === 'v' ? '47' : '46'
    return run('ydotool', ['key', '29:1', `${code}:1`, `${code}:0`, '29:0'])
  }
  const uio = loadUiohook()
  if (!uio) return false
  try {
    const key = letter === 'v' ? uio.UiohookKey.V : uio.UiohookKey.C
    uio.uIOhook.keyTap(key, [isMac ? uio.UiohookKey.Meta : uio.UiohookKey.Ctrl])
    return true
  } catch (err) {
    log('keyTap failed', err)
    return false
  }
}

/** Insert text into the focused app. Never throws. */
export async function insertText(text: string, method: PasteMethod, restoreClipboard: boolean): Promise<InsertOutcome> {
  const prev = restoreClipboard ? await snapshot() : null
  try {
    await writeClipboard(text)
    if (method === 'clipboard-only') return { pasted: false }
    if (isMac && !macAccessibilityTrusted()) return { pasted: false, hint: MAC_ACCESSIBILITY_HINT }
    await sleep(isMac ? 50 : 30)
    const ok = await sendChord('v')
    if (!ok) return { pasted: false, hint: COPIED_HINT.replace('Ctrl', isMac ? 'Cmd' : 'Ctrl') }
    if (prev) {
      await sleep(RESTORE_AFTER_MS)
      // only restore if nobody replaced our text meanwhile
      if ((await readText()) === text) await restore(prev)
    }
    return { pasted: true }
  } catch (err) {
    log('insertText failed', err)
    return { pasted: false, hint: "Couldn't paste — text is on the clipboard" }
  }
}

/**
 * Command mode: copy the current selection from the focused app. Uses a sentinel so "nothing selected"
 * is distinguishable from "selection equals old clipboard". Restores the clipboard afterwards.
 */
export async function captureSelection(): Promise<{ text: string; hint?: string } | null> {
  if (isMac && !macAccessibilityTrusted()) return { text: '', hint: 'Grant Accessibility to use command mode' }
  const prev = await snapshot()
  const sentinel = `​__wisprram_${Date.now()}_${Math.random().toString(36).slice(2)}__`
  try {
    await clipboard.writeText(sentinel)
    const ok = await sendChord('c')
    if (!ok) return { text: '', hint: isWayland ? 'Install wtype or ydotool for command mode' : "Couldn't copy the selection" }
    await sleep(150)
    const text = await readText()
    if (!text || text === sentinel) return null
    return { text }
  } finally {
    await restore(prev)
  }
}

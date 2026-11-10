// Tracks which modifier keys are physically held (fed by uiohook) so synthetic shortcuts
// (copy/paste) don't get mixed with the user's still-held modifiers, e.g. Cmd+Shift from the hotkey.
const MODIFIER_CODES = new Set([29, 3613, 56, 3640, 42, 54, 3675, 3676]) // Ctrl, CtrlR, Alt, AltR, Shift, ShiftR, Meta, MetaR
const held = new Set<number>()
let tracking = false

export function setModifierTracking(on: boolean): void {
  tracking = on
  if (!on) held.clear()
}

export function noteKey(keycode: number, down: boolean): void {
  if (!MODIFIER_CODES.has(keycode)) return
  if (down) held.add(keycode)
  else held.delete(keycode)
}

/** Resolves when no modifier is held (or after the timeout). Immediate when tracking is unavailable. */
export async function waitForModifiersReleased(timeoutMs = 1200): Promise<void> {
  if (!tracking) return
  const deadline = Date.now() + timeoutMs
  while (held.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25))
}

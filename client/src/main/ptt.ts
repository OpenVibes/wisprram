// Pure push-to-talk gesture detector (no Electron / uiohook imports) so the timing logic is unit-testable.
//
// Gestures on the PTT key:
//   hold ≥ minHoldMs      → press(start) … release-stop
//   hold <  minHoldMs     → press(start) … release-cancel   (a "tap": cancel silently)
//   two taps within       → second press emits 'lock' (start hands-free); its release emits nothing
//   doubleTapMs
//   another key pressed   → 'combo-cancel' if it happens while the PTT key is held and the hold is still
//   during a short hold     shorter than minHoldMs (the user was typing a shortcut, not dictating)
// OS key-repeat (repeated keydown without keyup) is ignored.

export type PttEvent =
  | { type: 'start' } // begin push-to-talk recording
  | { type: 'lock' } // double-tap: begin/convert to hands-free
  | { type: 'stop' } // released after a real hold → stop & transcribe
  | { type: 'cancel' } // short tap or combo → discard silently

export interface PttOptions {
  keycode: number
  minHoldMs?: number
  doubleTapMs?: number
}

export class PttDetector {
  private keycode: number
  private readonly minHoldMs: number
  private readonly doubleTapMs: number
  private down = false
  private downAt = 0
  /** release time of the last short tap (0 = none) */
  private lastTapUpAt = 0
  /** this press is the 2nd tap of a double-tap, or was cancelled by a combo: release does nothing */
  private consumed = false

  constructor(
    opts: PttOptions,
    private readonly emit: (e: PttEvent) => void
  ) {
    this.keycode = opts.keycode
    this.minHoldMs = opts.minHoldMs ?? 250
    this.doubleTapMs = opts.doubleTapMs ?? 350
  }

  setKeycode(keycode: number): void {
    if (keycode === this.keycode) return
    this.keycode = keycode
    this.reset()
  }

  reset(): void {
    this.down = false
    this.consumed = false
    this.lastTapUpAt = 0
  }

  get isDown(): boolean {
    return this.down
  }

  keyDown(keycode: number, now: number): void {
    if (keycode !== this.keycode) {
      // Another key while PTT is held and still within the tap window → it's a shortcut combo.
      if (this.down && !this.consumed && now - this.downAt < this.minHoldMs) {
        this.consumed = true
        this.emit({ type: 'cancel' })
      }
      this.lastTapUpAt = 0
      return
    }
    if (this.down) return // key repeat
    this.down = true
    this.downAt = now
    if (this.lastTapUpAt && now - this.lastTapUpAt <= this.doubleTapMs) {
      this.lastTapUpAt = 0
      this.consumed = true
      this.emit({ type: 'lock' })
      return
    }
    this.consumed = false
    this.emit({ type: 'start' })
  }

  keyUp(keycode: number, now: number): void {
    if (keycode !== this.keycode || !this.down) return
    this.down = false
    if (this.consumed) {
      this.consumed = false
      return
    }
    if (now - this.downAt < this.minHoldMs) {
      this.lastTapUpAt = now
      this.emit({ type: 'cancel' })
    } else {
      this.lastTapUpAt = 0
      this.emit({ type: 'stop' })
    }
  }
}

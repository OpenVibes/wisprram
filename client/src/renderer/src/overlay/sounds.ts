// Soft synthesized cues (< 150 ms, quiet). The AudioContext is created lazily and kept for reuse.
export type Cue = 'start' | 'stop' | 'error'

interface ToneSpec {
  freq: number
  at: number // seconds from now
  dur: number
  gain: number
  type?: OscillatorType
}

export const CUES: Record<Cue, ToneSpec[]> = {
  start: [
    { freq: 660, at: 0, dur: 0.06, gain: 0.05 },
    { freq: 880, at: 0.055, dur: 0.07, gain: 0.05 }
  ],
  stop: [
    { freq: 784, at: 0, dur: 0.055, gain: 0.04 },
    { freq: 523, at: 0.05, dur: 0.07, gain: 0.04 }
  ],
  error: [{ freq: 196, at: 0, dur: 0.14, gain: 0.07, type: 'triangle' }]
}

/** Total length of a cue in ms (used by tests to assert the < 150 ms budget). */
export function cueDurationMs(cue: Cue): number {
  return Math.max(...CUES[cue].map((t) => t.at + t.dur)) * 1000
}

export class SoundPlayer {
  private ctx: AudioContext | null = null

  play(cue: Cue): void {
    try {
      this.ctx ??= new AudioContext()
      const ctx = this.ctx
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
      const t0 = ctx.currentTime + 0.01
      for (const tone of CUES[cue]) {
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = tone.type ?? 'sine'
        osc.frequency.value = tone.freq
        const start = t0 + tone.at
        g.gain.setValueAtTime(0.0001, start)
        g.gain.exponentialRampToValueAtTime(tone.gain, start + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, start + tone.dur)
        osc.connect(g).connect(ctx.destination)
        osc.start(start)
        osc.stop(start + tone.dur + 0.02)
      }
    } catch {
      /* audio output unavailable: cues are optional */
    }
  }

  dispose(): void {
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
  }
}

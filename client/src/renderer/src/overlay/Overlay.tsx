import { useEffect, useRef, useState } from 'react'
import type { RecState } from '../../../shared/ipc'
import type { ClientSettings } from '../../../shared/settings'
import { Icon } from '../components/Icon'
import { formatTimer } from '../lib/format'
import { isMocked } from '../mock/install'
import { Capture } from './capture'
import { cueForTransition, pillMessage } from './phase'
import { SoundPlayer } from './sounds'
import { Waveform } from './Waveform'

const BARS = 14
const IDLE: RecState = { phase: 'idle' }

/** Fallback auto-hide in case main never sends `idle` after done/error. */
const STALE_MS = { done: 3500, error: 4500 }

export function Overlay(): React.JSX.Element {
  const [rec, setRec] = useState<RecState>(IDLE)
  const [hidden, setHidden] = useState(false)
  const last = useRef<RecState>(IDLE) // last non-idle state, kept on screen during the exit animation
  const prevRef = useRef<RecState>(IDLE)
  const captureRef = useRef<Capture | null>(null)
  const playSounds = useRef(true)
  const sounds = useRef<SoundPlayer | null>(null)

  // settings: playSounds
  useEffect(() => {
    const b = window.wisprram
    b.settings.get().then((s) => (playSounds.current = s.playSounds)).catch(() => undefined)
    return b.settings.onChange((s: ClientSettings) => (playSounds.current = s.playSounds))
  }, [])

  // capture lifecycle
  useEffect(() => {
    const b = window.wisprram
    const cap = new Capture({ sendAudio: (d, m, ms) => b.recorder.sendAudio(d, m, ms), sendCaptureError: (msg) => b.recorder.sendCaptureError(msg) })
    captureRef.current = cap
    const offs = [
      b.recorder.onStart((o) => void cap.start(o)),
      b.recorder.onStop(() => void cap.stop()),
      b.recorder.onCancel(() => void cap.cancel())
    ]
    return () => {
      offs.forEach((f) => f())
      void cap.dispose()
      captureRef.current = null
    }
  }, [])

  // rec state + cues
  useEffect(() => {
    sounds.current = new SoundPlayer()
    const off = window.wisprram.recorder.onRecState((next) => {
      const cue = cueForTransition(prevRef.current, next)
      if (cue && playSounds.current) sounds.current?.play(cue)
      prevRef.current = next
      if (next.phase !== 'idle') last.current = next
      setHidden(false)
      setRec(next)
    })
    return () => {
      off()
      sounds.current?.dispose()
    }
  }, [])

  useEffect(() => {
    if (rec.phase !== 'done' && rec.phase !== 'error') return
    const t = setTimeout(() => setHidden(true), STALE_MS[rec.phase])
    return () => clearTimeout(t)
  }, [rec])

  // Dev convenience: overlay.html#recording|handsfree|command|processing|done|error preselects a state (mock only).
  useEffect(() => {
    const m = window.__WISPRRAM_MOCK__
    if (!m) return
    const h = location.hash.replace('#', '')
    const states: Record<string, RecState> = {
      recording: { phase: 'recording', mode: 'ptt', startedAt: Date.now() - 4000 },
      handsfree: { phase: 'recording', mode: 'handsfree', startedAt: Date.now() - 65000 },
      command: { phase: 'recording', mode: 'command', startedAt: Date.now() - 2000 },
      processing: { phase: 'processing', mode: 'ptt' },
      done: { phase: 'done', mode: 'ptt', text: 'hello', words: 14 },
      error: { phase: 'error', message: 'Microphone access was denied. Allow it in system settings.' }
    }
    if (states[h]) m.setRec(states[h])
  }, [])

  const visible = rec.phase !== 'idle' && !hidden
  const shown = rec.phase === 'idle' ? last.current : rec
  const mocked = isMocked()

  return (
    <>
      <div className={`stage ${mocked ? 'mocked' : ''}`}>
        <Pill state={shown} visible={visible} getLevel={() => {
            const cap = captureRef.current
            if (cap?.active) return cap.getLevel()
            return mocked ? synthLevel() : (cap?.getLevel() ?? 0)
          }}
        />
      </div>
      {mocked && <DevStrip rec={rec} />}
    </>
  )
}

let synthT = 0
function synthLevel(): number {
  synthT += 0.16
  return Math.max(0, 0.45 + 0.35 * Math.sin(synthT) * Math.sin(synthT * 0.37) + (Math.random() - 0.5) * 0.25)
}

function Pill({ state, visible, getLevel }: { state: RecState; visible: boolean; getLevel: () => number }): React.JSX.Element {
  const mode = state.phase === 'recording' || state.phase === 'processing' || state.phase === 'done' ? state.mode : 'ptt'
  const command = mode === 'command'
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (state.phase !== 'recording') return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [state])

  return (
    <div className={`pill ${visible ? 'in' : ''} ${command ? 'command' : ''} phase-${state.phase}`} role="status" aria-live="polite" aria-hidden={!visible}>
      {state.phase === 'recording' && (
        <>
          {state.mode === 'handsfree' && (
            <span className="glyph" title="Hands-free">
              <Icon name="lock" size={13} strokeWidth={2} />
            </span>
          )}
          {command && <span className="label">Command</span>}
          <Waveform bars={BARS} getLevel={getLevel} running={visible} />
          <span className="timer">{formatTimer(now - state.startedAt)}</span>
        </>
      )}
      {state.phase === 'processing' && (
        <>
          <span className="proc" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="sr">{command ? 'Rewriting' : 'Processing'}</span>
        </>
      )}
      {state.phase === 'done' && (
        <>
          <span className="check">
            <Icon name="check" size={14} strokeWidth={2.6} />
          </span>
          <span className="label">{state.mode === 'command' ? 'Done' : `${state.words} ${state.words === 1 ? 'word' : 'words'}`}</span>
        </>
      )}
      {state.phase === 'error' && (
        <>
          <span className="err-dot" aria-hidden="true" />
          <span className="label err" title={state.message}>
            {pillMessage(state.message)}
          </span>
        </>
      )}
    </div>
  )
}

/** Dev-only strip (mock bridge) for cycling through pill states and exercising real mic capture. */
function DevStrip({ rec }: { rec: RecState }): React.JSX.Element {
  const m = window.__WISPRRAM_MOCK__!
  const set = (s: RecState): void => m.setRec(s)
  return (
    <div className="dev-strip">
      <strong>Overlay dev controls</strong> <span className="dev-state">state: {rec.phase}</span>
      <div className="dev-row">
        <span>Fake states:</span>
        <button onClick={() => set({ phase: 'idle' })}>idle</button>
        <button onClick={() => set({ phase: 'recording', mode: 'ptt', startedAt: Date.now() })}>recording</button>
        <button onClick={() => set({ phase: 'recording', mode: 'handsfree', startedAt: Date.now() })}>hands-free</button>
        <button onClick={() => set({ phase: 'recording', mode: 'command', startedAt: Date.now() })}>command</button>
        <button onClick={() => set({ phase: 'processing', mode: 'ptt' })}>processing</button>
        <button onClick={() => set({ phase: 'done', mode: 'ptt', text: 'hello world', words: 12 })}>done</button>
        <button onClick={() => set({ phase: 'error', message: 'Microphone access was denied' })}>error</button>
      </div>
      <div className="dev-row">
        <span>Real mic:</span>
        <button onClick={() => m.emitStart({ mode: 'ptt' })}>start capture</button>
        <button onClick={() => m.emitStart({ mode: 'handsfree' })}>start hands-free</button>
        <button onClick={() => m.emitStop()}>stop &amp; send</button>
        <button onClick={() => m.emitCancel()}>cancel</button>
      </div>
    </div>
  )
}

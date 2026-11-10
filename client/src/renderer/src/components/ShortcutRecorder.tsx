import { useEffect, useState } from 'react'
import { acceleratorKeycaps, eventToAccelerator, type Platform } from '../lib/keys'
import { KeyCaps } from './ui'

/** Button that shows the current accelerator; click then press a new combo to rebind. Esc cancels. */
export function ShortcutRecorder({ value, platform, onChange, label }: { value: string; platform: Platform; onChange: (accel: string) => void; label: string }): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        setHint(null)
        return
      }
      const accel = eventToAccelerator(e, platform)
      if (!accel) {
        if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) setHint('Include a modifier key (Ctrl, Alt, Shift or Cmd)')
        return
      }
      setRecording(false)
      setHint(null)
      onChange(accel)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, platform, onChange])

  return (
    <div className="shortcut">
      <button type="button" className={`shortcut-btn ${recording ? 'recording' : ''}`} aria-label={`${label}: ${recording ? 'press new shortcut' : acceleratorKeycaps(value, platform).join(' ')}. Activate to change.`} onClick={() => setRecording((r) => !r)} onBlur={() => setRecording(false)}>
        {recording ? <span className="muted">Press shortcut… (Esc to cancel)</span> : <KeyCaps keys={acceleratorKeycaps(value, platform)} />}
      </button>
      {hint && <div className="small warn-text">{hint}</div>}
    </div>
  )
}

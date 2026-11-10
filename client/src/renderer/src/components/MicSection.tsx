import { useState } from 'react'
import { useApp } from '../app/AppContext'
import { useMicDevices } from '../hooks/useMicDevices'
import { useMicMeter } from '../hooks/useMicMeter'
import { Button, LevelBar } from './ui'
import { Icon } from './Icon'

/** Device picker + live level test. The mic is only open while the test runs (and is released on unmount). */
export function MicSection({ autoStart = false }: { autoStart?: boolean }): React.JSX.Element {
  const { settings, updateSettings } = useApp()
  const { devices, hasLabels, requestAccess } = useMicDevices()
  const [testing, setTesting] = useState(autoStart)
  const [accessError, setAccessError] = useState<string | null>(null)
  const deviceId = settings?.micDeviceId ?? 'default'
  const meter = useMicMeter(testing, deviceId)

  const known = deviceId === 'default' || devices.some((d) => d.deviceId === deviceId)

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="mic-select">Input device</label>
        <select id="mic-select" className="input" value={deviceId} onChange={(e) => void updateSettings({ micDeviceId: e.target.value })}>
          <option value="default">System default</option>
          {!known && <option value={deviceId}>Unavailable device</option>}
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
        {!hasLabels && (
          <span className="hint">
            Device names are hidden until you allow microphone access.{' '}
            <button type="button" className="link" onClick={async () => setAccessError(await requestAccess())}>
              Allow access
            </button>
          </span>
        )}
        {accessError && <span className="hint warn-text">{accessError}</span>}
      </div>
      <div className="field">
        <label>Input level</label>
        <div className="meter-row">
          <LevelBar level={meter.level} active={meter.active} />
          <Button size="sm" icon={testing ? 'stop' : 'mic'} onClick={() => setTesting((t) => !t)}>
            {testing ? 'Stop test' : 'Test microphone'}
          </Button>
        </div>
        {meter.error ? (
          <span className="hint warn-text">
            <Icon name="alert" size={13} /> {meter.error}
          </span>
        ) : (
          <span className="hint">{meter.active ? 'Say something — the bar should move.' : 'Start a test to check that your microphone picks you up.'}</span>
        )}
      </div>
    </div>
  )
}

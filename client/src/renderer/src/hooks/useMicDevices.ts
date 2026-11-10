import { useCallback, useEffect, useState } from 'react'
import { micErrorMessage } from '../lib/audio'

export interface MicDevice {
  deviceId: string
  label: string
}

/** Lists audio inputs. Labels are empty until the user has granted mic access; `requestAccess` fixes that. */
export function useMicDevices(): { devices: MicDevice[]; hasLabels: boolean; refresh(): Promise<void>; requestAccess(): Promise<string | null> } {
  const [devices, setDevices] = useState<MicDevice[]>([])
  const [hasLabels, setHasLabels] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const inputs = all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      setHasLabels(inputs.length === 0 || inputs.some((d) => d.label))
      setDevices(inputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` })))
    } catch {
      setDevices([])
    }
  }, [])

  const requestAccess = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((t) => t.stop())
      await refresh()
      return null
    } catch (e) {
      return micErrorMessage(e)
    }
  }, [refresh])

  useEffect(() => {
    void refresh()
    const md = navigator.mediaDevices
    md?.addEventListener?.('devicechange', refresh)
    return () => md?.removeEventListener?.('devicechange', refresh)
  }, [refresh])

  return { devices, hasLabels, refresh, requestAccess }
}

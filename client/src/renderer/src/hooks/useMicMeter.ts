import { useEffect, useRef, useState } from 'react'
import { micErrorMessage, openMicMeter, type MicMeter } from '../lib/audio'

export interface MicMeterState {
  level: number
  active: boolean
  error: string | null
}

/** Live mic level for a settings test. The mic is released when `enabled` flips off or the component unmounts. */
export function useMicMeter(enabled: boolean, deviceId: string): MicMeterState {
  const [level, setLevel] = useState(0)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const raf = useRef(0)

  useEffect(() => {
    if (!enabled) {
      setLevel(0)
      setActive(false)
      return
    }
    let cancelled = false
    let meter: MicMeter | null = null
    setError(null)
    openMicMeter(deviceId)
      .then((m) => {
        if (cancelled) {
          m.close()
          return
        }
        meter = m
        setActive(true)
        let last = 0
        const tick = (t: number): void => {
          if (t - last > 33) {
            last = t
            setLevel(m.getLevel())
          }
          raf.current = requestAnimationFrame(tick)
        }
        raf.current = requestAnimationFrame(tick)
      })
      .catch((e) => {
        if (!cancelled) setError(micErrorMessage(e))
      })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf.current)
      meter?.close()
      setActive(false)
      setLevel(0)
    }
  }, [enabled, deviceId])

  return { level, active, error }
}

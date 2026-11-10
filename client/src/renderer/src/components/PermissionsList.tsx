import { useCallback, useEffect, useState } from 'react'
import type { PermissionKind, PermissionState, Permissions } from '../../../shared/ipc'
import { errorMessage } from '../lib/format'
import { Badge, Button, ErrorInline, Skeleton } from './ui'
import { useToast } from './Toast'

const META: Record<PermissionKind, { title: string; why: string }> = {
  microphone: { title: 'Microphone', why: 'Needed to hear you while you hold the dictation key.' },
  accessibility: { title: 'Accessibility', why: 'Lets WisprRam paste the text into the app you are using.' },
  'input-monitoring': { title: 'Input Monitoring', why: 'Lets WisprRam detect the push-to-talk key while other apps are focused.' }
}

const STATE: Record<PermissionState, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  granted: { label: 'Granted', tone: 'good' },
  denied: { label: 'Denied', tone: 'bad' },
  'not-determined': { label: 'Not asked yet', tone: 'warn' },
  restricted: { label: 'Restricted', tone: 'bad' },
  unknown: { label: 'Unknown', tone: 'neutral' },
  'not-applicable': { label: 'Not needed', tone: 'neutral' }
}

/** macOS permission rows with Grant / Open Settings. Polls while mounted so changes in System Settings show up. */
export function PermissionsList({ kinds }: { kinds: PermissionKind[] }): React.JSX.Element {
  const toast = useToast()
  const [perms, setPerms] = useState<Permissions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<PermissionKind | null>(null)

  const load = useCallback(async () => {
    try {
      setPerms(await window.wisprram.permissions.get())
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(load, 2500)
    window.addEventListener('focus', load)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', load)
    }
  }, [load])

  const grant = async (k: PermissionKind): Promise<void> => {
    setBusy(k)
    try {
      const s = await window.wisprram.permissions.request(k)
      setPerms((p) => (p ? { ...p, [k]: s } : p))
      if (s !== 'granted') await window.wisprram.permissions.openSettings(k)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  if (error) return <ErrorInline message={error} onRetry={load} />
  return (
    <div className="perm-list">
      {kinds.map((k) => {
        const st = perms?.[k]
        const meta = STATE[st ?? 'unknown']
        return (
          <div className="perm" key={k}>
            <div className="row-text">
              <div className="row-title">{META[k].title}</div>
              <div className="muted small">{META[k].why}</div>
            </div>
            <div className="perm-actions">
              {perms ? <Badge tone={meta.tone}>{meta.label}</Badge> : <Skeleton w={80} h={22} r={11} />}
              {st !== 'granted' && st !== 'not-applicable' && (
                <>
                  <Button size="sm" variant="primary" busy={busy === k} onClick={() => grant(k)}>
                    Grant
                  </Button>
                  <Button size="sm" onClick={() => void window.wisprram.permissions.openSettings(k)}>
                    Open Settings
                  </Button>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

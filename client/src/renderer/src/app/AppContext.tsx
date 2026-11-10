import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppInfo, AppStatus } from '../../../shared/ipc'
import type { ClientSettings } from '../../../shared/settings'
import type { Platform } from '../lib/keys'
import { errorMessage } from '../lib/format'
import { useToast } from '../components/Toast'

interface AppCtx {
  platform: Platform
  info: AppInfo | null
  settings: ClientSettings | null
  status: AppStatus | null
  /** Partial settings update with optimistic UI; toasts on failure. */
  updateSettings(patch: Partial<Omit<ClientSettings, 'hasToken'>>): Promise<void>
  refreshStatus(): Promise<void>
}

const Ctx = createContext<AppCtx | null>(null)

function guessPlatform(): Platform {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Mac/i.test(ua)) return 'darwin'
  if (/Win/i.test(ua)) return 'win32'
  return 'linux'
}

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const toast = useToast()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<ClientSettings | null>(null)
  const [status, setStatus] = useState<AppStatus | null>(null)

  useEffect(() => {
    const b = window.wisprram
    let alive = true
    b.app.info().then((i) => alive && setInfo(i)).catch(() => undefined)
    b.settings.get().then((s) => alive && setSettings((cur) => cur ?? s)).catch(() => undefined)
    b.connection.status().then((s) => alive && setStatus((cur) => cur ?? s)).catch(() => undefined)
    const offS = b.settings.onChange((s) => setSettings(s))
    const offC = b.connection.onStatus((s) => setStatus(s))
    return () => {
      alive = false
      offS()
      offC()
    }
  }, [])

  // Theme: 'system' follows prefers-color-scheme through CSS; light/dark force it via a data attribute.
  useEffect(() => {
    const el = document.documentElement
    if (settings?.theme === 'light' || settings?.theme === 'dark') el.dataset.theme = settings.theme
    else delete el.dataset.theme
  }, [settings?.theme])

  const platform: Platform = info?.platform ?? guessPlatform()

  const updateSettings = useCallback(
    async (patch: Partial<Omit<ClientSettings, 'hasToken'>>) => {
      setSettings((cur) => (cur ? { ...cur, ...patch } : cur))
      try {
        const next = await window.wisprram.settings.set(patch)
        setSettings(next)
      } catch (e) {
        toast(errorMessage(e, 'Could not save settings'), 'error')
        window.wisprram.settings.get().then(setSettings).catch(() => undefined)
      }
    },
    [toast]
  )

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await window.wisprram.connection.refresh())
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }, [toast])

  const value = useMemo(() => ({ platform, info, settings, status, updateSettings, refreshStatus }), [platform, info, settings, status, updateSettings, refreshStatus])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}

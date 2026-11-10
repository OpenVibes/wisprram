import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { CONNECTION_LABEL, StatusDot, connectionTone } from '../components/StatusChip'
import { isMocked } from '../mock/install'
import { navigate } from '../lib/route'
import { useApp } from './AppContext'

function useSystemDark(): boolean {
  const q = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined
  const [dark, setDark] = useState(!!q?.matches)
  useEffect(() => {
    if (!q) return
    const on = (e: MediaQueryListEvent): void => setDark(e.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [q])
  return dark
}

/** Draggable strip on top of the window (the macOS traffic lights sit in its left corner). */
export function TitleBar(): React.JSX.Element {
  const { settings, status, updateSettings } = useApp()
  const systemDark = useSystemDark()
  const dark = settings?.theme === 'dark' || (settings?.theme !== 'light' && systemDark)
  const c = status?.connection
  return (
    <header className="titlebar">
      {isMocked() && <span className="mock-banner">Mock bridge · sample data</span>}
      <div className="titlebar-right">
        <button type="button" className="tb-btn" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} aria-pressed={dark} data-tip={dark ? 'Light theme' : 'Dark theme'} onClick={() => void updateSettings({ theme: dark ? 'light' : 'dark' })}>
          <Icon name={dark ? 'sun' : 'moon'} size={20} strokeWidth={1.6} />
        </button>
        <button type="button" className="tb-btn" aria-label={`Connection: ${c ? CONNECTION_LABEL[c] : 'checking'}`} data-tip={c ? CONNECTION_LABEL[c] : 'Checking…'} onClick={() => navigate(c === 'connected' ? 'home' : 'settings', c === 'connected' ? undefined : 'server')}>
          <StatusDot tone={c ? connectionTone(c) : 'idle'} />
        </button>
      </div>
    </header>
  )
}

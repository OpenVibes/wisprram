import { Brand } from '../components/Brand'
import { Icon, type IconName } from '../components/Icon'
import { CONNECTION_LABEL, StatusDot, connectionTone } from '../components/StatusChip'
import { useToast } from '../components/Toast'
import { Button } from '../components/ui'
import { getArchiveBridge, useArchiveFolder } from '../hooks/useArchive'
import { middleEllipsis } from '../lib/archive'
import { errorMessage } from '../lib/format'
import type { Route } from '../lib/route'
import { navigate } from '../lib/route'
import { useApp } from './AppContext'

const NAV: Array<{ route: Route; label: string; icon: IconName }> = [
  { route: 'home', label: 'Home', icon: 'home' },
  { route: 'history', label: 'History', icon: 'history' },
  { route: 'dictionary', label: 'Dictionary', icon: 'book' },
  { route: 'snippets', label: 'Snippets', icon: 'snippet' },
  { route: 'style', label: 'Style', icon: 'style' }
]

function NavLink({ route, label, icon, current }: { route: Route; label: string; icon: IconName; current: Route }): React.JSX.Element {
  return (
    <a
      href={`#/${route}`}
      className={`nav-item ${current === route ? 'on' : ''}`}
      aria-current={current === route ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault()
        navigate(route)
      }}
    >
      <Icon name={icon} size={20} strokeWidth={1.6} />
      {label}
    </a>
  )
}

export function Sidebar({ route }: { route: Route }): React.JSX.Element {
  return (
    <aside className="sidebar">
      <Brand />
      <nav aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.route} {...n} current={route} />
        ))}
      </nav>
      <SideCard />
      <div className="side-bottom">
        <NavLink route="settings" label="Settings" icon="settings" current={route} />
      </div>
    </aside>
  )
}

/** Small card above Settings: where recordings go, or the connection when the archive is unavailable. */
function SideCard(): React.JSX.Element {
  const { settings, status } = useApp()
  const toast = useToast()
  const archive = getArchiveBridge()
  const on = !!settings?.archiveEnabled
  const { folder } = useArchiveFolder(settings?.archiveDir ?? '')

  if (!archive) {
    const c = status?.connection
    const gpu = status?.health?.gpu?.name.replace(/^NVIDIA (GeForce )?/, '')
    return (
      <div className="side-card">
        <b className="side-card-title">
          <StatusDot tone={c ? connectionTone(c) : 'idle'} /> {c ? CONNECTION_LABEL[c] : 'Checking…'}
        </b>
        <p className="muted small">{gpu ? `Running on ${gpu}` : 'Your WisprRam server'}</p>
        <Button size="sm" variant="primary" onClick={() => navigate(c === 'connected' ? 'home' : 'settings', c === 'connected' ? undefined : 'server')}>
          {c === 'connected' ? 'Details' : 'Connect'}
        </Button>
      </div>
    )
  }
  return (
    <div className="side-card">
      <b className="side-card-title">{on ? 'Recordings saved to' : 'Keep your recordings'}</b>
      <p className="muted small side-card-text" title={on ? (folder ?? undefined) : undefined}>
        {on ? (folder ? middleEllipsis(folder, 34) : '…') : 'Save audio and text on this computer.'}
      </p>
      {on ? (
        <Button size="sm" variant="primary" icon="folder" onClick={() => archive.open().catch((e) => toast(errorMessage(e, 'Could not open the folder'), 'error'))}>
          Open
        </Button>
      ) : (
        <Button size="sm" variant="primary" onClick={() => navigate('settings', 'archive')}>
          Set up
        </Button>
      )}
    </div>
  )
}

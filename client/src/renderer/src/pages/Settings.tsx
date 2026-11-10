import { useEffect, useState } from 'react'
import type { ClientSettings } from '../../../shared/settings'
import { useApp } from '../app/AppContext'
import { ConnectForm } from '../components/ConnectForm'
import { MicSection } from '../components/MicSection'
import { PermissionsList } from '../components/PermissionsList'
import { RecordingsCard } from '../components/RecordingsCard'
import { ShortcutRecorder } from '../components/ShortcutRecorder'
import { Button, Card, KeyCaps, PageHeader, Row, Segmented, Skeleton, Switch } from '../components/ui'
import { acceleratorKeycaps, pttKeycaps, pttOptions } from '../lib/keys'
import { resetHeroes } from '../lib/hero'
import { DOCS_URL, ISSUES_URL, REPO_URL } from '../lib/links'
import { navigate, parseSection } from '../lib/route'
import { useToast } from '../components/Toast'
import { errorMessage } from '../lib/format'

const SECTIONS: Array<{ id: string; label: string; macOnly?: boolean }> = [
  { id: 'server', label: 'Server' },
  { id: 'microphone', label: 'Microphone' },
  { id: 'archive', label: 'Recordings & archive' },
  { id: 'hotkeys', label: 'Hotkeys' },
  { id: 'behaviour', label: 'Behaviour' },
  { id: 'permissions', label: 'Permissions', macOnly: true },
  { id: 'about', label: 'About' }
]

/** Scrolls to #/settings/<section> on mount and whenever the hash changes while Settings is open. */
function useSectionScroll(ready: boolean): void {
  const [section, setSection] = useState(() => parseSection(location.hash))
  useEffect(() => {
    const on = (): void => setSection(parseSection(location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  useEffect(() => {
    if (!ready || !section) return
    const el = document.getElementById(`sec-${section}`)
    if (!el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }, [section, ready])
}

export function Settings(): React.JSX.Element {
  const { platform, info, settings, updateSettings } = useApp()
  const toast = useToast()
  useSectionScroll(!!settings)
  const openLink = (url: string): void => {
    window.wisprram.app.openExternal(url).catch((e) => toast(errorMessage(e, 'Could not open the link'), 'error'))
  }
  const set = (patch: Partial<Omit<ClientSettings, 'hasToken'>>): void => void updateSettings(patch)

  if (!settings) {
    return (
      <div className="page-stack">
        <PageHeader title="Settings" />
        <Skeleton h={220} r={16} />
        <Skeleton h={220} r={16} />
      </div>
    )
  }

  const mac = platform === 'darwin'
  const duplicate = settings.handsFreeShortcut === settings.commandShortcut

  return (
    <div className="page-stack">
      <PageHeader title="Settings" />

      <nav className="tabs-row" aria-label="Jump to section">
        <div className="tabs">
          {SECTIONS.filter((x) => !x.macOnly || mac).map((x) => (
            <a key={x.id} href={`#/settings/${x.id}`} onClick={(e) => { e.preventDefault(); navigate('settings', x.id) }}>
              {x.label}
            </a>
          ))}
        </div>
      </nav>

      <Card id="sec-server" title="Server" description="Your WisprRam server, running on your PC. Nothing leaves your network.">
        <ConnectForm />
      </Card>

      <Card id="sec-microphone" title="Microphone">
        <MicSection />
      </Card>

      <RecordingsCard />

      <Card id="sec-hotkeys" title="Hotkeys">
        <Row title="Push-to-talk key" description="Hold to dictate, release to insert." htmlFor="ptt">
          <div className="inline">
            <KeyCaps keys={pttKeycaps(settings.pttKey, platform)} />
            <select id="ptt" className="input narrow" value={settings.pttKey} onChange={(e) => set({ pttKey: e.target.value })}>
              {pttOptions(platform, settings.pttKey).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </Row>
        <Row title="Hands-free shortcut" description="Press once to start, again to stop.">
          <ShortcutRecorder label="Hands-free shortcut" value={settings.handsFreeShortcut} platform={platform} onChange={(a) => set({ handsFreeShortcut: a })} />
        </Row>
        <Row title="Command mode shortcut" description="Select text, press this, and say how to change it.">
          <ShortcutRecorder label="Command mode shortcut" value={settings.commandShortcut} platform={platform} onChange={(a) => set({ commandShortcut: a })} />
        </Row>
        {duplicate && (
          <div className="callout callout-warn">
            Both shortcuts are the same ({acceleratorKeycaps(settings.handsFreeShortcut, platform).join(' ')}). Pick different ones.
          </div>
        )}
        {platform === 'linux' && info?.sessionType === 'wayland' && (
          <div className="callout callout-warn">On Wayland the hold-to-talk key may not work in other apps. The hands-free shortcut is more reliable there.</div>
        )}
        <div className="btn-row">
          <Button size="sm" variant="ghost" onClick={() => set({ pttKey: mac ? 'AltRight' : 'CtrlRight', handsFreeShortcut: 'CommandOrControl+Shift+Space', commandShortcut: 'CommandOrControl+Shift+E' })}>
            Reset to defaults
          </Button>
        </div>
      </Card>

      <Card id="sec-behaviour" title="Behaviour">
        <Row title="Play sounds" description="A short blip when recording starts, stops or fails.">
          <Switch label="Play sounds" checked={settings.playSounds} onChange={(v) => set({ playSounds: v })} />
        </Row>
        <Row title="Show overlay" description="The floating pill with a live waveform while you speak.">
          <Switch label="Show overlay" checked={settings.showOverlay} onChange={(v) => set({ showOverlay: v })} />
        </Row>
        <Row title="Insert method" description="Auto simulates paste into the focused app. Clipboard only just copies the text." htmlFor="paste">
          <select id="paste" className="input narrow" value={settings.pasteMethod} onChange={(e) => set({ pasteMethod: e.target.value as ClientSettings['pasteMethod'] })}>
            <option value="auto">Auto (paste)</option>
            <option value="clipboard-only">Clipboard only</option>
          </select>
        </Row>
        <Row title="Restore clipboard" description="Put back what you had copied after inserting text.">
          <Switch label="Restore clipboard" checked={settings.restoreClipboard} disabled={settings.pasteMethod === 'clipboard-only'} onChange={(v) => set({ restoreClipboard: v })} />
        </Row>
        <Row title="Launch at login" description="Start WisprRam in the background when you sign in.">
          <Switch label="Launch at login" checked={settings.launchAtLogin} onChange={(v) => set({ launchAtLogin: v })} />
        </Row>
        <Row title="Appearance">
          <Segmented
            label="Theme"
            value={settings.theme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' }
            ]}
            onChange={(v) => set({ theme: v })}
          />
        </Row>
      </Card>

      {mac && (
        <Card id="sec-permissions" title="Permissions" description="macOS asks for these once. After rebuilding the app you may need to grant them again.">
          <PermissionsList kinds={['microphone', 'accessibility', 'input-monitoring']} />
        </Card>
      )}

      <Card id="sec-about" title="About" description="Wispr to your RAM. WisprRam is free, open-source software (MIT licence), and your data stays with you.">
        <dl className="facts">
          <div>
            <dt>Version</dt>
            <dd>{info?.version ?? '…'}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>
              {info ? `${info.platform === 'darwin' ? 'macOS' : info.platform === 'win32' ? 'Windows' : 'Linux'} · ${info.arch}${info.sessionType ? ` · ${info.sessionType}` : ''}` : '…'}
            </dd>
          </div>
        </dl>
        <div className="btn-row">
          <Button size="sm" icon="external" onClick={() => openLink(REPO_URL)}>
            GitHub
          </Button>
          <Button size="sm" icon="external" onClick={() => openLink(DOCS_URL)}>
            Documentation
          </Button>
          <Button size="sm" icon="external" onClick={() => openLink(ISSUES_URL)}>
            Report a problem
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { resetHeroes(); toast('Page tips are back', 'info') }}>
            Show page tips again
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('onboarding')}>
            Run setup again
          </Button>
        </div>
      </Card>
    </div>
  )
}

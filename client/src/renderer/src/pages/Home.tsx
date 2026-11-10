import { useEffect } from 'react'
import { useApp } from '../app/AppContext'
import { Hero } from '../components/Hero'
import { Badge, Button, Card, EmptyState, ErrorInline, KeyCaps, PageHeader, Skeleton, SkeletonList } from '../components/ui'
import { Icon, type IconName } from '../components/Icon'
import { CONNECTION_LABEL, StatusDot, connectionTone } from '../components/StatusChip'
import { useToast } from '../components/Toast'
import { getArchiveBridge, useArchiveFolder } from '../hooks/useArchive'
import { useAsync } from '../hooks/useAsync'
import { middleEllipsis } from '../lib/archive'
import { relativeTime } from '../lib/dates'
import { errorMessage, formatMinutes, formatNumber, greeting, plural, truncate } from '../lib/format'
import { acceleratorKeycaps, pttKeycaps } from '../lib/keys'
import { navigate } from '../lib/route'
import type { AppStatus } from '../../../shared/ipc'

const DEFAULT_HINT: Record<AppStatus['connection'], string> = {
  connected: '',
  connecting: 'Trying to reach your server…',
  unconfigured: 'Enter your server’s address to get started, for example http://192.168.1.50:8790.',
  unpaired: 'Pair this app with your server using the 6-digit code from `wisprram-server pair`.',
  unreachable: 'Could not reach the server. Make sure your PC is on, on the same network, and the server is running.',
  unauthorized: 'The server no longer accepts this app’s token. Pair again with a new code.'
}

export function Home(): React.JSX.Element {
  const { platform, settings, status, refreshStatus } = useApp()
  const toast = useToast()
  const stats = useAsync(() => window.wisprram.stats.get(), [])
  const recent = useAsync(() => window.wisprram.history.list({ limit: 5 }), [])

  useEffect(() => {
    return window.wisprram.dictation.onResult(() => {
      void recent.reload(true)
      void stats.reload(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const archiveOn = !!settings?.archiveEnabled
  const hasArchive = !!getArchiveBridge()
  const { folder } = useArchiveFolder(settings?.archiveDir ?? '')

  const connection = status?.connection
  const health = status?.health
  const recording = status?.rec.phase === 'recording' && status.rec.mode === 'handsfree'

  const copy = async (text: string): Promise<void> => {
    await window.wisprram.clipboard.writeText(text)
    toast('Copied to clipboard')
  }

  const tiles: Array<{ icon: IconName; label: string; value: string; sub?: string }> = stats.data
    ? [
        { icon: 'type', label: 'Words this week', value: formatNumber(stats.data.words_7d) },
        { icon: 'book', label: 'Total words', value: formatNumber(stats.data.words_total), sub: plural(stats.data.sessions_total, 'dictation') },
        { icon: 'bolt', label: 'Average speed', value: `${Math.round(stats.data.avg_wpm)}`, sub: 'words per minute' },
        { icon: 'flame', label: 'Streak', value: `${stats.data.streak_days}`, sub: stats.data.streak_days === 1 ? 'day' : 'days' },
        { icon: 'clock', label: 'Time saved', value: formatMinutes(stats.data.minutes_saved), sub: 'vs. typing' }
      ]
    : []

  return (
    <div className="page-stack">
      <PageHeader
        title={greeting(new Date().getHours())}
        actions={
          <Button variant={recording ? 'danger' : 'primary'} icon={recording ? 'stop' : 'mic'} onClick={() => void window.wisprram.dictation.toggleHandsFree()} disabled={connection !== 'connected' && !recording}>
            {recording ? 'Stop hands-free' : 'Start hands-free'}
          </Button>
        }
      />

      <Hero
        id="home"
        title={
          <>
            Wispr to your <em>RAM</em>.
          </>
        }
        subtitle="Speak, and it writes. Hold your dictation key, talk, let go. Clean, punctuated text lands in whichever app you are using, and your voice never leaves your own network."
        examples={[
          { from: '“um so we should meet at ten thirty”', to: 'We should meet at 10:30.' },
          { from: '“dear team comma thanks”', to: 'Dear team, thanks!' }
        ]}
      />

      <Card className="conn-card">
        {!status ? (
          <div className="stack">
            <Skeleton w={180} h={20} />
            <Skeleton h={14} />
            <Skeleton w="60%" h={14} />
          </div>
        ) : (
          <>
            <div className="conn-head">
              <div className="conn-title">
                <StatusDot tone={connectionTone(status.connection)} />
                <h2>{status.connection === 'connected' ? 'Connected to your PC' : status.connection === 'unconfigured' ? 'Connect to your server' : CONNECTION_LABEL[status.connection]}</h2>
                {health && health.status === 'degraded' && <Badge tone="warn">Degraded</Badge>}
              </div>
              {status.serverUrl && <code className="server-url">{status.serverUrl}</code>}
            </div>
            {status.connection === 'connected' && status.hint && (
              <div className="callout callout-warn" role="status">
                <Icon name="alert" size={16} />
                <span>{status.hint}</span>
              </div>
            )}
            {status.connection === 'connected' && health ? (
              <dl className="facts">
                <div>
                  <dt>GPU</dt>
                  <dd>
                    {health.gpu ? health.gpu.name.replace(/^NVIDIA (GeForce )?/, '') : 'None (CPU only)'}
                    {health.gpu && <span className="muted"> · {(health.gpu.mem_used_mb / 1024).toFixed(1)} / {(health.gpu.mem_total_mb / 1024).toFixed(0)} GB</span>}
                  </dd>
                </div>
                <div>
                  <dt>Speech model</dt>
                  <dd>
                    {health.stt.model} <Badge tone={health.stt.device === 'cuda' ? 'good' : 'warn'}>{health.stt.device === 'cuda' ? 'GPU' : 'CPU'}</Badge>
                    {!health.stt.loaded && <span className="muted"> · loading…</span>}
                  </dd>
                </div>
                <div>
                  <dt>Language model</dt>
                  <dd>
                    {health.llm.model} {!health.llm.reachable && <Badge tone="bad">Ollama offline</Badge>}
                  </dd>
                </div>
                <div>
                  <dt>Server</dt>
                  <dd>v{health.version}</dd>
                </div>
              </dl>
            ) : (
              <div className="conn-problem">
                <p>{status.hint || DEFAULT_HINT[status.connection]}</p>
                <div className="btn-row">
                  <Button variant="primary" icon={status.connection === 'unconfigured' ? 'wifi' : 'settings'} onClick={() => navigate('settings', 'server')}>
                    {status.connection === 'unconfigured' ? 'Connect to your server' : 'Settings'}
                  </Button>
                  <Button icon="refresh" onClick={() => void refreshStatus()}>
                    Retry
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {hasArchive && settings && (
        <section className="archive-strip" aria-label="Archive">
          <span className={`archive-icon ${archiveOn ? 'on' : ''}`}>
            <Icon name="archive" size={18} />
          </span>
          <div className="archive-text">
            <b>Archive: {archiveOn ? 'on' : 'off'}</b>
            {archiveOn ? (
              <span className="muted small" title={folder ?? undefined}>
                {' '}
                → <span className="mono">{folder ? middleEllipsis(folder, 56) : '…'}</span>
              </span>
            ) : (
              <span className="muted small"> · Dictations are not saved on this computer.</span>
            )}
          </div>
          <div className="btn-row">
            {archiveOn && (
              <Button size="sm" icon="folder" onClick={() => window.wisprram.archive?.open().catch((e) => toast(errorMessage(e, 'Could not open the folder'), 'error'))}>
                Open archive
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => navigate('settings', 'archive')}>
              {archiveOn ? 'Manage' : 'Set up'}
            </Button>
          </div>
        </section>
      )}

      <div className="grid-2">
        <Card title="How to dictate" description="Works in any app with a text field.">
          {settings ? (
            <ul className="howto">
              <li>
                <KeyCaps keys={pttKeycaps(settings.pttKey, platform)} />
                <span>
                  <b>Hold to talk.</b> Release to insert. Double-tap to lock hands-free.
                </span>
              </li>
              <li>
                <KeyCaps keys={acceleratorKeycaps(settings.handsFreeShortcut, platform)} />
                <span>
                  <b>Hands-free.</b> Press to start, again to stop. <KeyCaps size="sm" keys={['Esc']} /> cancels.
                </span>
              </li>
              <li>
                <KeyCaps keys={acceleratorKeycaps(settings.commandShortcut, platform)} />
                <span>
                  <b>Command mode.</b> Select text, then say how to change it, like “make this more polite”.
                </span>
              </li>
            </ul>
          ) : (
            <SkeletonList rows={3} h={36} />
          )}
        </Card>

        <Card title="Your stats" description="Everything you have dictated so far.">
          {stats.error ? (
            <ErrorInline message={stats.error} onRetry={() => void stats.reload()} />
          ) : (
            <div className="tiles">
              {stats.loading && !stats.data
                ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} h={76} r={12} />)
                : tiles.map((t) => (
                    <div className="tile" key={t.label}>
                      <Icon name={t.icon} size={16} />
                      <div className="tile-value">{t.value}</div>
                      <div className="tile-label">{t.label}</div>
                      {t.sub && <div className="tile-sub">{t.sub}</div>}
                    </div>
                  ))}
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Recent dictations"
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('history')}>
            View all
          </Button>
        }
      >
        {recent.error ? (
          <ErrorInline message={recent.error} onRetry={() => void recent.reload()} />
        ) : recent.loading && !recent.data ? (
          <SkeletonList rows={3} h={48} />
        ) : recent.data && recent.data.items.length > 0 ? (
          <ul className="recent">
            {recent.data.items.map((h) => (
              <li key={h.id}>
                <div className="recent-main">
                  <p>{truncate(h.text, 180)}</p>
                  <span className="muted small">
                    {relativeTime(h.created_at)}
                    {h.app_name ? ` · ${h.app_name}` : ''} · {plural(h.word_count, 'word')}
                    {h.kind === 'command' ? ' · command' : ''}
                  </span>
                </div>
                <button className="icon-btn" aria-label="Copy text" title="Copy" onClick={() => void copy(h.text)}>
                  <Icon name="copy" size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="mic" title="Nothing dictated yet">
            Hold your dictation key and say something. It will show up here.
          </EmptyState>
        )}
      </Card>
    </div>
  )
}

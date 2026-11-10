import { useState } from 'react'
import type { CleanupLevel, Language, ServerSettings, Style as StyleT } from '../../../shared/api'
import { useApp } from '../app/AppContext'
import { Hero } from '../components/Hero'
import { Button, Card, EmptyState, ErrorInline, IconButton, PageHeader, Row, Segmented, Skeleton } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { errorMessage } from '../lib/format'
import { CLEANUP_OPTIONS, LANGUAGES, STYLE_OPTIONS, styleLabel } from '../lib/styleInfo'

export function StylePage(): React.JSX.Element {
  const { settings, updateSettings } = useApp()
  const toast = useToast()
  const server = useAsync(() => window.wisprram.serverSettings.get(), [])
  const [appName, setAppName] = useState('')
  const [appStyle, setAppStyle] = useState<StyleT>('formal')

  const cleanup = settings?.cleanup ?? server.data?.default_cleanup
  const style = settings?.style ?? server.data?.default_style
  const language = settings?.language ?? server.data?.language

  /** Saves to the server's settings; the client settings (sent with every dictation) are updated separately. */
  const saveServer = async (patch: Partial<ServerSettings>, quiet = false): Promise<boolean> => {
    const prev = server.data
    server.setData((d) => (d ? { ...d, ...patch } : d))
    try {
      const next = await window.wisprram.serverSettings.set(patch)
      server.setData(next)
      if (!quiet) toast('Saved')
      return true
    } catch (e) {
      server.setData(prev as ServerSettings)
      toast(errorMessage(e, 'Could not save to the server'), 'error')
      return false
    }
  }

  const setCleanup = async (v: CleanupLevel): Promise<void> => {
    await updateSettings({ cleanup: v })
    if (server.data) await saveServer({ default_cleanup: v })
    else toast('Saved on this device')
  }
  const setStyle = async (v: StyleT): Promise<void> => {
    await updateSettings({ style: v })
    if (server.data) await saveServer({ default_style: v })
    else toast('Saved on this device')
  }
  const setLanguage = async (v: Language): Promise<void> => {
    await updateSettings({ language: v })
    if (server.data) await saveServer({ language: v })
    else toast('Saved on this device')
  }

  const perApp = Object.entries(server.data?.styles_by_app ?? {}).sort((a, b) => a[0].localeCompare(b[0]))
  const setPerApp = (name: string, s: StyleT | null): Promise<boolean> => {
    const next = { ...(server.data?.styles_by_app ?? {}) }
    if (s === null) delete next[name]
    else next[name] = s
    return saveServer({ styles_by_app: next })
  }
  const addApp = async (): Promise<void> => {
    const name = appName.trim()
    if (!name) return
    const existing = Object.keys(server.data?.styles_by_app ?? {}).find((k) => k.toLowerCase() === name.toLowerCase())
    if (await setPerApp(existing ?? name, appStyle)) setAppName('')
  }

  const cleanupInfo = CLEANUP_OPTIONS.find((o) => o.value === cleanup)

  return (
    <div className="page-stack">
      <PageHeader title="Style" />
      <Hero
        id="style"
        title={
          <>
            Sound like <em>yourself</em>, in every app.
          </>
        }
        subtitle="Choose how much WisprRam tidies what you said, and whether it should sound formal or relaxed. You can even set a different tone per app."
        examples={[
          { from: 'Formal', to: 'Hello, could you please send the report by Friday?' },
          { from: 'Casual', to: 'Hey, can you send the report by Friday?' },
          { from: 'Very casual', to: 'hey can you send the report by friday' }
        ]}
      />
      {server.error && <ErrorInline message={`Server settings unavailable: ${server.error}`} onRetry={() => void server.reload()} />}

      <Card title="Cleanup level" description="How much WisprRam edits what you said.">
        {cleanup ? (
          <div className="stack">
            <Segmented label="Cleanup level" value={cleanup} options={CLEANUP_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => void setCleanup(v)} />
            <p className="muted" aria-live="polite">
              {cleanupInfo?.description}
            </p>
          </div>
        ) : (
          <Skeleton h={40} r={12} />
        )}
      </Card>

      <Card title="Default style" description="Applies when no app-specific style matches. Only used with Full AI cleanup.">
        <div className="style-grid" role="radiogroup" aria-label="Default style">
          {STYLE_OPTIONS.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={style === o.value} className={`style-card ${style === o.value ? 'on' : ''}`} onClick={() => void setStyle(o.value)}>
              <span className="style-name">{o.label}</span>
              <span className="ex-label">You say</span>
              <span className="ex-text before">{o.example.before}</span>
              <span className="ex-label">You get</span>
              <span className="ex-text after">{o.example.after}</span>
            </button>
          ))}
        </div>
        {cleanup && cleanup !== 'full' && <p className="muted small">Styles only change the result with Full AI cleanup.</p>}
      </Card>

      <Card title="Per-app styles" description="Use a different style depending on which app you are typing in, like Formal in Mail and Very casual in Slack.">
        {server.loading && !server.data ? (
          <Skeleton h={80} r={12} />
        ) : !server.data ? null : (
          <div className="stack">
            {perApp.length === 0 ? (
              <EmptyState icon="style" title="No app-specific styles">
                Add an app name exactly as it appears in your dock or taskbar, like “Slack”.
              </EmptyState>
            ) : (
              <ul className="entry-list compact">
                {perApp.map(([name, s]) => (
                  <li className="app-style" key={name}>
                    <span className="entry-term">{name}</span>
                    <select className="input narrow" aria-label={`Style for ${name}`} value={s} onChange={(e) => void setPerApp(name, e.target.value as StyleT)}>
                      {STYLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <IconButton icon="trash" label={`Remove ${name}`} danger onClick={() => void setPerApp(name, null)} />
                  </li>
                ))}
              </ul>
            )}
            <form
              className="app-style add"
              onSubmit={(e) => {
                e.preventDefault()
                void addApp()
              }}
            >
              <input className="input" aria-label="App name" placeholder="App name, e.g. Slack" value={appName} onChange={(e) => setAppName(e.target.value)} />
              <select className="input narrow" aria-label="Style for new app" value={appStyle} onChange={(e) => setAppStyle(e.target.value as StyleT)}>
                {STYLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {styleLabel(o.value)}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="primary" icon="plus" disabled={!appName.trim()}>
                Add
              </Button>
            </form>
          </div>
        )}
      </Card>

      <Card title="Language" description="Pick your language for best accuracy, or let WisprRam detect it.">
        <Row title="Spoken language" htmlFor="lang">
          <select id="lang" className="input narrow" value={language ?? 'auto'} onChange={(e) => void setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
            {language && !LANGUAGES.some((l) => l.value === language) && <option value={language}>{language}</option>}
          </select>
        </Row>
      </Card>
    </div>
  )
}

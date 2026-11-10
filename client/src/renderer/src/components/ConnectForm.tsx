import { useEffect, useState } from 'react'
import { useApp } from '../app/AppContext'
import { validateServerUrl } from '../lib/archive'
import { errorMessage } from '../lib/format'
import { CONNECTION_LABEL, StatusDot, connectionTone } from './StatusChip'
import { Button, ConfirmDialog } from './ui'
import { Icon } from './Icon'
import { useToast } from './Toast'

/** Server URL + pairing code/token form. Shared by Settings and Onboarding. */
export function ConnectForm({ autoFocus, onConnected, showUnpair = true }: { autoFocus?: boolean; onConnected?: () => void; showUnpair?: boolean }): React.JSX.Element {
  const { settings, status, updateSettings, refreshStatus } = useApp()
  const toast = useToast()
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [confirmUnpair, setConfirmUnpair] = useState(false)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (settings && !touched) setUrl(settings.serverUrl)
  }, [settings, touched])

  const connection = status?.connection
  const isToken = secret.trim().length > 6
  const urlCheck = validateServerUrl(url)
  // Only nag after the user has typed something and left the field (or tried to submit).
  const [urlBlurred, setUrlBlurred] = useState(false)
  const urlError = !urlCheck.ok && url.trim() && urlBlurred ? urlCheck.error : null
  const cleanUrl = urlCheck.ok ? urlCheck.url : ''
  const canPair = urlCheck.ok && secret.trim().length >= 6 && !busy

  const pair = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      const s = await window.wisprram.connection.pair(cleanUrl, secret.trim())
      if (s.connection === 'connected') {
        setResult({ ok: true, message: s.health?.gpu ? `Connected. Server is running on ${s.health.gpu.name}.` : 'Connected to your server.' })
        setSecret('')
        onConnected?.()
      } else {
        setResult({ ok: false, message: s.hint ?? `Paired, but the server is ${CONNECTION_LABEL[s.connection].toLowerCase()}.` })
      }
    } catch (e) {
      setResult({ ok: false, message: errorMessage(e, 'Pairing failed') })
    } finally {
      setBusy(false)
    }
  }

  const test = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      if (settings && cleanUrl !== settings.serverUrl) await updateSettings({ serverUrl: cleanUrl })
      const s = await window.wisprram.connection.refresh()
      if (s.connection === 'connected') {
        setResult({ ok: true, message: 'Connection works.' })
        onConnected?.()
      } else setResult({ ok: false, message: s.hint ?? CONNECTION_LABEL[s.connection] })
    } catch (e) {
      setResult({ ok: false, message: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const unpair = async (): Promise<void> => {
    setConfirmUnpair(false)
    try {
      await window.wisprram.connection.unpair()
      await refreshStatus()
      toast('Unpaired from server', 'info')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="server-url">Server URL</label>
        <input
          id="server-url"
          className="input mono"
          value={url}
          autoFocus={autoFocus}
          spellCheck={false}
          autoCapitalize="off"
          placeholder="http://192.168.1.50:8790"
          inputMode="url"
          aria-invalid={!!urlError || undefined}
          aria-describedby="server-url-hint"
          onChange={(e) => {
            setTouched(true)
            setUrl(e.target.value)
          }}
          onBlur={() => {
            setUrlBlurred(true)
            if (touched && settings && cleanUrl && cleanUrl !== settings.serverUrl) {
              setUrl(cleanUrl)
              void updateSettings({ serverUrl: cleanUrl })
            }
          }}
        />
        {urlError ? (
          <span className="hint hint-bad" id="server-url-hint" role="alert">
            {urlError}
          </span>
        ) : (
          <span className="hint" id="server-url-hint">
            The address of the PC running the WisprRam server, including the port (8790 by default).
          </span>
        )}
        <details className="where">
          <summary>Where do I find this?</summary>
          <p>
            Run <code>backend/scripts/install.sh</code> on your server. It prints the address when it finishes. The default port is 8790. Your computer must be on the same network as the server.
          </p>
        </details>
      </div>
      <div className="field">
        <label htmlFor="pair-secret">Pairing code or token</label>
        <div className="input-group">
          <input
            id="pair-secret"
            className="input mono"
            type={reveal || !isToken ? 'text' : 'password'}
            value={secret}
            spellCheck={false}
            autoComplete="off"
            placeholder="6-digit code"
            inputMode={isToken ? 'text' : 'numeric'}
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canPair && void pair()}
          />
          <button type="button" className="icon-btn" aria-label={reveal ? 'Hide' : 'Show'} onClick={() => setReveal((r) => !r)}>
            <Icon name={reveal ? 'eyeOff' : 'eye'} size={16} />
          </button>
        </div>
        <span className="hint">
          Run <code>wisprram-server pair</code> on your PC to get a code. A pasted token (longer than 6 characters) is used as-is.
        </span>
      </div>
      <div className="btn-row">
        <Button variant="primary" busy={busy} disabled={!canPair} onClick={pair}>
          {isToken ? 'Save token' : 'Pair'}
        </Button>
        <Button busy={busy} disabled={!urlCheck.ok} onClick={test} icon="refresh">
          Test connection
        </Button>
        <span className="conn-inline">
          <StatusDot tone={connection ? connectionTone(connection) : 'idle'} />
          {connection ? CONNECTION_LABEL[connection] : 'Checking…'}
        </span>
        {showUnpair && settings?.hasToken && (
          <Button variant="ghost" onClick={() => setConfirmUnpair(true)}>
            Unpair
          </Button>
        )}
      </div>
      {result && (
        <div className={`callout ${result.ok ? 'callout-good' : 'callout-bad'}`} role={result.ok ? 'status' : 'alert'}>
          <Icon name={result.ok ? 'check' : 'alert'} size={16} />
          <span>{result.message}</span>
        </div>
      )}
      {!result && status?.hint && connection !== 'connected' && (
        <div className="callout callout-warn">
          <Icon name="info" size={16} />
          <span>{status.hint}</span>
        </div>
      )}
      <ConfirmDialog open={confirmUnpair} title="Unpair this app?" body="The saved token is removed. You will need a new pairing code to dictate again." confirmLabel="Unpair" danger onConfirm={unpair} onCancel={() => setConfirmUnpair(false)} />
    </div>
  )
}

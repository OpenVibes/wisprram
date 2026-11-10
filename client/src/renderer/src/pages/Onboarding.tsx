import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../app/AppContext'
import { ConnectForm } from '../components/ConnectForm'
import { Icon } from '../components/Icon'
import { MicSection } from '../components/MicSection'
import { PermissionsList } from '../components/PermissionsList'
import { useToast } from '../components/Toast'
import { getArchiveBridge, useArchiveFolder } from '../hooks/useArchive'
import { Button, KeyCaps, Switch } from '../components/ui'
import { micErrorMessage } from '../lib/audio'
import { isMocked } from '../mock/install'
import { errorMessage, plural } from '../lib/format'
import { acceleratorKeycaps, pttKeycaps } from '../lib/keys'
import { navigate } from '../lib/route'

type StepId = 'welcome' | 'connect' | 'mic' | 'permissions' | 'archive' | 'try'

export function Onboarding(): React.JSX.Element {
  const { platform, settings, status, updateSettings } = useApp()
  const steps = useMemo<StepId[]>(() => {
    const list: StepId[] = ['welcome', 'connect', 'mic']
    if (platform === 'darwin') list.push('permissions')
    if (getArchiveBridge()) list.push('archive')
    list.push('try')
    return list
  }, [platform])
  const [index, setIndex] = useState(() => {
    // dev/screenshot convenience for the mock bridge: ?step=connect
    const want = isMocked() ? new URLSearchParams(location.search).get('step') : null
    const i = steps.indexOf((want ?? '') as StepId)
    return i >= 0 ? i : 0
  })
  const step = steps[Math.min(index, steps.length - 1)]
  const last = index >= steps.length - 1
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  const finish = async (): Promise<void> => {
    await updateSettings({ onboardingDone: true })
    navigate('home')
  }

  const connected = status?.connection === 'connected'

  return (
    <div className="onboarding">
      <div className="drag-strip" />
      <div className="ob-top">
        <div className="brand">
          <Icon name="logo" size={30} strokeWidth={2.2} />
          WisprRam
        </div>
        <Button variant="ghost" size="sm" onClick={() => void finish()}>
          Skip setup
        </Button>
      </div>

      <div className="ob-card" key={step}>
        <ol className="steps" aria-label={`Step ${index + 1} of ${steps.length}`}>
          {steps.map((s, i) => (
            <li key={s} className={i === index ? 'on' : i < index ? 'done' : ''} aria-current={i === index ? 'step' : undefined} />
          ))}
        </ol>

        {step === 'welcome' && (
          <div className="ob-body">
            <div className="hero-mark">
              <Icon name="mic" size={34} />
            </div>
            <h1 tabIndex={-1} ref={headingRef}>
              Speak. It <em>types</em>.
            </h1>
            <p className="lead">WisprRam turns your voice into clean, punctuated text in any app. The heavy lifting runs on your own PC, so your audio never goes to a third party.</p>
            <ul className="bullets">
              <li>
                <Icon name="bolt" size={16} /> Hold a key, talk, release. Text appears at your cursor.
              </li>
              <li>
                <Icon name="sparkle" size={16} /> Fillers removed, self-corrections fixed, punctuation added.
              </li>
              <li>
                <Icon name="shield" size={16} /> Private by design: runs on your hardware, on your network.
              </li>
            </ul>
          </div>
        )}

        {step === 'connect' && (
          <div className="ob-body">
            <h1 tabIndex={-1} ref={headingRef}>
              Connect to your <em>PC</em>
            </h1>
            <p className="lead">Enter your server address and the 6-digit pairing code from your PC (run <code>wisprram-server pair</code> there).</p>
            <ConnectForm autoFocus showUnpair={false} />
          </div>
        )}

        {step === 'mic' && <MicStep headingRef={headingRef} />}

        {step === 'permissions' && (
          <div className="ob-body">
            <h1 tabIndex={-1} ref={headingRef}>
              Two <em>permissions</em>
            </h1>
            <p className="lead">macOS needs your permission for two things: watching for your push-to-talk key while other apps are in front, and pasting text into them. WisprRam never reads what you type.</p>
            <PermissionsList kinds={['accessibility', 'input-monitoring']} />
            <p className="muted small">After granting, macOS may ask you to reopen WisprRam.</p>
          </div>
        )}

        {step === 'archive' && settings && <ArchiveStep headingRef={headingRef} />}

        {step === 'try' && settings && <TryStep headingRef={headingRef} pttKeys={pttKeycaps(settings.pttKey, platform)} handsFree={acceleratorKeycaps(settings.handsFreeShortcut, platform)} />}

        <div className="ob-nav">
          <Button variant="ghost" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            Back
          </Button>
          <div className="btn-row">
            {step === 'connect' && !connected && (
              <Button variant="ghost" onClick={() => setIndex((i) => i + 1)}>
                Continue anyway
              </Button>
            )}
            {last ? (
              <Button variant="primary" icon="check" onClick={() => void finish()}>
                Finish
              </Button>
            ) : (
              <Button variant="primary" disabled={step === 'connect' && !connected} onClick={() => setIndex((i) => i + 1)}>
                {step === 'welcome' ? 'Get started' : 'Continue'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MicStep({ headingRef }: { headingRef: React.RefObject<HTMLHeadingElement | null> }): React.JSX.Element {
  const { platform } = useApp()
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allow = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (platform === 'darwin') await window.wisprram.permissions.request('microphone').catch(() => undefined)
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((t) => t.stop())
      setReady(true)
    } catch (e) {
      setError(micErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ob-body">
      <h1 tabIndex={-1} ref={headingRef}>
        Your <em>microphone</em>
      </h1>
      <p className="lead">Allow microphone access, then check that your voice moves the meter. Audio is only captured while you hold the key.</p>
      {!ready ? (
        <div className="stack">
          <div>
            <Button variant="primary" icon="mic" busy={busy} onClick={() => void allow()}>
              Allow microphone
            </Button>
          </div>
          {error && (
            <div className="callout callout-bad" role="alert">
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </div>
          )}
        </div>
      ) : (
        <MicSection autoStart />
      )}
    </div>
  )
}

function ArchiveStep({ headingRef }: { headingRef: React.RefObject<HTMLHeadingElement | null> }): React.JSX.Element {
  const { settings, updateSettings } = useApp()
  const toast = useToast()
  const archive = getArchiveBridge()
  const [nonce, setNonce] = useState(0)
  const { folder } = useArchiveFolder(`${settings?.archiveDir ?? ''}|${nonce}`)
  const on = !!settings?.archiveEnabled
  const choose = async (): Promise<void> => {
    try {
      if (await archive?.chooseFolder()) setNonce((n) => n + 1)
    } catch (e) {
      toast(errorMessage(e, 'Could not choose a folder'), 'error')
    }
  }
  return (
    <div className="ob-body">
      <h1 tabIndex={-1} ref={headingRef}>
        Keep your <em>recordings</em>?
      </h1>
      <p className="lead">WisprRam can save each dictation on this computer: the audio, what was heard, and the final text, as plain files in a folder you choose. This is optional, and you can change it any time in Settings.</p>
      <div className="ob-option">
        <div>
          <b>Save my recordings on this computer</b>
          <div className="muted small">Nothing is uploaded anywhere. Files stay in the folder below.</div>
        </div>
        <Switch label="Save my recordings on this computer" checked={on} onChange={(v) => void updateSettings({ archiveEnabled: v })} />
      </div>
      {on && (
        <div className="field">
          <span className="field-label">Folder</span>
          <div className="folder-row">
            <div className="folder-box" title={folder ?? undefined}>
              <Icon name="folder" size={16} />
              <span className="mono folder-path">{folder ?? '…'}</span>
            </div>
            <Button size="sm" onClick={() => void choose()}>
              Choose…
            </Button>
          </div>
          {settings?.archiveDir ? (
            <span className="hint">
              <button type="button" className="link" onClick={() => void updateSettings({ archiveDir: '' })}>
                Use the default folder
              </button>
            </span>
          ) : (
            <span className="hint">The default folder is fine for most people.</span>
          )}
        </div>
      )}
    </div>
  )
}

function TryStep({ headingRef, pttKeys, handsFree }: { headingRef: React.RefObject<HTMLHeadingElement | null>; pttKeys: string[]; handsFree: string[] }): React.JSX.Element {
  const [result, setResult] = useState<{ text: string; words: number } | null>(null)
  useEffect(
    () =>
      window.wisprram.dictation.onResult((r) => {
        const text = r.text
        setResult({ text, words: text.trim().split(/\s+/).filter(Boolean).length })
      }),
    []
  )
  return (
    <div className="ob-body">
      <h1 tabIndex={-1} ref={headingRef}>
        Try it <em>out</em>
      </h1>
      <p className="lead">
        Click the box below, then hold <KeyCaps keys={pttKeys} /> and say a sentence. Release to insert. Or press <KeyCaps keys={handsFree} /> to start and stop.
      </p>
      <textarea className="input try-box" rows={5} aria-label="Try dictation here" placeholder="Your words will appear here…" />
      {result ? (
        <div className="celebrate" role="status">
          <span className="celebrate-icon">
            <Icon name="check" size={22} strokeWidth={2.4} />
          </span>
          <div>
            <b>It works!</b>
            <div className="muted small">
              {plural(result.words, 'word')} dictated: “{result.text.length > 90 ? result.text.slice(0, 89) + '…' : result.text}”
            </div>
          </div>
        </div>
      ) : (
        <p className="muted small">Waiting for your first dictation. You can also finish now and try it later.</p>
      )}
    </div>
  )
}

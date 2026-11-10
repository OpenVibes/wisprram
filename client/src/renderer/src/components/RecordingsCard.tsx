import { useEffect, useMemo, useState } from 'react'
import type { ClientSettings } from '../../../shared/settings'
import { useApp } from '../app/AppContext'
import { getArchiveBridge, useArchiveFolder, useRecentArchive } from '../hooks/useArchive'
import { useAsync } from '../hooks/useAsync'
import { describeFiles, isAbsolutePath, layoutExample } from '../lib/archive'
import { relativeTime } from '../lib/dates'
import { errorMessage, truncate } from '../lib/format'
import { Icon } from './Icon'
import { useToast } from './Toast'
import { Badge, Button, Card, Checkbox, ErrorInline, Row, Skeleton, Switch } from './ui'

/** Settings → "Recordings & archive": the local archive (this computer) and server-side audio retention. */
export function RecordingsCard(): React.JSX.Element {
  const { settings } = useApp()
  const hasLocal = !!getArchiveBridge()
  return (
    <Card id="sec-archive" title="Recordings & archive" description="Keep your dictations for later: replay them, search them, or file them away. Everything stays on your own devices.">
      {settings && hasLocal && <LocalArchive settings={settings} />}
      <ServerAudio divided={hasLocal} />
      <div className="callout">
        <Icon name="shield" size={16} />
        <span>Privacy: recordings and transcripts stay on this computer and on your own server. Nothing is uploaded anywhere else, and nothing is sent to any third party.</span>
      </div>
    </Card>
  )
}

function LocalArchive({ settings }: { settings: ClientSettings }): React.JSX.Element {
  const { updateSettings } = useApp()
  const toast = useToast()
  const archive = getArchiveBridge()!
  const [nonce, setNonce] = useState(0)
  const { folder, error: folderError } = useArchiveFolder(`${settings.archiveDir ?? ''}|${nonce}`)
  const [choosing, setChoosing] = useState(false)
  const set = (patch: Partial<Omit<ClientSettings, 'hasToken'>>): void => void updateSettings(patch)
  const enabled = !!settings.archiveEnabled
  const sel = { archiveAudio: settings.archiveAudio !== false, archiveTranscript: settings.archiveTranscript !== false, archiveOutput: settings.archiveOutput !== false, archiveMeta: settings.archiveMeta !== false }
  const nothing = !sel.archiveAudio && !sel.archiveTranscript && !sel.archiveOutput && !sel.archiveMeta

  const choose = async (): Promise<void> => {
    setChoosing(true)
    try {
      const dir = await archive.chooseFolder()
      if (dir) setNonce((n) => n + 1)
    } catch (e) {
      toast(errorMessage(e, 'Could not choose a folder'), 'error')
    } finally {
      setChoosing(false)
    }
  }
  const open = (path?: string): void => {
    archive.open(path).catch((e) => toast(errorMessage(e, 'Could not open the folder'), 'error'))
  }

  return (
    <>
      <Row title="Save a copy of each dictation on this computer" description="Local archive: every dictation becomes a folder of files you own and can back up, search or delete like any other file.">
        <Switch label="Save a copy of each dictation on this computer" checked={enabled} onChange={(v) => set({ archiveEnabled: v })} />
      </Row>

      <div className="field">
        <span className="field-label" id="archive-folder-label">
          Archive folder
        </span>
        <div className="folder-row">
          <div className="folder-box" aria-labelledby="archive-folder-label" title={folder ?? undefined}>
            <Icon name="folder" size={16} />
            {folderError ? <span className="warn-text">{folderError}</span> : folder === null ? <Skeleton h={14} w="70%" /> : <span className="mono folder-path">{folder}</span>}
          </div>
          <Button size="sm" busy={choosing} onClick={() => void choose()}>
            Choose…
          </Button>
          <Button size="sm" icon="external" onClick={() => open()}>
            Open
          </Button>
        </div>
        <span className="hint">
          {settings.archiveDir ? (
            <>
              Custom folder.{' '}
              <button type="button" className="link" onClick={() => set({ archiveDir: '' })}>
                Reset to default
              </button>
            </>
          ) : (
            'Default folder (Documents/WisprRam). Choose another place, such as a synced or external drive.'
          )}
        </span>
      </div>

      <fieldset className={`check-group ${enabled ? '' : 'is-off'}`}>
        <legend>What to save</legend>
        <div className="check-grid">
        <Checkbox checked={sel.archiveAudio} dim={!enabled} onChange={(v) => set({ archiveAudio: v })} label="Audio recording" description="Your voice, as captured by the microphone." />
        <Checkbox checked={sel.archiveTranscript} dim={!enabled} onChange={(v) => set({ archiveTranscript: v })} label="Transcript" description="What Whisper heard, before any cleanup." />
        <Checkbox checked={sel.archiveOutput} dim={!enabled} onChange={(v) => set({ archiveOutput: v })} label="Final text" description="The AI-cleaned text that was inserted." />
        <Checkbox checked={sel.archiveMeta} dim={!enabled} onChange={(v) => set({ archiveMeta: v })} label="Details" description="Models, timings, app and settings used." />
        </div>
        <p className="hint">{enabled ? 'Applies to every new dictation and to “Save to archive” in History.' : 'Automatic saving is off, but these choices still apply when you use “Save to archive” in History.'}</p>
        {nothing && <p className="hint warn-text">Nothing is selected, so no files would be written.</p>}
      </fieldset>

      <div className="field">
        <span className="field-label">Folder layout</span>
        <pre className="layout-hint" aria-label="Example folder layout">
          {layoutExample(sel)}
        </pre>
      </div>

      <RecentSaved onOpen={open} />
    </>
  )
}

function RecentSaved({ onOpen }: { onOpen: (path: string) => void }): React.JSX.Element {
  const { entries, error, reload } = useRecentArchive(5)
  return (
    <div className="field">
      <span className="field-label">Recently saved</span>
      {error ? (
        <ErrorInline message={error} onRetry={reload} />
      ) : entries === null ? (
        <div className="stack" aria-busy="true" aria-label="Loading">
          <Skeleton h={44} r={10} />
          <Skeleton h={44} r={10} />
        </div>
      ) : entries.length === 0 ? (
        <p className="muted small recent-empty">Nothing saved yet. Dictate something with automatic saving on, or use “Save to archive” on an item in History.</p>
      ) : (
        <ul className="saved-list">
          {entries.map((e) => (
            <li key={e.path}>
              <div className="saved-main">
                <p className="saved-preview">{truncate(e.preview, 90) || <span className="muted">(no text)</span>}</p>
                <span className="muted small">
                  {relativeTime(e.createdAt)} · {describeFiles(e.files)}
                  {e.kind === 'command' && (
                    <>
                      {' '}
                      <Badge tone="accent">Command</Badge>
                    </>
                  )}
                </span>
              </div>
              <Button size="sm" variant="ghost" icon="folder" onClick={() => onOpen(e.path)} aria-label={`Show in folder: ${truncate(e.preview, 40)}`}>
                Show in folder
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ServerAudio({ divided }: { divided: boolean }): React.JSX.Element {
  const { status } = useApp()
  const toast = useToast()
  const connected = status?.connection === 'connected'
  const ss = useAsync(() => (connected ? window.wisprram.serverSettings.get() : Promise.resolve(null)), [connected])
  const [save, setSave] = useState(false)
  const [dir, setDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<{ message: string; field: boolean } | null>(null)

  const saved = ss.data
  useEffect(() => {
    if (saved) {
      setSave(!!saved.save_audio)
      setDir(saved.audio_dir ?? '')
      setFormError(null)
    }
  }, [saved])

  const dirty = !!saved && (save !== !!saved.save_audio || dir.trim() !== (saved.audio_dir ?? ''))
  const localProblem = useMemo(() => (dir.trim() && !isAbsolutePath(dir) ? 'Use a full path on the server machine, such as /home/you/wisprram-audio or D:\\Recordings.' : null), [dir])

  const submit = async (): Promise<void> => {
    if (localProblem) {
      setFormError({ message: localProblem, field: true })
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const next = await window.wisprram.serverSettings.set({ save_audio: save, audio_dir: dir.trim() })
      ss.setData(next)
      toast(next.save_audio ? 'Server will keep new recordings' : 'Server recordings are off')
    } catch (e) {
      const code = (e as { code?: string } | null)?.code
      const message = errorMessage(e, 'Could not save these settings')
      setFormError({ message, field: code === 'bad_audio_dir' || /audio_dir|absolute|folder|directory/i.test(message) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`subsection ${divided ? 'divided' : ''}`}>
      <div>
        <h3>Keep recordings on the server</h3>
        <p className="muted small">
          Your server can keep each recording next to its history entry. That lets you replay it from History on any device, and save it to your archive later. The local archive above is different: those are files on this computer only.
        </p>
      </div>
      {!connected ? (
        <div className="callout callout-warn">
          <Icon name="info" size={16} />
          <span>Connect to your server to change this.</span>
        </div>
      ) : ss.error ? (
        <ErrorInline message={ss.error} onRetry={() => void ss.reload()} />
      ) : ss.loading && !saved ? (
        <div className="stack" aria-busy="true" aria-label="Loading">
          <Skeleton h={36} r={10} />
          <Skeleton h={36} r={10} />
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            if (dirty && !busy) void submit()
          }}
        >
          <Row title="Keep a copy of each recording on the server" description="Off by default. Audio takes disk space on the server machine.">
            <Switch label="Keep a copy of each recording on the server" checked={save} onChange={setSave} />
          </Row>
          <div className="field">
            <label htmlFor="audio-dir">Folder on the server</label>
            <input
              id="audio-dir"
              className="input mono"
              value={dir}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              placeholder="Default: server data folder/audio"
              aria-invalid={formError?.field || undefined}
              aria-describedby="audio-dir-hint"
              onChange={(e) => {
                setDir(e.target.value)
                setFormError(null)
              }}
            />
            <span className="hint" id="audio-dir-hint">
              A path on the machine that runs the server, not on this computer. Leave empty for the default.
            </span>
          </div>
          {formError && (
            <div className="callout callout-bad" role="alert">
              <Icon name="alert" size={16} />
              <span>{formError.message}</span>
            </div>
          )}
          <div className="btn-row">
            <Button variant="primary" type="submit" busy={busy} disabled={!dirty}>
              Save
            </Button>
            {dirty && !busy && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSave(!!saved?.save_audio)
                  setDir(saved?.audio_dir ?? '')
                  setFormError(null)
                }}
              >
                Discard changes
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  )
}

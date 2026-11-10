import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HistoryItem } from '../../../shared/api'
import { Hero } from '../components/Hero'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorInline, IconButton, PageHeader, SkeletonList, Tabs } from '../components/ui'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import { getArchiveBridge } from '../hooks/useArchive'
import { useHistoryAudio, type PlayerState } from '../hooks/useHistoryAudio'
import { metaRows } from '../lib/archive'
import { useDebounced } from '../hooks/useDebounced'
import { groupByDay, formatTime } from '../lib/dates'
import { errorMessage, formatSeconds, formatTimer, plural } from '../lib/format'

const PAGE = 30

export function History(): React.JSX.Element {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [tab, setTab] = useState('all')
  const q = useDebounced(query.trim(), 250)
  const [items, setItems] = useState<HistoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState<Set<string>>(new Set())
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const player = useHistoryAudio((m) => toast(m, 'error'))
  const archiveAvailable = !!getArchiveBridge()
  const req = useRef(0)
  const sentinel = useRef<HTMLDivElement>(null)

  const loadFirst = useCallback(
    async (silent = false) => {
      const id = ++req.current
      if (!silent) setLoading(true)
      try {
        const page = await window.wisprram.history.list({ limit: PAGE, offset: 0, q: q || undefined })
        if (id !== req.current) return
        setItems(page.items)
        setTotal(page.total)
        setError(null)
      } catch (e) {
        if (id === req.current) setError(errorMessage(e))
      } finally {
        if (id === req.current) setLoading(false)
      }
    },
    [q]
  )

  useEffect(() => {
    void loadFirst()
  }, [loadFirst])

  // live update when a new dictation completes
  useEffect(() => window.wisprram.dictation.onResult(() => void loadFirst(true)), [loadFirst])

  const hasMore = items.length < total
  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return
    const id = req.current
    setLoadingMore(true)
    try {
      const page = await window.wisprram.history.list({ limit: PAGE, offset: items.length, q: q || undefined })
      if (id !== req.current) return
      setItems((cur) => {
        const seen = new Set(cur.map((i) => i.id))
        return [...cur, ...page.items.filter((i) => !seen.has(i.id))]
      })
      setTotal(page.total)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, loading, hasMore, items.length, q, toast])

  useEffect(() => {
    const el = sentinel.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && void loadMore(), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore])

  const shownItems = useMemo(() => (tab === 'all' ? items : items.filter((i) => (tab === 'commands' ? i.kind === 'command' : i.kind === 'dictation'))), [items, tab])
  const groups = useMemo(() => groupByDay(shownItems), [shownItems])

  const copy = async (t: string): Promise<void> => {
    try {
      await window.wisprram.clipboard.writeText(t)
      toast('Copied to clipboard')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const insert = async (t: string): Promise<void> => {
    try {
      await window.wisprram.dictation.insertText(t)
      toast('Inserted into your last app')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const remove = async (id: string): Promise<void> => {
    try {
      await window.wisprram.history.remove(id)
      player.forget(id)
      setItems((l) => l.filter((i) => i.id !== id))
      setTotal((t) => Math.max(0, t - 1))
      toast('Deleted')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const clearAll = async (): Promise<void> => {
    setClearing(true)
    try {
      await window.wisprram.history.clear()
      if (player.state.id) player.forget(player.state.id)
      setItems([])
      setTotal(0)
      toast('History cleared')
      setConfirmClear(false)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setClearing(false)
    }
  }
  const saveToArchive = async (id: string): Promise<void> => {
    const archive = getArchiveBridge()
    if (!archive) return
    setSaving((s) => new Set(s).add(id))
    try {
      const entry = await archive.saveHistoryItem(id)
      toast('Saved to your archive', 'success', { label: 'Show in folder', onClick: () => void archive.open(entry.path).catch((e) => toast(errorMessage(e, 'Could not open the folder'), 'error')) })
    } catch (e) {
      toast(errorMessage(e, 'Could not save to the archive'), 'error')
    } finally {
      setSaving((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    }
  }
  const toggleRaw = (id: string): void =>
    setRaw((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div className="page-stack">
      <PageHeader
        title="History"
        actions={
          <Button variant="secondary" icon="trash" disabled={total === 0 || !!q} onClick={() => setConfirmClear(true)}>
            Clear all
          </Button>
        }
      />
      <Tabs
        label="Filter history"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'all', label: 'All' },
          { id: 'dictations', label: 'Dictations' },
          { id: 'commands', label: 'Commands' }
        ]}
        right={
          <>
            <IconButton icon="search" label={searching ? 'Hide search' : 'Search'} aria-pressed={searching} onClick={() => setSearching((v) => !v)} />
            <IconButton icon="refresh" label="Refresh" onClick={() => void loadFirst()} />
          </>
        }
      />
      {(searching || query) && (
        <div className="search">
          <Icon name="search" size={16} />
          <input type="search" aria-label="Search history" placeholder="Search your dictations" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      {!error && !loading && total > 0 && <p className="muted small list-count">{plural(total, 'dictation')}{q ? ' match' : ' saved on your server'}</p>}

      {error ? (
        <ErrorInline message={error} onRetry={() => void loadFirst()} />
      ) : loading ? (
        <SkeletonList rows={5} h={86} />
      ) : shownItems.length === 0 && items.length === 0 ? (
        q ? (
          <EmptyState icon="search" title="No matches">
            Nothing in your history matches “{q}”.
          </EmptyState>
        ) : (
          <Hero id="history-empty" dismissible={false} title={<>Nothing here <em>yet</em>.</>} subtitle="Everything you dictate lands here, grouped by day, on your own server. Hold your dictation key and say something." examples={[{ from: '“um so I think we should meet at ten”', to: 'I think we should meet at 10.' }]} />
        )
      ) : (
        <div className="history">
          {shownItems.length === 0 && (
            <EmptyState icon="history" title="Nothing in this view">
              None of the loaded items are {tab === 'commands' ? 'commands' : 'dictations'}.
            </EmptyState>
          )}
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2 className="day-label">{g.label}</h2>
              <ul className="h-list list">
                {g.items.map((h) => (
                  <li className="h-item list-row" key={h.id}>
                    <div className="h-body">
                      <p className={`h-text ${raw.has(h.id) ? 'is-raw' : ''}`}>{raw.has(h.id) ? h.raw_text : h.text}</p>
                      {raw.has(h.id) && <span className="small muted">Raw transcript</span>}
                      {raw.has(h.id) && <MetaDetails item={h} />}
                      <div className="h-meta muted small">
                        {h.has_audio && player.supported && <PlayPill item={h} state={player.state} onToggle={() => player.toggle(h.id)} />}
                        <span>{formatTime(h.created_at)}</span>
                        {h.app_name && <span>{h.app_name}</span>}
                        <span>{plural(h.word_count, 'word')}</span>
                        {h.audio_ms > 0 && <span>{formatSeconds(h.audio_ms)}</span>}
                        {h.kind === 'command' && <Badge tone="accent">Command</Badge>}
                      </div>
                    </div>
                    <div className="h-actions">
                      <IconButton icon="copy" label="Copy" onClick={() => void copy(h.text)} />
                      <IconButton icon="insert" label="Insert again" onClick={() => void insert(h.text)} />
                      {archiveAvailable && <IconButton icon="archive" label="Save to archive" disabled={saving.has(h.id)} aria-busy={saving.has(h.id) || undefined} onClick={() => void saveToArchive(h.id)} />}
                      <IconButton icon="eye" label={raw.has(h.id) ? 'Show cleaned text' : 'Show raw transcript and details'} aria-pressed={raw.has(h.id)} onClick={() => toggleRaw(h.id)} />
                      <IconButton icon="trash" label="Delete" danger onClick={() => void remove(h.id)} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div ref={sentinel} className="sentinel">
            {hasMore && (
              <Button variant="ghost" busy={loadingMore} onClick={() => void loadMore()}>
                Load more
              </Button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog open={confirmClear} title="Clear all history?" body={`This permanently deletes all ${plural(total, 'dictation')} from your server. This cannot be undone.`} confirmLabel="Clear all" danger busy={clearing} onConfirm={clearAll} onCancel={() => setConfirmClear(false)} />
    </div>
  )
}

function PlayPill({ item, state, onToggle }: { item: HistoryItem; state: PlayerState; onToggle: () => void }): React.JSX.Element {
  const mine = state.id === item.id
  const status = mine ? state.status : 'idle'
  const total = mine && state.duration > 0 ? state.duration * 1000 : item.audio_ms
  const pct = total > 0 && mine ? Math.min(100, (state.time * 1000 * 100) / total) : 0
  const label = status === 'playing' ? 'Pause recording' : status === 'loading' ? 'Loading recording' : 'Play recording'
  return (
    <span className="play-wrap">
      <button type="button" className={`play-pill ${status !== 'idle' ? 'on' : ''}`} onClick={onToggle} aria-label={label} title={label} aria-busy={status === 'loading' || undefined}>
        {status === 'loading' ? <span className="spinner" aria-hidden="true" /> : <Icon name={status === 'playing' ? 'pause' : 'play'} size={13} />}
        <span className="play-time">{mine && status !== 'idle' ? `${formatTimer(state.time * 1000)} / ${formatTimer(total)}` : formatTimer(total)}</span>
      </button>
      {mine && status !== 'idle' && (
        <span className="play-bar" role="progressbar" aria-label="Playback position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <i style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  )
}

function MetaDetails({ item }: { item: HistoryItem }): React.JSX.Element | null {
  const rows = metaRows(item.meta, item.app_name)
  if (rows.length === 0) return null
  return (
    <dl className="meta-grid" aria-label="Details">
      {rows.map((r) => (
        <div key={r.label}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

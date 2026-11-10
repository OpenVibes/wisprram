import { useMemo, useState } from 'react'
import type { DictionaryEntry } from '../../../shared/api'
import { ChipsInput } from '../components/ChipsInput'
import { Hero } from '../components/Hero'
import { Icon } from '../components/Icon'
import { Button, EmptyState, ErrorInline, IconButton, Modal, PageHeader, SkeletonList, Tabs } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { errorMessage } from '../lib/format'

function EntryForm({ initial, submitLabel, onSubmit, onCancel }: { initial?: DictionaryEntry; submitLabel: string; onSubmit: (term: string, sounds: string[]) => Promise<void>; onCancel?: () => void }): React.JSX.Element {
  const [term, setTerm] = useState(initial?.term ?? '')
  const [sounds, setSounds] = useState<string[]>(initial?.sounds_like ?? [])
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    if (!term.trim() || busy) return
    setBusy(true)
    try {
      await onSubmit(term.trim(), sounds)
      if (!initial) {
        setTerm('')
        setSounds([])
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="field">
        <label htmlFor={`term-${initial?.id ?? 'new'}`}>Word or name</label>
        <input id={`term-${initial?.id ?? 'new'}`} className="input" value={term} placeholder="e.g. Kubernetes" onChange={(e) => setTerm(e.target.value)} autoFocus={!!initial} />
      </div>
      <div className="field">
        <label>Sounds like (optional)</label>
        <ChipsInput label="Sounds like" value={sounds} onChange={setSounds} placeholder="cuber netties — press Enter to add" />
      </div>
      <div className="btn-row">
        <Button type="submit" variant="primary" icon={initial ? 'check' : 'plus'} busy={busy} disabled={!term.trim()}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

export function Dictionary(): React.JSX.Element {
  const toast = useToast()
  const list = useAsync(() => window.wisprram.dictionary.list(), [])
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const items = list.data ?? []
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? items.filter((i) => i.term.toLowerCase().includes(needle) || i.sounds_like.some((x) => x.toLowerCase().includes(needle))) : items
  }, [items, query])

  const add = async (term: string, sounds: string[]): Promise<void> => {
    if (items.some((i) => i.term.toLowerCase() === term.toLowerCase())) {
      toast(`“${term}” is already in your dictionary`, 'info')
      return
    }
    try {
      const e = await window.wisprram.dictionary.add({ term, sounds_like: sounds })
      list.setData((l) => [...(l ?? []), e].sort((a, b) => a.term.localeCompare(b.term)))
      setAdding(false)
      toast('Added to dictionary')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const update = async (id: string, term: string, sounds: string[]): Promise<void> => {
    try {
      const e = await window.wisprram.dictionary.update(id, { term, sounds_like: sounds })
      list.setData((l) => (l ?? []).map((x) => (x.id === id ? e : x)).sort((a, b) => a.term.localeCompare(b.term)))
      setEditing(null)
      toast('Saved')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const remove = async (id: string): Promise<void> => {
    try {
      await window.wisprram.dictionary.remove(id)
      list.setData((l) => (l ?? []).filter((x) => x.id !== id))
      toast('Removed')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Dictionary"
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add new
          </Button>
        }
      />
      <Hero
        id="dictionary"
        title={
          <>
            Teach it <em>your</em> words.
          </>
        }
        subtitle="Names, brands and jargon get spelled the way you write them. Add a few “sounds like” hints for anything that is often misheard."
        examples={[
          { from: '“cuber netties”', to: 'Kubernetes' },
          { from: '“post gress”', to: 'PostgreSQL' },
          { from: '“shivawn”', to: 'Siobhan' }
        ]}
        action={
          <button type="button" className="btn btn-light btn-md" onClick={() => setAdding(true)}>
            Add new word
          </button>
        }
      />
      <Tabs
        label="Dictionary"
        value="all"
        onChange={() => undefined}
        tabs={[{ id: 'all', label: 'All', count: items.length }]}
        right={
          <>
            <IconButton icon="search" label={searching ? 'Hide search' : 'Search'} aria-pressed={searching} onClick={() => setSearching((v) => !v)} />
            <IconButton icon="refresh" label="Refresh" onClick={() => void list.reload()} />
          </>
        }
      />
      {(searching || query) && (
        <div className="search">
          <Icon name="search" size={16} />
          <input type="search" aria-label="Search dictionary" placeholder="Search words" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      {list.error ? (
        <ErrorInline message={list.error} onRetry={() => void list.reload()} />
      ) : list.loading && !list.data ? (
        <SkeletonList rows={3} h={68} />
      ) : items.length === 0 ? (
        <EmptyState icon="book" title="No words yet">
          Add names or technical words and they will be spelled correctly from now on.
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title="No matches">
          No word matches “{query}”.
        </EmptyState>
      ) : (
        <ul className="list">
          {shown.map((d) => (
            <li key={d.id} className={`list-row ${editing === d.id ? 'editing' : ''}`}>
              {editing === d.id ? (
                <EntryForm initial={d} submitLabel="Save" onSubmit={(t, s) => update(d.id, t, s)} onCancel={() => setEditing(null)} />
              ) : (
                <>
                  <p className="row-line" title={d.sounds_like.length ? `${d.sounds_like.join(', ')} → ${d.term}` : d.term}>
                    {d.sounds_like.length > 0 ? (
                      <>
                        <span className="row-val">{d.sounds_like.join(', ')}</span>
                        <Icon name="arrow" size={14} strokeWidth={1.8} />
                        <span className="row-key">{d.term}</span>
                      </>
                    ) : (
                      <>
                        <span className="row-key">{d.term}</span>
                        <span className="muted small">no sound-alike hints</span>
                      </>
                    )}
                  </p>
                  <div className="row-actions">
                    <IconButton icon="edit" label="Edit" onClick={() => setEditing(d.id)} />
                    <IconButton icon="trash" label="Delete" danger onClick={() => void remove(d.id)} />
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={adding} title="Add a word" onClose={() => setAdding(false)}>
        <EntryForm submitLabel="Add word" onSubmit={add} onCancel={() => setAdding(false)} />
      </Modal>
    </div>
  )
}

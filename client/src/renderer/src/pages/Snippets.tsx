import { useMemo, useState } from 'react'
import type { Snippet } from '../../../shared/api'
import { Hero } from '../components/Hero'
import { Icon } from '../components/Icon'
import { Button, EmptyState, ErrorInline, IconButton, Modal, PageHeader, SkeletonList, Tabs } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { errorMessage } from '../lib/format'

function SnippetForm({ initial, submitLabel, onSubmit, onCancel }: { initial?: Snippet; submitLabel: string; onSubmit: (trigger: string, expansion: string) => Promise<void>; onCancel?: () => void }): React.JSX.Element {
  const [trigger, setTrigger] = useState(initial?.trigger ?? '')
  const [expansion, setExpansion] = useState(initial?.expansion ?? '')
  const [busy, setBusy] = useState(false)
  const valid = trigger.trim().length > 0 && expansion.trim().length > 0
  const submit = async (): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    try {
      await onSubmit(trigger.trim(), expansion)
      if (!initial) {
        setTrigger('')
        setExpansion('')
      }
    } finally {
      setBusy(false)
    }
  }
  const sid = initial?.id ?? 'new'
  return (
    <form
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="field">
        <label htmlFor={`trig-${sid}`}>When I say</label>
        <input id={`trig-${sid}`} className="input" value={trigger} placeholder="my email" onChange={(e) => setTrigger(e.target.value)} autoFocus={!!initial} />
      </div>
      <div className="field">
        <label htmlFor={`exp-${sid}`}>Insert</label>
        <textarea id={`exp-${sid}`} className="input" rows={4} value={expansion} placeholder="Text to insert. Line breaks are kept." onChange={(e) => setExpansion(e.target.value)} />
      </div>
      <div className="btn-row">
        <Button type="submit" variant="primary" icon={initial ? 'check' : 'plus'} busy={busy} disabled={!valid}>
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

export function Snippets(): React.JSX.Element {
  const toast = useToast()
  const list = useAsync(() => window.wisprram.snippets.list(), [])
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [sorted, setSorted] = useState(false)
  const items = list.data ?? []
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const l = needle ? items.filter((i) => i.trigger.toLowerCase().includes(needle) || i.expansion.toLowerCase().includes(needle)) : items
    return sorted ? [...l].sort((a, b) => a.trigger.localeCompare(b.trigger)) : l
  }, [items, query, sorted])

  const add = async (trigger: string, expansion: string): Promise<void> => {
    if (items.some((i) => i.trigger.toLowerCase() === trigger.toLowerCase())) {
      toast(`You already have a snippet for “${trigger}”`, 'info')
      return
    }
    try {
      const s = await window.wisprram.snippets.add({ trigger, expansion })
      list.setData((l) => [...(l ?? []), s])
      setAdding(false)
      toast('Snippet added')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const update = async (id: string, trigger: string, expansion: string): Promise<void> => {
    try {
      const s = await window.wisprram.snippets.update(id, { trigger, expansion })
      list.setData((l) => (l ?? []).map((x) => (x.id === id ? s : x)))
      setEditing(null)
      toast('Saved')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const remove = async (id: string): Promise<void> => {
    try {
      await window.wisprram.snippets.remove(id)
      list.setData((l) => (l ?? []).filter((x) => x.id !== id))
      toast('Snippet deleted')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Snippets"
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add new
          </Button>
        }
      />
      <Hero
        id="snippets"
        title={
          <>
            Words you’ll <em>never</em> type twice.
          </>
        }
        subtitle="Save text you type often, like an email, a sign-off or a canned reply, then say a short phrase to drop it in."
        examples={[
          { from: '“my email”', to: 'you@example.com' },
          { from: '“sign off”', to: 'Thanks so much, talk soon!' },
          { from: '“meeting link”', to: 'https://meet.example.com/room/standup' }
        ]}
        action={
          <button type="button" className="btn btn-light btn-md" onClick={() => setAdding(true)}>
            Add new snippet
          </button>
        }
      />
      <Tabs
        label="Snippets"
        value="all"
        onChange={() => undefined}
        tabs={[{ id: 'all', label: 'All', count: items.length }]}
        right={
          <>
            <IconButton icon="search" label={searching ? 'Hide search' : 'Search'} aria-pressed={searching} onClick={() => setSearching((v) => !v)} />
            <IconButton icon="sort" label={sorted ? 'Original order' : 'Sort A to Z'} aria-pressed={sorted} onClick={() => setSorted((v) => !v)} />
            <IconButton icon="refresh" label="Refresh" onClick={() => void list.reload()} />
          </>
        }
      />
      {(searching || query) && (
        <div className="search">
          <Icon name="search" size={16} />
          <input type="search" aria-label="Search snippets" placeholder="Search snippets" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      {list.error ? (
        <ErrorInline message={list.error} onRetry={() => void list.reload()} />
      ) : list.loading && !list.data ? (
        <SkeletonList rows={3} h={68} />
      ) : items.length === 0 ? (
        <EmptyState icon="snippet" title="No snippets yet">
          Add one, for example “my email” that expands to your address.
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title="No matches">
          No snippet matches “{query}”.
        </EmptyState>
      ) : (
        <ul className="list">
          {shown.map((s) => (
            <li key={s.id} className={`list-row ${editing === s.id ? 'editing' : ''}`}>
              {editing === s.id ? (
                <SnippetForm initial={s} submitLabel="Save" onSubmit={(t, x) => update(s.id, t, x)} onCancel={() => setEditing(null)} />
              ) : (
                <>
                  <p className="row-line" title={s.expansion}>
                    <span className="row-key">{s.trigger}</span>
                    <Icon name="arrow" size={14} strokeWidth={1.8} />
                    <span className="row-val">{s.expansion.replace(/\s*\n\s*/g, ' ')}</span>
                  </p>
                  <div className="row-actions">
                    <IconButton icon="edit" label="Edit" onClick={() => setEditing(s.id)} />
                    <IconButton icon="trash" label="Delete" danger onClick={() => void remove(s.id)} />
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={adding} title="New snippet" onClose={() => setAdding(false)}>
        <SnippetForm submitLabel="Add snippet" onSubmit={add} onCancel={() => setAdding(false)} />
      </Modal>
    </div>
  )
}

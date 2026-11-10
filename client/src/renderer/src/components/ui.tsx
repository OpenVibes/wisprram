// Small presentational building blocks.
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }): React.JSX.Element {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Card({ id, title, description, actions, children, className = '' }: { id?: string; title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }): React.JSX.Element {
  return (
    <section id={id} className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p className="muted small">{description}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  icon?: IconName
  busy?: boolean
  size?: 'sm' | 'md'
}

export function Button({ variant = 'secondary', icon, busy, size = 'md', children, className = '', disabled, ...rest }: BtnProps): React.JSX.Element {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 16} /> : null}
      {children}
    </button>
  )
}

export function IconButton({ icon, label, danger, ...rest }: { icon: IconName; label: string; danger?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button type="button" className={`icon-btn ${danger ? 'danger' : ''}`} aria-label={label} data-tip={label} {...rest}>
      <Icon name={icon} size={16} />
    </button>
  )
}

export interface TabItem {
  id: string
  label: string
  count?: number
}

/** Text tabs with a dark underline on the active one and a hairline under the row. `right` holds small icon buttons. */
export function Tabs({ tabs, value, onChange, label, right }: { tabs: TabItem[]; value: string; onChange: (id: string) => void; label: string; right?: ReactNode }): React.JSX.Element {
  const onKey = (e: React.KeyboardEvent): void => {
    const i = tabs.findIndex((t) => t.id === value)
    const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : -1
    if (next < 0) return
    e.preventDefault()
    onChange(tabs[next].id)
    ;(e.currentTarget.querySelectorAll('[role=tab]')[next] as HTMLElement | undefined)?.focus()
  }
  return (
    <div className="tabs-row">
      <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} className={t.id === value ? 'on' : ''} onClick={() => onChange(t.id)}>
            {t.label}
            {t.count !== undefined && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>
      {right && <div className="tabs-right">{right}</div>}
    </div>
  )
}

/** Generic modal dialog: Esc or backdrop click closes, focus moves inside and returns to the opener. */
export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }): React.JSX.Element | null {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const focusable = box.current?.querySelector<HTMLElement>('input, textarea, select, button:not(.modal-x)')
    ;(focusable ?? box.current)?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} ref={box} tabIndex={-1}>
        <div className="modal-head">
          <h2 id={`${id}-t`}>{title}</h2>
          <button type="button" className="icon-btn modal-x" aria-label="Close" data-tip="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }): React.JSX.Element {
  const onKey = (e: React.KeyboardEvent): void => {
    const i = options.findIndex((o) => o.value === value)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      onChange(options[(i + 1) % options.length].value)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      onChange(options[(i - 1 + options.length) % options.length].value)
    }
  }
  return (
    <div className="segmented" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }): React.JSX.Element {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  )
}

/** Native checkbox with a label and optional description. Stays editable even when `dim` (looks inactive only). */
export function Checkbox({ checked, onChange, label, description, dim }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; dim?: boolean }): React.JSX.Element {
  return (
    <label className={`check ${dim ? 'dim' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-text">
        <span className="check-label">{label}</span>
        {description && <span className="muted small">{description}</span>}
      </span>
    </label>
  )
}

/** Row used in settings cards: title/description on the left, control on the right. */
export function Row({ title, description, children, htmlFor }: { title: string; description?: ReactNode; children?: ReactNode; htmlFor?: string }): React.JSX.Element {
  return (
    <div className="row">
      <div className="row-text">
        <label htmlFor={htmlFor} className="row-title">
          {title}
        </label>
        {description && <div className="muted small">{description}</div>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  )
}

export function KeyCaps({ keys, size = 'md' }: { keys: string[]; size?: 'sm' | 'md' }): React.JSX.Element {
  return (
    <span className={`keycaps ${size}`}>
      {keys.map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  )
}

export function Skeleton({ w, h = 14, r = 6, className = '' }: { w?: number | string; h?: number | string; r?: number; className?: string }): React.JSX.Element {
  return <span className={`skeleton ${className}`} style={{ width: w ?? '100%', height: h, borderRadius: r }} aria-hidden="true" />
}

export function SkeletonList({ rows = 4, h = 64 }: { rows?: number; h?: number }): React.JSX.Element {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={h} r={14} />
      ))}
    </div>
  )
}

export function ErrorInline({ message, onRetry }: { message: string; onRetry?: () => void }): React.JSX.Element {
  return (
    <div className="error-inline" role="alert">
      <Icon name="alert" size={18} />
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" icon="refresh" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }): React.JSX.Element {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={26} />
      </div>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  )
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'; children: ReactNode }): React.JSX.Element {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function LevelBar({ level, active }: { level: number; active: boolean }): React.JSX.Element {
  return (
    <div className={`level ${active ? 'active' : ''}`} role="meter" aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      <div className="level-fill" style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  )
}

/** Modal confirm dialog: focuses the safe button, Esc cancels, focus returns to the opener. */
export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel }: { open: boolean; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void }): React.JSX.Element | null {
  const id = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [open, onCancel])
  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-b`}>
        <h2 id={`${id}-t`}>{title}</h2>
        <p id={`${id}-b`} className="muted">
          {body}
        </p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="btn btn-secondary btn-md" onClick={onCancel}>
            Cancel
          </button>
          <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

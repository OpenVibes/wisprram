import { useState, type ReactNode } from 'react'
import { dismissHero, isHeroDismissed } from '../lib/hero'
import { Icon } from './Icon'

export interface HeroExample {
  /** what you say / what is heard, shown in italics */
  from: string
  /** what you get */
  to: string
}

/**
 * Page banner: a dark card with a blurred multi-colour backdrop (pure CSS), a big serif headline with one
 * italic word, a sub-line, example chips and an action. Dismissal is remembered per `id`.
 */
export function Hero({ id, title, subtitle, examples, action, dismissible = true }: { id: string; title: ReactNode; subtitle: ReactNode; examples?: HeroExample[]; action?: ReactNode; dismissible?: boolean }): React.JSX.Element | null {
  const [gone, setGone] = useState(() => dismissible && isHeroDismissed(id))
  if (gone) return null
  return (
    <section className="hero" aria-label="Tip">
      <div className="hero-bg" aria-hidden="true" />
      {dismissible && (
        <button
          type="button"
          className="hero-x"
          aria-label="Dismiss"
          data-tip="Dismiss"
          onClick={() => {
            dismissHero(id)
            setGone(true)
          }}
        >
          <Icon name="x" size={16} strokeWidth={2} />
        </button>
      )}
      <h2 className="hero-title">{title}</h2>
      <p className="hero-sub">{subtitle}</p>
      {examples && examples.length > 0 && (
        <ul className="hero-examples">
          {examples.map((e) => (
            <li key={e.from}>
              <span className="hero-chip from">{e.from}</span>
              <Icon name="arrow" size={14} strokeWidth={2} />
              <span className="hero-chip to">{e.to}</span>
            </li>
          ))}
        </ul>
      )}
      {action && <div className="hero-action">{action}</div>}
    </section>
  )
}

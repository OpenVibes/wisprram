import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

type Kind = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  message: string
  kind: Kind
  action?: ToastAction
}
export interface ToastAction {
  label: string
  onClick: () => void
}
type ToastFn = (message: string, kind?: Kind, action?: ToastAction) => void

const Ctx = createContext<ToastFn>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setItems((l) => l.filter((t) => t.id !== id))
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
  }, [])

  const toast = useCallback<ToastFn>(
    (message, kind = 'success', action) => {
      const id = ++seq.current
      setItems((l) => [...l.slice(-3), { id, message, kind, action }])
      timers.current.set(id, setTimeout(() => dismiss(id), action ? 7000 : kind === 'error' ? 5000 : 2600))
    },
    [dismiss]
  )

  useEffect(() => {
    const m = timers.current
    return () => m.forEach(clearTimeout)
  }, [])

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'info' ? 'info' : 'check'} size={16} />
            <span>{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action?.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastFn {
  return useContext(Ctx)
}

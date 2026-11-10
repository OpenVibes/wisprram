import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../lib/format'

export interface AsyncState<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  /** Re-run the loader. `silent` keeps current data on screen (no skeleton). */
  reload(silent?: boolean): Promise<void>
  setData(updater: T | ((prev: T | undefined) => T | undefined)): void
}

/** Runs `fn` on mount and whenever `deps` change; ignores stale responses. */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[] = []): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const runId = useRef(0)
  const alive = useRef(true)

  const run = useCallback(async (silent = false) => {
    const id = ++runId.current
    if (!silent) setLoading(true)
    try {
      const v = await fnRef.current()
      if (!alive.current || id !== runId.current) return
      setDataState(v)
      setError(null)
    } catch (e) {
      if (!alive.current || id !== runId.current) return
      setError(errorMessage(e))
    } finally {
      if (alive.current && id === runId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void run()
    return () => {
      alive.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const setData = useCallback((u: T | ((prev: T | undefined) => T | undefined)) => {
    setDataState((prev) => (typeof u === 'function' ? (u as (p: T | undefined) => T | undefined)(prev) : u))
  }, [])

  return { data, error, loading, reload: run, setData }
}

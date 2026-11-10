import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../lib/format'

export interface PlayerState {
  id: string | null
  status: 'idle' | 'loading' | 'playing' | 'paused'
  /** seconds */
  time: number
  /** seconds; 0 until known */
  duration: number
}

const IDLE: PlayerState = { id: null, status: 'idle', time: 0, duration: 0 }

/**
 * One shared <audio> element for the History list. Recordings are fetched lazily through
 * `history.getAudio`, turned into Blob URLs (cached per id) and revoked on unmount.
 * Starting another item stops the current one.
 */
export function useHistoryAudio(onError: (message: string) => void): {
  supported: boolean
  state: PlayerState
  toggle: (id: string) => void
  forget: (id: string) => void
} {
  const supported = typeof window !== 'undefined' && typeof window.wisprram?.history?.getAudio === 'function'
  const [state, setState] = useState<PlayerState>(IDLE)
  const audio = useRef<HTMLAudioElement | null>(null)
  const urls = useRef(new Map<string, string>())
  const current = useRef<string | null>(null)
  const token = useRef(0)
  const stateRef = useRef(state)
  stateRef.current = state
  const errRef = useRef(onError)
  errRef.current = onError

  const reset = useCallback(() => {
    current.current = null
    setState(IDLE)
  }, [])

  const ensure = useCallback((): HTMLAudioElement => {
    if (audio.current) return audio.current
    const a = new Audio()
    a.preload = 'auto'
    const patch = (p: Partial<PlayerState>): void => setState((s) => (current.current && s.id === current.current ? { ...s, ...p } : s))
    a.addEventListener('playing', () => patch({ status: 'playing' }))
    a.addEventListener('pause', () => {
      if (a.paused && !a.ended) patch({ status: 'paused' })
    })
    a.addEventListener('timeupdate', () => patch({ time: a.currentTime }))
    a.addEventListener('loadedmetadata', () => patch({ duration: Number.isFinite(a.duration) ? a.duration : 0 }))
    a.addEventListener('durationchange', () => patch({ duration: Number.isFinite(a.duration) ? a.duration : 0 }))
    a.addEventListener('ended', reset)
    a.addEventListener('error', () => {
      if (!current.current) return
      reset()
      errRef.current('This recording could not be played.')
    })
    audio.current = a
    return a
  }, [reset])

  const toggle = useCallback(
    (id: string) => {
      const fetcher = window.wisprram.history.getAudio
      if (!fetcher) return
      const a = ensure()
      const s = stateRef.current
      if (s.id === id && s.status === 'playing') {
        a.pause()
        return
      }
      if (s.id === id && s.status === 'paused') {
        void a.play().catch((e) => errRef.current(errorMessage(e, 'Could not play this recording.')))
        return
      }
      if (s.id === id && s.status === 'loading') return

      const mine = ++token.current
      current.current = null
      a.pause()
      setState({ id, status: 'loading', time: 0, duration: 0 })
      void (async () => {
        try {
          let url = urls.current.get(id)
          if (!url) {
            const { data, mimeType } = await fetcher.call(window.wisprram.history, id)
            if (mine !== token.current) return
            url = URL.createObjectURL(new Blob([data], { type: mimeType }))
            urls.current.set(id, url)
          }
          current.current = id
          a.src = url
          a.currentTime = 0
          await a.play()
        } catch (e) {
          if (mine !== token.current) return
          reset()
          errRef.current(errorMessage(e, 'Could not load this recording.'))
        }
      })()
    },
    [ensure, reset]
  )

  const forget = useCallback(
    (id: string) => {
      const url = urls.current.get(id)
      if (stateRef.current.id === id) {
        token.current++
        audio.current?.pause()
        reset()
      }
      if (url) {
        URL.revokeObjectURL(url)
        urls.current.delete(id)
      }
    },
    [reset]
  )

  useEffect(() => {
    const map = urls.current
    return () => {
      token.current++
      const a = audio.current
      if (a) {
        a.pause()
        a.removeAttribute('src')
        a.load()
      }
      map.forEach((u) => URL.revokeObjectURL(u))
      map.clear()
    }
  }, [])

  return { supported, state, toggle, forget }
}

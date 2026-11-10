import { useEffect, useRef } from 'react'

/** Scrolling bar waveform. Heights are written straight to the DOM from rAF (no React re-render per frame). */
export function Waveform({ bars, getLevel, running }: { bars: number; getLevel: () => number; running: boolean }): React.JSX.Element {
  const root = useRef<HTMLSpanElement>(null)
  const getRef = useRef(getLevel)
  getRef.current = getLevel

  useEffect(() => {
    const el = root.current
    if (!el || !running) return
    const nodes = Array.from(el.children) as HTMLElement[]
    const hist = new Array<number>(bars).fill(0)
    let raf = 0
    let last = 0
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const frame = (t: number): void => {
      raf = requestAnimationFrame(frame)
      if (t - last < 45) return // ~22 fps scroll keeps the motion calm
      last = t
      hist.shift()
      hist.push(getRef.current())
      for (let i = 0; i < nodes.length; i++) {
        // taper the left edge so the wave fades in
        const edge = 0.45 + 0.55 * Math.min(1, (i + 1) / 4)
        const v = Math.max(0.12, Math.min(1, hist[i] * edge))
        nodes[i].style.transform = `scaleY(${reduce ? 0.3 + v * 0.3 : v})`
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [bars, running])

  return (
    <span className="wave" ref={root} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  )
}

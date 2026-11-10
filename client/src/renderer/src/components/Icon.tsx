// Hand-written inline SVG icons (24x24 grid, stroke based).
const PATHS = {
  logo: 'M4 13h2.5M8.5 9v8M12.5 5v14M16.5 8v8M20 11v2',
  home: 'M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z',
  history: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4M12 8v4.5l3 1.8',
  book: 'M5 5a2 2 0 0 1 2-2h12v15H7a2 2 0 0 0-2 2zm0 14a2 2 0 0 0 2 2h12M9 7.5h6',
  snippet: 'M8 4H6a2 2 0 0 0-2 2v2m16 0V6a2 2 0 0 0-2-2h-2M8 20H6a2 2 0 0 1-2-2v-2m16 0v2a2 2 0 0 1-2 2h-2M8 10h8M8 14h5',
  style: 'M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9zM18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 13.5l1.4 1.1-1.5 2.6-1.7-.5a7 7 0 0 1-1.6.9l-.3 1.8h-3l-.3-1.8a7 7 0 0 1-1.6-.9l-1.7.5-1.5-2.6 1.4-1.1a7 7 0 0 1 0-1.8L5.1 10.6l1.5-2.6 1.7.5a7 7 0 0 1 1.6-.9l.3-1.8h3l.3 1.8a7 7 0 0 1 1.6.9l1.7-.5 1.5 2.6-1.4 1.1a7 7 0 0 1 0 1.8z',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3',
  insert: 'M12 3v11m0 0-4-4m4 4 4-4M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  chevron: 'M9 6l6 6-6 6',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.7a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4z',
  eyeOff: 'M3 3l18 18M10.6 6a9 9 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a16 16 0 0 1-3.3 4M6.5 7.6A15.6 15.6 0 0 0 2.5 12S6 18.1 12 18.1c1.3 0 2.5-.3 3.5-.7M9.9 9.9a3 3 0 0 0 4.2 4.2',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4',
  alert: 'M12 4 3 19.5h18zM12 10v4.5M12 17.2v.1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8v.1',
  wifi: 'M3 9.5a14 14 0 0 1 18 0M6 13a9.5 9.5 0 0 1 12 0M9.2 16.4a5 5 0 0 1 5.6 0M12 19.5v.1',
  bolt: 'M13 3 5 13.5h6L10 21l8-10.5h-6z',
  play: 'M8 5.5v13l11-6.5z',
  stop: 'M7 7h10v10H7z',
  refresh: 'M20 11a8 8 0 0 0-14-4.5L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14 4.5l2-2M20 20v-4.5h-4.5',
  keyboard: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5zM7 10h.1M10 10h.1M13 10h.1M16 10h.1M7 14h10',
  external: 'M14 4h6v6M20 4 10.5 13.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  server: 'M5 4h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM5 13h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1zM8 7.5h.1M8 16.5h.1',
  cpu: 'M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  shield: 'M12 3 5 6v5.5c0 4.2 2.8 7.6 7 9.5 4.2-1.9 7-5.3 7-9.5V6z',
  flame: 'M12 21c3.5 0 6-2.4 6-5.8 0-2.6-1.6-4.4-3-6-.4 1.4-1.2 2.2-2.2 2.6.3-3-.8-5.6-3.3-7.8C9.4 7.2 6 10.2 6 15.2 6 18.6 8.5 21 12 21z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
  type: 'M5 7V5h14v2M12 5v14M9 19h6',
  moon: 'M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2z',
  sort: 'M8 19V5m0 0L4.5 8.5M8 5l3.5 3.5M16 5v14m0 0-3.5-3.5M16 19l3.5-3.5',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
  archive: 'M4 5h16v4H4zM5.5 9v9.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9M10 13h4',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4'
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18, className, strokeWidth = 1.7 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

import { createMockBridge } from './bridge'

declare global {
  interface Window {
    __WISPRRAM_MOCK__?: ReturnType<typeof createMockBridge>['mock']
  }
}

/** True when the page is running against the in-memory mock bridge. */
export function isMocked(): boolean {
  return typeof window !== 'undefined' && !!window.__WISPRRAM_MOCK__
}

/** Installs the mock as `window.wisprram` for `npm run ui:mock` or when no real bridge exists. */
export function installMockBridgeIfNeeded(): boolean {
  if (typeof window === 'undefined') return false
  if (import.meta.env.VITE_MOCK_BRIDGE === '1' || !window.wisprram) {
    const q = new URLSearchParams(location.search)
    const b = createMockBridge({ paired: q.get('unpaired') !== '1', seedArchive: true })
    window.wisprram = b
    window.__WISPRRAM_MOCK__ = b.mock
    // dev conveniences: ?theme=light|dark, ?unpaired=1 (start unpaired)
    const theme = q.get('theme')
    if (theme === 'light' || theme === 'dark') void b.settings.set({ theme })
    return true
  }
  return false
}

export const ROUTES = ['home', 'history', 'dictionary', 'snippets', 'style', 'settings', 'onboarding'] as const
export type Route = (typeof ROUTES)[number]

export function parseHash(hash: string): Route {
  const m = /^#\/?([a-z]+)/i.exec(hash)
  const name = m?.[1]?.toLowerCase()
  return (ROUTES as readonly string[]).includes(name ?? '') ? (name as Route) : 'home'
}

/** "#/settings/archive" → "archive" (an in-page anchor), otherwise null. */
export function parseSection(hash: string): string | null {
  const m = /^#\/?[a-z]+\/([a-z0-9-]+)/i.exec(hash)
  return m?.[1]?.toLowerCase() ?? null
}

export function navigate(route: Route, section?: string): void {
  const target = section ? `#/${route}/${section}` : `#/${route}`
  if (location.hash !== target) location.hash = target
}

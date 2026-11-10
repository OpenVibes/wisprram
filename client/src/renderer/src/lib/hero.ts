// Remembers which page banners ("hero" cards) the user dismissed. Storage can be unavailable (private mode,
// blocked site data), so every access is wrapped and the banner simply stays visible when it fails.
export const HERO_IDS = ['home', 'snippets', 'dictionary', 'style'] as const

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const heroKey = (id: string): string => `wisprram.hero.${id}`

function store(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function isHeroDismissed(id: string, s: Store | null = store()): boolean {
  try {
    return s?.getItem(heroKey(id)) === '1'
  } catch {
    return false
  }
}

export function dismissHero(id: string, s: Store | null = store()): void {
  try {
    s?.setItem(heroKey(id), '1')
  } catch {
    /* ignore */
  }
}

export function resetHeroes(ids: readonly string[] = HERO_IDS, s: Store | null = store()): void {
  for (const id of ids) {
    try {
      s?.removeItem(heroKey(id))
    } catch {
      /* ignore */
    }
  }
}

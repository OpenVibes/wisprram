import { useCallback, useEffect, useState } from 'react'
import type { ArchiveEntry } from '../../../shared/ipc'
import { errorMessage } from '../lib/format'

/** The archive bridge, or undefined when the main process does not provide it (older app build). */
export function getArchiveBridge(): NonNullable<typeof window.wisprram.archive> | undefined {
  return typeof window !== 'undefined' ? window.wisprram?.archive : undefined
}

export function hasArchive(): boolean {
  return !!getArchiveBridge()
}

/** Resolved archive folder (default or chosen). Re-reads when `key` changes (e.g. the archiveDir setting). */
export function useArchiveFolder(key: unknown): { folder: string | null; error: string | null } {
  const [folder, setFolder] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const a = getArchiveBridge()
    if (!a) return
    let alive = true
    a.folder()
      .then((f) => {
        if (alive) {
          setFolder(f)
          setError(null)
        }
      })
      .catch((e) => alive && setError(errorMessage(e)))
    return () => {
      alive = false
    }
  }, [key])
  return { folder, error }
}

/** Newest-first list of archived entries; updates live through `archive.onSaved`. */
export function useRecentArchive(limit: number): { entries: ArchiveEntry[] | null; error: string | null; reload: () => void } {
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    const a = getArchiveBridge()
    if (!a) return
    a.recent(limit)
      .then((l) => {
        setEntries(l)
        setError(null)
      })
      .catch((e) => setError(errorMessage(e)))
  }, [limit])

  useEffect(() => {
    load()
    const a = getArchiveBridge()
    if (!a) return
    return a.onSaved((e) => setEntries((cur) => [e, ...(cur ?? []).filter((x) => x.path !== e.path)].slice(0, limit)))
  }, [load, limit])

  return { entries, error, reload: load }
}

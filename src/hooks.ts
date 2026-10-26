import { useEffect, useState } from 'react'
import { getPreview, keyFor } from './lib/preview'
import type { Photo } from './lib/types'

export function usePreview(photo: Photo | undefined, size: number) {
  const key = photo ? keyFor(photo, size) : ''
  const [url, setUrl] = useState<string | undefined>(photo?.thumbUrl)
  useEffect(() => {
    if (!photo) {
      setUrl(undefined)
      return
    }
    let cancelled = false
    setUrl(photo.thumbUrl)
    getPreview(photo, size)
      .then((u) => {
        if (!cancelled) setUrl(u)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return url
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = () => setMatches(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])
  return matches
}

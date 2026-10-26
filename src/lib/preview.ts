import { loadImageElement, renderPhoto, recipeKey } from './image'
import type { Photo } from './types'

const cache = new Map<string, string>()
const order: string[] = []
const pending = new Map<string, Promise<string>>()
const imageCache = new Map<string, Promise<HTMLImageElement>>()
const MAX_ENTRIES = 90

function trim() {
  while (order.length > MAX_ENTRIES) {
    const oldest = order.shift()
    if (!oldest) break
    const url = cache.get(oldest)
    if (url) URL.revokeObjectURL(url)
    cache.delete(oldest)
  }
}

export function keyFor(photo: Photo, size: number) {
  return `${photo.id}|${photo.baseVersion}|${size}|${recipeKey(photo.recipe)}`
}

function getImage(url: string) {
  let entry = imageCache.get(url)
  if (!entry) {
    entry = loadImageElement(url)
    imageCache.set(url, entry)
    entry.catch(() => imageCache.delete(url))
  }
  return entry
}

export function primeImage(url: string) {
  return getImage(url).catch(() => null)
}

export async function getPreview(photo: Photo, size: number): Promise<string> {
  if (!photo.baseUrl) return photo.thumbUrl ?? ''
  const key = keyFor(photo, size)
  const cached = cache.get(key)
  if (cached) return cached
  const inflight = pending.get(key)
  if (inflight) return inflight
  const task = (async () => {
    const img = await getImage(photo.baseUrl!)
    const canvas = renderPhoto(img, photo.recipe, { maxSize: size })
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
    if (!blob) throw new Error('render failed')
    const url = URL.createObjectURL(blob)
    cache.set(key, url)
    order.push(key)
    trim()
    return url
  })()
  pending.set(key, task)
  try {
    return await task
  } finally {
    pending.delete(key)
  }
}

export function invalidatePhoto(photoId: string) {
  for (const [key, url] of cache) {
    if (key.startsWith(`${photoId}|`)) {
      URL.revokeObjectURL(url)
      cache.delete(key)
      const i = order.indexOf(key)
      if (i >= 0) order.splice(i, 1)
    }
  }
}

/** Full-resolution render for export. */
export async function renderFull(photo: Photo, maxLongEdge: number) {
  if (!photo.baseUrl) throw new Error('no image')
  const img = await getImage(photo.baseUrl)
  return renderPhoto(img, photo.recipe, { maxSize: maxLongEdge })
}

export function clearPreviewCache() {
  for (const url of cache.values()) URL.revokeObjectURL(url)
  cache.clear()
  order.length = 0
  pending.clear()
  imageCache.clear()
}

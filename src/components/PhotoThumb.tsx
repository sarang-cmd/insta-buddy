import { usePreview } from '../hooks'
import type { Photo } from '../lib/types'

interface Props {
  photo: Photo | undefined
  size?: number
  className?: string
  alt?: string
}

export function PhotoThumb({ photo, size = 640, className, alt }: Props) {
  const url = usePreview(photo, size)
  if (!photo) return <div className={`${className ?? ''} skeleton`} />
  return (
    <img
      className={className}
      src={url}
      alt={alt ?? photo.meta.fileName}
      loading="lazy"
      draggable={false}
      style={{ opacity: url ? 1 : 0.4, transition: 'opacity .25s' }}
    />
  )
}

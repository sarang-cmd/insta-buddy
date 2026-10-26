import JSZip from 'jszip'
import { canvasToBlob, ctx2d, makeCanvas } from './image'
import { renderFull } from './preview'
import type { CaptionSet } from './captions'
import type { Photo } from './types'

export interface ExportOptions {
  longEdge: number
  includeOriginal: boolean
  format: '4:5' | '1:1' | '9:16'
  captions: CaptionSet | null
  captionText: { short: string; playful: string; story: string }
}

function safeName(text: string) {
  return text.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').toLowerCase()
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('thumb load failed'))
    img.src = url
  })
}

export async function gridCanvas(photos: Photo[], size = 1080) {
  const canvas = makeCanvas(size, size)
  const ctx = ctx2d(canvas)
  ctx.fillStyle = '#0c0b0a'
  ctx.fillRect(0, 0, size, size)
  const gap = Math.round(size * 0.006)
  const cell = (size - gap * 4) / 3
  const thumbs = photos.slice(0, 9)
  const images = await Promise.all(
    thumbs.map((p) => (p.thumbUrl ? loadImage(p.thumbUrl).catch(() => null) : Promise.resolve(null))),
  )
  for (let i = 0; i < 9; i++) {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = gap + col * (cell + gap)
    const y = gap + row * (cell + gap)
    const photo = thumbs[i]
    if (!photo) {
      ctx.fillStyle = '#171614'
      ctx.fillRect(x, y, cell, cell)
      continue
    }
    const img = images[i]
    ctx.fillStyle = '#171614'
    ctx.fillRect(x, y, cell, cell)
    if (img) {
      // cover-crop the thumb into the square
      const s = Math.max(cell / img.width, cell / img.height)
      const dw = img.width * s
      const dh = img.height * s
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, cell, cell)
      ctx.clip()
      ctx.drawImage(img, x + (cell - dw) / 2, y + (cell - dh) / 2, dw, dh)
      ctx.restore()
    }
  }
  return canvas
}

export async function exportDump(photos: Photo[], options: ExportOptions, onProgress?: (done: number, total: number) => void) {
  const zip = new JSZip()
  const imageFolder = zip.folder('photos')
  const total = photos.length + 2
  let done = 0

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i]
    const canvas = await renderFull(photo, options.longEdge)
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92)
    const name = `${String(i + 1).padStart(2, '0')}-${safeName(
      new Date(photo.meta.takenAt).toISOString().slice(0, 10),
    )}-${safeName(photo.meta.fileName.replace(/\.[^.]+$/, ''))}.jpg`
    imageFolder?.file(name, blob)
    if (options.includeOriginal) {
      imageFolder?.file(`original/${safeName(photo.meta.fileName)}`, photo.file)
    }
    done++
    onProgress?.(done, total)
  }

  if (options.captions) {
    const lines = [
      'INSTA BUDDY — DUMP KIT',
      `Format: ${options.format} · ${photos.length} frames · long edge ${options.longEdge}px`,
      '',
      '— SHORT —',
      options.captionText.short,
      '',
      '— PLAYFUL —',
      options.captionText.playful,
      '',
      '— STORY —',
      options.captionText.story,
      '',
      '— HASHTAGS —',
      options.captions.hashtags.join(' '),
      '',
      '— ALT TEXT —',
      ...options.captions.altTexts.map((a, i) => `${i + 1}. ${a.text}`),
      '',
      'Generated on-device. Nothing was uploaded.',
    ]
    zip.file('captions.txt', lines.join('\n'))
    zip.file(
      'captions.json',
      JSON.stringify(
        {
          format: options.format,
          captions: options.captionText,
          hashtags: options.captions.hashtags,
          altTexts: options.captions.altTexts,
          photos: photos.map((p, i) => ({
            index: i + 1,
            file: p.meta.fileName,
            takenAt: new Date(p.meta.takenAt).toISOString(),
            scores: p.analysis?.scores,
            suggestionsApplied: p.retouchCount,
          })),
        },
        null,
        2,
      ),
    )
    done++
    onProgress?.(done, total)
  }

  const grid = await gridCanvas(photos)
  const gridBlob = await canvasToBlob(grid, 'image/jpeg', 0.9)
  zip.file('feed-grid.jpg', gridBlob)
  done++
  onProgress?.(done, total)

  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  return blob
}

export async function exportSingle(photo: Photo, longEdge = 2048) {
  const canvas = await renderFull(photo, longEdge)
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.93)
  return blob
}

export async function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}



/** Cover-cropped thumbnail used in the compose strip. */
export function coverThumb(source: HTMLImageElement | HTMLCanvasElement, size: number) {
  const sw = 'naturalWidth' in source ? source.naturalWidth : source.width
  const sh = 'naturalHeight' in source ? source.naturalHeight : source.height
  const s = Math.max(size / sw, size / sh)
  const dw = sw * s
  const dh = sh * s
  const canvas = makeCanvas(size, size)
  const ctx = ctx2d(canvas)
  ctx.fillStyle = '#141312'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(source, (size - dw) / 2, (size - dh) / 2, dw, dh)
  return canvas
}



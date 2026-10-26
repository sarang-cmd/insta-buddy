import { ctx2d, makeCanvas, scaleToFit } from '../image'

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = url
  })
}

/** Downscale a photo URL to a JPEG data URL small enough to send to a provider. */
export async function urlToDataUrl(url: string, longEdge: number, quality = 0.86): Promise<string> {
  const img = await load(url)
  const fit = scaleToFit(img.naturalWidth || img.width, img.naturalHeight || img.height, longEdge)
  const canvas = makeCanvas(fit.w, fit.h)
  const ctx = ctx2d(canvas)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

export function canvasToDataUrl(canvas: HTMLCanvasElement, quality = 0.9): string {
  return canvas.toDataURL('image/jpeg', quality)
}

/**
 * Providers that accept a mask (OpenAI, Azure) want a PNG where the *transparent*
 * pixels mark what should be re-generated. Our brush layer is white-on-black, so
 * convert it into alpha.
 */
export function maskToProviderPng(mask: HTMLCanvasElement): string {
  const out = makeCanvas(mask.width, mask.height)
  const ctx = ctx2d(out, { willReadFrequently: true })
  const src = mask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, mask.width, mask.height)
  const dst = ctx.createImageData(mask.width, mask.height)
  for (let i = 0; i < src.data.length; i += 4) {
    const v = Math.max(src.data[i], src.data[i + 1], src.data[i + 2]) * (src.data[i + 3] / 255)
    const painted = v > 60
    dst.data[i] = 0
    dst.data[i + 1] = 0
    dst.data[i + 2] = 0
    dst.data[i + 3] = painted ? 0 : 255
  }
  ctx.putImageData(dst, 0, 0)
  return out.toDataURL('image/png')
}

export function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  return load(dataUrl)
}

export async function dataUrlToFile(dataUrl: string, fileName: string): Promise<File> {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  return new File([blob], fileName, { type: blob.type || 'image/png' })
}

export function imageBytes(dataUrl: string): number {
  const idx = dataUrl.indexOf(',')
  return idx < 0 ? 0 : Math.round(((dataUrl.length - idx - 1) * 3) / 4)
}

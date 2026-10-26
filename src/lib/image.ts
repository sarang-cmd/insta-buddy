import type { Adjust, Crop, Recipe } from './types'

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export function ctx2d(c: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings) {
  const ctx = c.getContext('2d', opts)
  if (!ctx) throw new Error('Canvas 2D unavailable')
  return ctx
}

export async function decodeFile(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Safari-ish fallback: decode via <img>
    const url = URL.createObjectURL(file)
    try {
      const img = await loadImageElement(url)
      return await createImageBitmap(img)
    } finally {
      // bitmap owns its pixels now
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
}

export function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src = url
  })
}

export function drawToCanvas(src: CanvasImageSource, w: number, h: number) {
  const c = makeCanvas(w, h)
  const ctx = ctx2d(c)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return c
}

export function scaleToFit(w: number, h: number, max: number) {
  const s = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scale: s }
}

export async function canvasToBlob(c: HTMLCanvasElement, type = 'image/jpeg', quality = 0.9) {
  return new Promise<Blob>((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality)
  })
}

export async function canvasToObjectUrl(c: HTMLCanvasElement, quality = 0.86) {
  const blob = await canvasToBlob(c, 'image/jpeg', quality)
  return URL.createObjectURL(blob)
}

/** Largest centred rect of aspect `a` that fits inside a w×h frame rotated by `deg`. */
export function inscribedRect(w: number, h: number, deg: number, a: number) {
  const rad = (Math.abs(deg) * Math.PI) / 180
  if (rad < 1e-5) return { w, h }
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const halfW = w / 2
  const halfH = h / 2

  const fits = (W: number) => {
    const H = W / a
    const cx = W / 2
    const cy = H / 2
    // rotate corners back into source space and test containment
    for (const [sx, sy] of [
      [cx, cy],
      [-cx, cy],
      [cx, -cy],
      [-cx, -cy],
    ]) {
      const px = sx * cos + sy * sin
      const py = -sx * sin + sy * cos
      if (Math.abs(px) > halfW + 0.01 || Math.abs(py) > halfH + 0.01) return false
    }
    return true
  }

  let lo = 1
  let hi = Math.max(w, h) * 2
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) lo = mid
    else hi = mid
  }
  return { w: lo, h: lo / a }
}

/** Mirrored + softened edge synthesis for generative "extend". */
function paintEdges(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  outW: number,
  outH: number,
) {
  const left = dx
  const top = dy
  const right = outW - (dx + dw)
  const bottom = outH - (dy + dh)
  const blur = Math.max(3, Math.min(dw, dh) * 0.02)

  const strip = (
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    destX: number,
    destY: number,
    destW: number,
    destH: number,
    flipX: boolean,
    flipY: boolean,
  ) => {
    if (sw <= 0 || sh <= 0 || destW <= 0 || destH <= 0) return
    const tmp = makeCanvas(Math.max(1, destW), Math.max(1, destH))
    const tctx = ctx2d(tmp)
    tctx.save()
    tctx.translate(flipX ? destW : 0, flipY ? destH : 0)
    tctx.scale(flipX ? -1 : 1, flipY ? -1 : 1)
    tctx.drawImage(src, sx, sy, sw, sh, 0, 0, destW, destH)
    tctx.restore()
    ctx.save()
    ctx.filter = `blur(${blur}px) saturate(0.94) brightness(0.99)`
    ctx.drawImage(tmp, destX, destY)
    ctx.restore()
  }

  // sample width at source scale (dx/dw are in destination space)
  const toSrc = dw / (src as HTMLCanvasElement).width || 1
  const sampleW = Math.min(dw, Math.max(8, left / toSrc + 8))
  const sampleH = Math.min(dh, Math.max(8, top / toSrc + 8))

  if (left > 0) strip(sampleW, 0, dw - sampleW, dh, 0, dy, left, dh, true, false)
  if (right > 0) strip(dw - sampleW, 0, sampleW, dh, dx + dw, dy, right, dh, true, false)
  if (top > 0) strip(0, sampleH, dw, dh - sampleH, dx, 0, dw, top, false, true)
  if (bottom > 0) strip(0, dh - sampleH, dw, sampleH, dx, dy + dh, dw, bottom, false, true)
  // corners
  if (left > 0 && top > 0) strip(0, 0, Math.max(1, dw * 0.25), Math.max(1, dh * 0.25), 0, 0, left, top, true, true)
  if (right > 0 && top > 0) strip(dw * 0.75, 0, dw * 0.25, Math.max(1, dh * 0.25), dx + dw, 0, right, top, true, true)
  if (left > 0 && bottom > 0) strip(0, dh * 0.75, Math.max(1, dw * 0.25), dh * 0.25, 0, dy + dh, left, bottom, true, true)
  if (right > 0 && bottom > 0)
    strip(dw * 0.75, dh * 0.75, Math.max(1, dw * 0.25), dh * 0.25, dx + dw, dy + dh, right, bottom, true, true)
}

function colorLuts(adj: Adjust) {
  const expo = Math.pow(2, adj.exposure / 90)
  const contrast = 1 + adj.contrast / 110
  const base = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    let v = i / 255
    v = v * expo
    v = (v - 0.5) * contrast + 0.5
    base[i] = v
  }
  // shadow lift / highlight recovery on 0..1 luma
  const lift = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const l = i / 255
    const shadowWeight = Math.pow(1 - l, 2.2)
    const highWeight = Math.pow(l, 2.2)
    lift[i] = (adj.shadows / 100) * 0.34 * shadowWeight + (adj.highlights / 100) * 0.3 * highWeight
  }
  return { base, lift }
}

export function applyColorPass(data: ImageData, adj: Adjust) {
  const { base, lift } = colorLuts(adj)
  const px = data.data
  const temp = (adj.temp / 100) * 26
  const sat = 1 + adj.saturation / 100
  const vib = adj.vibrance / 100
  const needsColor = temp !== 0 || sat !== 1 || vib !== 0
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i]
    let g = px[i + 1]
    let b = px[i + 2]
    const luma0 = (r * 0.2126 + g * 0.7152 + b * 0.0722) | 0
    const add = lift[luma0] * 255
    r = base[r] * 255 + add
    g = base[g] * 255 + add
    b = base[b] * 255 + add
    if (needsColor) {
      r += temp
      b -= temp
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      const curSat = mx <= 0 ? 0 : (mx - mn) / 255
      const f = sat + vib * (1 - curSat) * 1.1
      r = luma + (r - luma) * f
      g = luma + (g - luma) * f
      b = luma + (b - luma) * f
    }
    px[i] = r < 0 ? 0 : r > 255 ? 255 : r
    px[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g
    px[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b
  }
}

export function sharpenCanvas(c: HTMLCanvasElement, amount: number) {
  if (amount <= 0) return c
  const ctx = ctx2d(c, { willReadFrequently: true })
  const { width: w, height: h } = c
  const src = ctx.getImageData(0, 0, w, h)
  const out = new ImageData(new Uint8ClampedArray(src.data), w, h)
  const s = src.data
  const d = out.data
  const k = (amount / 100) * 1.5
  // 3x3 box blur reference, then unsharp mask
  const idx = (x: number, y: number) => (y * w + x) * 4
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = idx(x, y)
      for (let ch = 0; ch < 3; ch++) {
        const center = s[i + ch]
        let sum = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) sum += s[idx(x + dx, y + dy) + ch]
        }
        const blur = sum / 9
        const v = center + (center - blur) * k
        d[i + ch] = v < 0 ? 0 : v > 255 ? 255 : v
      }
    }
  }
  ctx.putImageData(out, 0, 0)
  return c
}

export function vignetteCanvas(c: HTMLCanvasElement, amount: number) {
  if (amount <= 0) return c
  const ctx = ctx2d(c)
  const g = ctx.createRadialGradient(
    c.width / 2,
    c.height / 2,
    Math.min(c.width, c.height) * 0.28,
    c.width / 2,
    c.height / 2,
    Math.max(c.width, c.height) * 0.72,
  )
  const strength = (amount / 100) * 0.72
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(1, `rgba(${Math.round(255 * (1 - strength))},${Math.round(255 * (1 - strength))},${Math.round(
    255 * (1 - strength),
  )},1)`)
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = g
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.restore()
  return c
}

export interface RenderOptions {
  maxSize?: number
  /** skip colour/sharpen passes, used for fast thumbnails */
  fast?: boolean
}

/**
 * Full non-destructive render: rotate → extend → crop → scale → colour.
 * Always returns a fresh canvas so callers can cache the result.
 */
export function renderPhoto(
  src: CanvasImageSource & { width: number; height: number },
  recipe: Recipe,
  opts: RenderOptions = {},
): HTMLCanvasElement {
  const maxSize = opts.maxSize ?? 1600
  const srcW = src.width
  const srcH = src.height

  // 1 — straighten with inset crop so no empty corners show
  let stage: HTMLCanvasElement
  const deg = recipe.straighten
  if (Math.abs(deg) > 0.05) {
    const rect = inscribedRect(srcW, srcH, deg, srcW / srcH)
    const out = makeCanvas(rect.w, rect.h)
    const ctx = ctx2d(out)
    ctx.imageSmoothingQuality = 'high'
    ctx.translate(out.width / 2, out.height / 2)
    ctx.rotate((deg * Math.PI) / 180)
    ctx.drawImage(src, -srcW / 2, -srcH / 2, srcW, srcH)
    stage = out
  } else {
    stage = drawToCanvas(src, srcW, srcH)
  }

  // 2 — extend to a target aspect via mirrored edge synthesis
  if (recipe.extend) {
    const ta = recipe.extend
    const curA = stage.width / stage.height
    let outW = stage.width
    let outH = stage.height
    if (ta > curA) outW = Math.round(stage.height * ta)
    else outH = Math.round(stage.width / ta)
    if (outW !== stage.width || outH !== stage.height) {
      const out = makeCanvas(outW, outH)
      const ctx = ctx2d(out)
      const dx = Math.round((outW - stage.width) / 2)
      const dy = Math.round((outH - stage.height) / 2)
      paintEdges(ctx, stage, dx, dy, stage.width, stage.height, outW, outH)
      ctx.drawImage(stage, dx, dy)
      stage = out
    }
  }

  // 3 — crop (normalised against the current stage)
  let cropped = stage
  if (recipe.crop) {
    const { x, y, w, h } = recipe.crop
    const cw = Math.max(8, Math.round(w * stage.width))
    const ch = Math.max(8, Math.round(h * stage.height))
    const cx = Math.round(clamp(x, 0, 1 - w) * stage.width)
    const cy = Math.round(clamp(y, 0, 1 - h) * stage.height)
    cropped = makeCanvas(cw, ch)
    const cctx = ctx2d(cropped)
    cctx.imageSmoothingQuality = 'high'
    cctx.drawImage(stage, cx, cy, cw, ch, 0, 0, cw, ch)
  }

  // 4 — scale down for previews, never up
  const fit = scaleToFit(cropped.width, cropped.height, maxSize)
  const out = fit.scale < 1 ? drawToCanvas(cropped, fit.w, fit.h) : cropped

  const adj = recipe.adjust
  const hasColor =
    adj.exposure || adj.contrast || adj.highlights || adj.shadows || adj.temp || adj.saturation || adj.vibrance
  if (!opts.fast) {
    if (hasColor) {
      const ctx = ctx2d(out, { willReadFrequently: true })
      const data = ctx.getImageData(0, 0, out.width, out.height)
      applyColorPass(data, adj)
      ctx.putImageData(data, 0, 0)
    }
    if (adj.sharpen > 0) sharpenCanvas(out, adj.sharpen)
    if (adj.vignette > 0) vignetteCanvas(out, adj.vignette)
  }
  return out
}

export function recipeKey(recipe: Recipe) {
  return JSON.stringify(recipe)
}

/** Crop helper: fit an aspect ratio inside the frame with subject-aware centring. */
export function cropForAspect(
  w: number,
  h: number,
  target: number,
  focusX = 0.5,
  focusY = 0.5,
): Crop {
  const cur = w / h
  if (cur > target) {
    const cw = target / cur
    const x = clamp(focusX - cw / 2, 0, 1 - cw)
    return { x, y: 0, w: cw, h: 1 }
  }
  const ch = cur / target
  const y = clamp(focusY - ch / 2, 0, 1 - ch)
  return { x: 0, y, w: 1, h: ch }
}

export function downloadUrl(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export const ASPECTS: { id: string; label: string; value: number }[] = [
  { id: '1:1', label: 'Square 1:1', value: 1 },
  { id: '4:5', label: 'Portrait 4:5', value: 4 / 5 },
  { id: '9:16', label: 'Story 9:16', value: 9 / 16 },
  { id: '3:2', label: 'Classic 3:2', value: 3 / 2 },
  { id: '16:9', label: 'Wide 16:9', value: 16 / 9 },
]

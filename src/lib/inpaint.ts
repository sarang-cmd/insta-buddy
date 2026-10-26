import { ctx2d, makeCanvas } from './image'

const PATCH = 8
const MAX_WORK = 1200

interface Region {
  x0: number
  y0: number
  w: number
  h: number
}

function maskToArray(maskCanvas: HTMLCanvasElement, region: Region, scale: number) {
  const m = makeCanvas(Math.round(region.w * scale), Math.round(region.h * scale))
  const mctx = ctx2d(m, { willReadFrequently: true })
  mctx.fillStyle = '#000'
  mctx.fillRect(0, 0, m.width, m.height)
  mctx.imageSmoothingQuality = 'high'
  mctx.drawImage(maskCanvas, region.x0, region.y0, region.w, region.h, 0, 0, m.width, m.height)
  const data = mctx.getImageData(0, 0, m.width, m.height).data
  const out = new Uint8Array(m.width * m.height)
  let count = 0
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    // painted mask may be any colour; treat anything brighter than mid-grey as a hole
    const v = Math.max(data[p], data[p + 1], data[p + 2]) * (data[p + 3] / 255)
    if (v > 60) {
      out[i] = 1
      count++
    }
  }
  return { mask: out, w: m.width, h: m.height, count }
}

function maskBounds(maskCanvas: HTMLCanvasElement, width: number, height: number): Region | null {
  const c = makeCanvas(width, height)
  const ctx = ctx2d(c, { willReadFrequently: true })
  ctx.drawImage(maskCanvas, 0, 0, width, height)
  const data = ctx.getImageData(0, 0, width, height).data
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4
      const v = Math.max(data[p], data[p + 1], data[p + 2]) * (data[p + 3] / 255)
      if (v > 60) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  const thin = Math.min(maxX - minX + 1, maxY - minY + 1)
  const pad = Math.max(24, Math.round(Math.min(140, thin * 1.6)))
  const x0 = Math.max(0, minX - pad)
  const y0 = Math.max(0, minY - pad)
  const x1 = Math.min(width - 1, maxX + pad)
  const y1 = Math.min(height - 1, maxY + pad)
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** Directional propagation + relaxation so the hole starts with plausible colour. */
function smoothFill(data: Uint8ClampedArray, mask: Uint8Array, w: number, h: number) {
  const idx = (x: number, y: number) => (y * w + x) * 4
  const accR = new Float32Array(w * h)
  const accG = new Float32Array(w * h)
  const accB = new Float32Array(w * h)
  const accN = new Float32Array(w * h)
  const push = (x: number, y: number, r: number, g: number, b: number) => {
    const i = y * w + x
    accR[i] += r
    accG[i] += g
    accB[i] += b
    accN[i] += 1
  }

  for (let y = 0; y < h; y++) {
    let lr = -1
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i]) lr = idx(x, y)
      else if (lr >= 0) push(x, y, data[lr], data[lr + 1], data[lr + 2])
    }
    let rl = -1
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!mask[i]) rl = idx(x, y)
      else if (rl >= 0) push(x, y, data[rl], data[rl + 1], data[rl + 2])
    }
  }
  for (let x = 0; x < w; x++) {
    let tb = -1
    for (let y = 0; y < h; y++) {
      const i = y * w + x
      if (!mask[i]) tb = idx(x, y)
      else if (tb >= 0) push(x, y, data[tb], data[tb + 1], data[tb + 2])
    }
    let bt = -1
    for (let y = h - 1; y >= 0; y--) {
      const i = y * w + x
      if (!mask[i]) bt = idx(x, y)
      else if (bt >= 0) push(x, y, data[bt], data[bt + 1], data[bt + 2])
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || accN[i] === 0) continue
    const p = i * 4
    data[p] = accR[i] / accN[i]
    data[p + 1] = accG[i] / accN[i]
    data[p + 2] = accB[i] / accN[i]
    data[p + 3] = 255
  }

  // relax to remove the directional streaks
  for (let iter = 0; iter < 26; iter++) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (!mask[i]) continue
        const p = i * 4
        for (let ch = 0; ch < 3; ch++) {
          const avg =
            (data[p - 4 + ch] + data[p + 4 + ch] + data[p - w * 4 + ch] + data[p + w * 4 + ch]) * 0.25
          data[p + ch] = data[p + ch] * 0.35 + avg * 0.65
        }
      }
    }
  }
}

function addGrain(data: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, rng: () => number, amount: number) {
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue
    const p = i * 4
    const n = (rng() - 0.5) * amount * 2
    data[p] = Math.max(0, Math.min(255, data[p] + n))
    data[p + 1] = Math.max(0, Math.min(255, data[p + 1] + n))
    data[p + 2] = Math.max(0, Math.min(255, data[p + 2] + n))
  }
}

/** Soften the boundary between synthesised and original pixels so no hard seam shows. */
function featherHole(data: Uint8ClampedArray, mask: Uint8Array, w: number, h: number) {
  for (let pass = 0; pass < 2; pass++) {
    const border: number[] = []
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (!mask[i]) continue
        const edge = !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]
        if (edge) border.push(i)
      }
    }
    for (const i of border) {
      const p = i * 4
      for (let ch = 0; ch < 3; ch++) {
        const avg =
          (data[p - 4 + ch] * 1.4 + data[p + 4 + ch] * 1.4 + data[p - w * 4 + ch] * 1.4 + data[p + w * 4 + ch] * 1.4 + data[p + ch] * 2.4) /
          8
        data[p + ch] = data[p + ch] * 0.55 + avg * 0.45
      }
    }
  }
}

function integralMask(mask: Uint8Array, w: number, h: number) {
  const integral = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += mask[y * w + x]
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum
    }
  }
  return (x: number, y: number, pw: number, ph: number) => {
    const x2 = Math.min(w, x + pw)
    const y2 = Math.min(h, y + ph)
    const a = integral[y * (w + 1) + x]
    const b = integral[y * (w + 1) + x2]
    const c = integral[y2 * (w + 1) + x]
    const d = integral[y2 * (w + 1) + x2]
    return d - b - c + a
  }
}

const SAMPLE_OFFSETS = [0, 2, 4, 6]

/** PatchMatch-style synthesis, constrained to pixels we actually know. */
function patchSynthesis(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  w: number,
  h: number,
  rng: () => number,
  iterations = 5,
) {
  const gw = Math.max(1, Math.floor(w / PATCH))
  const gh = Math.max(1, Math.floor(h / PATCH))
  const patchKnown = integralMask(mask, w, h)
  const offsets = new Int32Array(gw * gh * 2).fill(-1)

  const validSource = (sx: number, sy: number) =>
    sx >= 0 && sy >= 0 && sx + PATCH <= w && sy + PATCH <= h && patchKnown(sx, sy, PATCH, PATCH) === 0
  const targetNeedsFill = (x: number, y: number) => patchKnown(x, y, PATCH, PATCH) > 0

  const sources: number[] = []
  for (let sy = 0; sy + PATCH <= h; sy += PATCH) {
    for (let sx = 0; sx + PATCH <= w; sx += PATCH) {
      if (validSource(sx, sy)) sources.push(sy * w + sx)
    }
  }
  if (sources.length < 12) return

  const targets: { gx: number; gy: number }[] = []
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (targetNeedsFill(gx * PATCH, gy * PATCH)) targets.push({ gx, gy })
    }
  }
  if (!targets.length) return

  const randomSource = () => {
    const px = sources[Math.floor(rng() * sources.length)]
    return { x: px % w, y: Math.floor(px / w) }
  }

  const cost = (tx: number, ty: number, sx: number, sy: number) => {
    if (!validSource(sx, sy)) return Infinity
    let sum = 0
    let count = 0
    for (let py = 0; py < PATCH; py += 2) {
      const rowT = (ty + py) * w
      const rowS = (sy + py) * w
      for (const px of SAMPLE_OFFSETS) {
        const ti = rowT + tx + px
        if (mask[ti]) continue
        const si = rowS + sx + px
        const p = ti * 4
        const q = si * 4
        const dr = data[p] - data[q]
        const dg = data[p + 1] - data[q + 1]
        const db = data[p + 2] - data[q + 2]
        sum += dr * dr + dg * dg + db * db
        count++
      }
    }
    return count === 0 ? 0 : sum / count
  }

  const getOff = (gx: number, gy: number) => {
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return null
    const i = (gy * gw + gx) * 2
    if (offsets[i] < 0) return null
    return { x: offsets[i], y: offsets[i + 1] }
  }
  const setOff = (gx: number, gy: number, x: number, y: number) => {
    const i = (gy * gw + gx) * 2
    offsets[i] = x
    offsets[i + 1] = y
  }

  for (const t of targets) {
    const s = randomSource()
    setOff(t.gx, t.gy, s.x, s.y)
  }

  for (let iter = 0; iter < iterations; iter++) {
    const forward = iter % 2 === 0
    const order = forward ? targets : [...targets].reverse()
    for (const t of order) {
      const tx = t.gx * PATCH
      const ty = t.gy * PATCH
      let best = getOff(t.gx, t.gy) ?? randomSource()
      let bestCost = cost(tx, ty, best.x, best.y)

      const neighbours = forward
        ? [
            getOff(t.gx - 1, t.gy),
            getOff(t.gx, t.gy - 1),
          ]
        : [
            getOff(t.gx + 1, t.gy),
            getOff(t.gx, t.gy + 1),
          ]
      for (const nb of neighbours) {
        if (!nb) continue
        const shifted = forward ? { x: nb.x + PATCH, y: nb.y } : { x: nb.x - PATCH, y: nb.y }
        const shiftedY = forward ? { x: nb.x, y: nb.y + PATCH } : { x: nb.x, y: nb.y - PATCH }
        for (const cand of [shifted, shiftedY]) {
          const c = cost(tx, ty, cand.x, cand.y)
          if (c < bestCost) {
            bestCost = c
            best = cand
          }
        }
      }

      let radius = Math.max(w, h) / 2
      while (radius > 1) {
        const cand = {
          x: Math.round(best.x + (rng() * 2 - 1) * radius),
          y: Math.round(best.y + (rng() * 2 - 1) * radius),
        }
        const c = cost(tx, ty, cand.x, cand.y)
        if (c < bestCost) {
          bestCost = c
          best = cand
        }
        radius *= 0.5
      }
      setOff(t.gx, t.gy, best.x, best.y)
    }
  }

  // vote from every overlapping target patch, weighted toward patch centres
  const accR = new Float32Array(w * h)
  const accG = new Float32Array(w * h)
  const accB = new Float32Array(w * h)
  const accW = new Float32Array(w * h)
  for (const t of targets) {
    const off = getOff(t.gx, t.gy)
    if (!off) continue
    for (let py = 0; py < PATCH; py++) {
      const ty = t.gy * PATCH + py
      if (ty >= h) break
      const sy = Math.min(h - 1, off.y + py)
      for (let px = 0; px < PATCH; px++) {
        const tx = t.gx * PATCH + px
        if (tx >= w) break
        const ti = ty * w + tx
        if (!mask[ti]) continue
        const sx = Math.min(w - 1, off.x + px)
        const si = sy * w + sx
        const wx = 1 - Math.abs(px - PATCH / 2) / (PATCH / 2)
        const wy = 1 - Math.abs(py - PATCH / 2) / (PATCH / 2)
        const weight = 0.15 + wx * wy
        const p = si * 4
        accR[ti] += data[p] * weight
        accG[ti] += data[p + 1] * weight
        accB[ti] += data[p + 2] * weight
        accW[ti] += weight
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || accW[i] === 0) continue
    const p = i * 4
    data[p] = accR[i] / accW[i]
    data[p + 1] = accG[i] / accW[i]
    data[p + 2] = accB[i] / accW[i]
  }
}

/** Match the fill's average colour to the ring around the hole to hide seams. */
function matchTone(data: Uint8ClampedArray, mask: Uint8Array, w: number, h: number) {
  const ringR = [0, 0, 0]
  const holeR = [0, 0, 0]
  let ringN = 0
  let holeN = 0
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x
      const p = i * 4
      if (mask[i]) {
        holeR[0] += data[p]
        holeR[1] += data[p + 1]
        holeR[2] += data[p + 2]
        holeN++
      } else {
        // ring = known pixels adjacent to the mask
        const near =
          mask[i - 1] || mask[i + 1] || mask[i - w] || mask[i + w] || mask[i - 2 * w] || mask[i + 2 * w]
        if (!near) continue
        ringR[0] += data[p]
        ringR[1] += data[p + 1]
        ringR[2] += data[p + 2]
        ringN++
      }
    }
  }
  if (!holeN || !ringN) return
  for (let ch = 0; ch < 3; ch++) {
    const shift = (ringR[ch] / ringN - holeR[ch] / holeN) * 0.55
    for (let i = 0; i < w * h; i++) {
      if (!mask[i]) continue
      const p = i * 4 + ch
      data[p] = Math.max(0, Math.min(255, data[p] + shift))
    }
  }
}

export interface InpaintResult {
  canvas: HTMLCanvasElement
  filledPixels: number
}

export function inpaint(source: HTMLCanvasElement, maskCanvas: HTMLCanvasElement): InpaintResult {
  const W = source.width
  const H = source.height
  const bounds = maskBounds(maskCanvas, W, H)
  const output = makeCanvas(W, H)
  const octx = ctx2d(output)
  octx.drawImage(source, 0, 0)
  if (!bounds) return { canvas: output, filledPixels: 0 }

  const scale = Math.min(1, MAX_WORK / Math.max(bounds.w, bounds.h))
  const rw = Math.max(PATCH * 2, Math.round(bounds.w * scale))
  const rh = Math.max(PATCH * 2, Math.round(bounds.h * scale))

  const regionCanvas = makeCanvas(rw, rh)
  const rctx = ctx2d(regionCanvas, { willReadFrequently: true })
  rctx.imageSmoothingQuality = 'high'
  rctx.drawImage(source, bounds.x0, bounds.y0, bounds.w, bounds.h, 0, 0, rw, rh)
  const imageData = rctx.getImageData(0, 0, rw, rh)
  const { mask, count } = maskToArray(maskCanvas, bounds, scale)
  if (!count) return { canvas: output, filledPixels: 0 }
  // thin structures (wires, poles, cables) read cleaner with pure diffusion:
  // patch texture on a 20px band mostly produces smearing.
  const fillRatio = count / (rw * rh)

  let seed = 2166136261
  for (let i = 0; i < mask.length; i += 97) seed = (seed ^ (mask[i] + i)) * 16777619
  const rng = mulberry32(seed >>> 0)

  smoothFill(imageData.data, mask, rw, rh)
  const knownRatio = 1 - fillRatio
  // patch synthesis needs most of the neighbourhood to still be real pixels
  if (fillRatio < 0.3) {
    // narrow band: add just enough grain so the fill doesn't read as plastic
    addGrain(imageData.data, mask, rw, rh, rng, 4.5)
  } else if (knownRatio > 0.42) {
    patchSynthesis(imageData.data, mask, rw, rh, rng, 5)
    // a second, lighter pass refines texture using the first fill as structure
    patchSynthesis(imageData.data, mask, rw, rh, rng, 2)
  } else {
    // huge hole: diffusion is the honest answer, texture would just be confetti
    addGrain(imageData.data, mask, rw, rh, rng, 3)
  }
  matchTone(imageData.data, mask, rw, rh)
  featherHole(imageData.data, mask, rw, rh)
  rctx.putImageData(imageData, 0, 0)

  octx.drawImage(regionCanvas, 0, 0, rw, rh, bounds.x0, bounds.y0, bounds.w, bounds.h)
  return { canvas: output, filledPixels: count }
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Build a mask canvas pre-painted with detected wires / people boxes. */
export function autoMask(
  width: number,
  height: number,
  boxes: { x: number; y: number; w: number; h: number }[],
  lines: { x1: number; y1: number; x2: number; y2: number; kind: 'wire' | 'pole' }[],
  size = 14,
) {
  const canvas = makeCanvas(width, height)
  const ctx = ctx2d(canvas)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = '#fff'
  ctx.fillStyle = '#fff'
  ctx.lineCap = 'round'
  for (const line of lines) {
    ctx.lineWidth = line.kind === 'wire' ? size * 1.15 : size * 2.1
    ctx.beginPath()
    ctx.moveTo(line.x1 * width, line.y1 * height)
    ctx.lineTo(line.x2 * width, line.y2 * height)
    ctx.stroke()
  }
  for (const box of boxes) {
    const pad = size * 0.6
    ctx.beginPath()
    ctx.ellipse(
      (box.x + box.w / 2) * width,
      (box.y + box.h / 2) * height,
      (box.w / 2) * width + pad,
      (box.h / 2) * height + pad,
      0,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
  return canvas
}

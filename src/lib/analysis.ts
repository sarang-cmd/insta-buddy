import type { Box, LineCandidate, PhotoAnalysis, Scores } from './types'
import { clamp } from './image'

const ANALYSIS_SIZE = 448

interface Grid {
  w: number
  h: number
  gray: Float32Array
  r: Uint8ClampedArray
  g: Uint8ClampedArray
  b: Uint8ClampedArray
}

interface HoughLine {
  thetaDeg: number
  rho: number
  count: number
  // normalised endpoints
  x1: number
  y1: number
  x2: number
  y2: number
  alphaDeg: number
  length: number
}

function drawAnalysisCanvas(bitmap: ImageBitmap) {
  const scale = Math.min(1, ANALYSIS_SIZE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(32, Math.round(bitmap.width * scale))
  const h = Math.max(32, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D unavailable')
  ctx.imageSmoothingQuality = 'medium'
  ctx.drawImage(bitmap, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

function toGrid(img: ImageData): Grid {
  const { width: w, height: h, data } = img
  const n = w * h
  const gray = new Float32Array(n)
  const r = new Uint8ClampedArray(n)
  const g = new Uint8ClampedArray(n)
  const b = new Uint8ClampedArray(n)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const rr = data[p]
    const gg = data[p + 1]
    const bb = data[p + 2]
    r[i] = rr
    g[i] = gg
    b[i] = bb
    gray[i] = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb
  }
  return { w, h, gray, r, g, b }
}

function laplacianVariance(grid: Grid) {
  const { w, h, gray } = grid
  let sum = 0
  let sumSq = 0
  let count = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]
      sum += v
      sumSq += v * v
      count++
    }
  }
  const mean = sum / count
  return sumSq / count - mean * mean
}

interface HistogramStats {
  mean: number
  clippedHighlights: number
  crushedShadows: number
}

function histogramStats(grid: Grid): HistogramStats {
  const hist = new Uint32Array(256)
  const n = grid.w * grid.h
  for (let i = 0; i < n; i++) hist[Math.min(255, Math.max(0, grid.gray[i] | 0))]++
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let clipped = 0
  let crushed = 0
  for (let i = 250; i < 256; i++) clipped += hist[i]
  for (let i = 0; i < 6; i++) crushed += hist[i]
  return { mean: sum / n / 255, clippedHighlights: clipped / n, crushedShadows: crushed / n }
}

function colorfulnessStats(grid: Grid) {
  const n = grid.w * grid.h
  let sumRG = 0
  let sumYB = 0
  let sumRG2 = 0
  let sumYB2 = 0
  let satSum = 0
  for (let i = 0; i < n; i++) {
    const r = grid.r[i]
    const g = grid.g[i]
    const b = grid.b[i]
    const rg = r - g
    const yb = 0.5 * (r + g) - b
    sumRG += rg
    sumYB += yb
    sumRG2 += rg * rg
    sumYB2 += yb * yb
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    satSum += mx === 0 ? 0 : (mx - mn) / mx
  }
  const meanRG = sumRG / n
  const meanYB = sumYB / n
  const stdRG = Math.sqrt(Math.max(0, sumRG2 / n - meanRG * meanRG))
  const stdYB = Math.sqrt(Math.max(0, sumYB2 / n - meanYB * meanYB))
  const colorfulness = Math.sqrt(stdRG * stdRG + stdYB * stdYB) + 0.3 * Math.sqrt(meanRG * meanRG + meanYB * meanYB)
  return { colorfulness, saturation: satSum / n }
}

/** White-balance cast: >0 means the frame reads warm, <0 cool. */
function whiteBalanceCast(grid: Grid) {
  const n = grid.w * grid.h
  let r = 0
  let b = 0
  for (let i = 0; i < n; i++) {
    r += grid.r[i]
    b += grid.b[i]
  }
  return ((r - b) / n) / 255
}

function dHash(grid: Grid) {
  const w = 9
  const h = 8
  const small = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(grid.w - 1, Math.floor((x / w) * grid.w))
      const sy = Math.min(grid.h - 1, Math.floor((y / h) * grid.h))
      // average a small patch for stability
      let sum = 0
      let count = 0
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const px = Math.min(grid.w - 1, sx + dx)
          const py = Math.min(grid.h - 1, sy + dy)
          sum += grid.gray[py * grid.w + px]
          count++
        }
      }
      small[y * w + x] = sum / count
    }
  }
  let bits = ''
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) bits += small[y * w + x] > small[y * w + x + 1] ? '1' : '0'
  }
  let hex = ''
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

/** Coarse layout signature: 6x4 block means, min-max normalised. Survives blur and exposure shifts. */
function coarseSignature(grid: Grid) {
  const cols = 6
  const rows = 4
  const out = new Array(cols * rows).fill(0)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0
      let count = 0
      const x0 = Math.floor((c / cols) * grid.w)
      const x1 = Math.floor(((c + 1) / cols) * grid.w)
      const y0 = Math.floor((r / rows) * grid.h)
      const y1 = Math.floor(((r + 1) / rows) * grid.h)
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          sum += grid.gray[y * grid.w + x]
          count++
        }
      }
      out[r * cols + c] = count ? sum / count / 255 : 0
    }
  }
  const max = Math.max(...out)
  const min = Math.min(...out)
  const span = max - min || 1
  return out.map((v) => (v - min) / span)
}

export function coarseDistance(a: number[], b: number[]) {
  if (!a?.length || !b?.length) return 1
  let d = 0
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i])
  return d / a.length
}

function hueHistogram(grid: Grid) {
  const bins = new Array(12).fill(0)
  let count = 0
  for (let i = 0; i < grid.w * grid.h; i++) {
    const r = grid.r[i] / 255
    const g = grid.g[i] / 255
    const b = grid.b[i] / 255
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    const d = mx - mn
    if (d < 0.08 || mx < 0.12) continue
    let hue = 0
    if (mx === r) hue = ((g - b) / d) % 6
    else if (mx === g) hue = (b - r) / d + 2
    else hue = (r - g) / d + 4
    hue = (hue * 60 + 360) % 360
    bins[Math.min(11, Math.floor(hue / 30))]++
    count++
  }
  if (count === 0) return bins
  return bins.map((v) => v / count)
}

export function hamming(a: string, b: string) {
  if (a.length !== b.length) return 64
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) {
      diff += x & 1
      x >>= 1
    }
  }
  return diff
}

export function histogramDistance(a: number[], b: number[]) {
  let d = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) d += Math.abs(a[i] - b[i])
  return d / 2 // 0..1
}

function sobel(grid: Grid) {
  const { w, h, gray } = grid
  const mag = new Float32Array(w * h)
  const gx = new Float32Array(w * h)
  const gy = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const tl = gray[i - w - 1]
      const tc = gray[i - w]
      const tr = gray[i - w + 1]
      const ml = gray[i - 1]
      const mr = gray[i + 1]
      const bl = gray[i + w - 1]
      const bc = gray[i + w]
      const br = gray[i + w + 1]
      const dx = -tl + tr - 2 * ml + 2 * mr - bl + br
      const dy = -tl - 2 * tc - tr + bl + 2 * bc + br
      gx[i] = dx
      gy[i] = dy
      mag[i] = Math.sqrt(dx * dx + dy * dy)
    }
  }
  return { mag, gx, gy }
}

function detectSky(grid: Grid) {
  const { w, h, r, g, b, gray } = grid
  const rowFraction = new Float32Array(h)
  const isSky = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    let sky = 0
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const rr = r[i]
      const gg = g[i]
      const bb = b[i]
      const mx = Math.max(rr, gg, bb)
      const mn = Math.min(rr, gg, bb)
      const sat = mx === 0 ? 0 : (mx - mn) / mx
      const blueish = bb >= rr - 12 && bb >= gg - 26
      const bright = gray[i] > 118
      if (bright && (sat < 0.26 || blueish) && bb > 60) {
        isSky[i] = 1
        sky++
      }
    }
    rowFraction[y] = sky / w
  }
  let bottom = 0
  for (let y = 0; y < Math.floor(h * 0.8); y++) {
    if (rowFraction[y] > 0.5) bottom = y
    else if (bottom > 0 && rowFraction[y] < 0.2) break
  }
  const band = bottom > h * 0.04 ? { top: 0, bottom: bottom / h } : null
  return { band, fraction: band ? (band.bottom - band.top) * 0.92 : 0, rowFraction, isSky }
}

interface Peak {
  thetaDeg: number
  rho: number
  votes: number
}

function houghPeaks(mag: Float32Array, w: number, h: number) {
  const diag = Math.ceil(Math.sqrt(w * w + h * h))
  const thetaBins = 180
  const rhoBins = diag * 2 + 1
  const acc = new Uint32Array(thetaBins * rhoBins)
  const cos = new Float32Array(thetaBins)
  const sin = new Float32Array(thetaBins)
  for (let t = 0; t < thetaBins; t++) {
    const rad = (t * Math.PI) / 180
    cos[t] = Math.cos(rad)
    sin[t] = Math.sin(rad)
  }

  // adaptive threshold keeps the vote set focused on real structures
  const mags: number[] = []
  for (let i = 0; i < mag.length; i += 3) mags.push(mag[i])
  mags.sort((a, b) => a - b)
  const pct = mags[Math.floor(mags.length * 0.9)] ?? 40
  const threshold = Math.max(28, pct)
  const step = w > 260 ? 1 : 1
  let edgeCount = 0
  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      const i = y * w + x
      if (mag[i] < threshold) continue
      edgeCount++
      for (let t = 0; t < thetaBins; t++) {
        const rho = Math.round(x * cos[t] + y * sin[t]) + diag
        if (rho >= 0 && rho < rhoBins) acc[t * rhoBins + rho]++
      }
    }
  }
  if (edgeCount < 50) return { peaks: [] as Peak[], threshold, edgeCount, diag, rhoBins, thetaBins }

  const peaks: Peak[] = []
  const work = new Uint32Array(acc)
  const minVotes = Math.max(18, edgeCount * 0.012)
  for (let k = 0; k < 14; k++) {
    let best = 0
    let bestIdx = -1
    for (let i = 0; i < work.length; i++) {
      if (work[i] > best) {
        best = work[i]
        bestIdx = i
      }
    }
    if (bestIdx < 0 || best < minVotes) break
    const t = Math.floor(bestIdx / rhoBins)
    const rho = (bestIdx % rhoBins) - diag
    peaks.push({ thetaDeg: t, rho, votes: best })
    for (let dt = -4; dt <= 4; dt++) {
      const tt = (t + dt + thetaBins) % thetaBins
      for (let dr = -8; dr <= 8; dr++) {
        const rr = rho + dr + diag
        if (rr < 0 || rr >= rhoBins) continue
        work[tt * rhoBins + rr] = 0
      }
    }
  }

  // gather support points for each peak to recover endpoints
  const lines: HoughLine[] = []
  for (const p of peaks) {
    const rad = (p.thetaDeg * Math.PI) / 180
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    const dx = -s
    const dy = c
    let minT = Infinity
    let maxT = -Infinity
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x
        if (mag[i] < threshold) continue
        const rr = x * c + y * s
        if (Math.abs(rr - p.rho) > 2.2) continue
        const t = x * dx + y * dy
        if (t < minT) minT = t
        if (t > maxT) maxT = t
      }
    }
    if (!isFinite(minT) || maxT <= minT) continue
    const alphaRaw = ((p.thetaDeg + 90) % 180 + 180) % 180
    const alphaDeg = alphaRaw > 90 ? alphaRaw - 180 : alphaRaw
    const cx = p.rho * c
    const cy = p.rho * s
    const x1 = cx + minT * dx
    const y1 = cy + minT * dy
    const x2 = cx + maxT * dx
    const y2 = cy + maxT * dy
    const length = Math.hypot(x2 - x1, y2 - y1) / Math.hypot(w, h)
    lines.push({
      thetaDeg: p.thetaDeg,
      rho: p.rho,
      count: p.votes,
      x1: clamp(x1 / w),
      y1: clamp(y1 / h),
      x2: clamp(x2 / w),
      y2: clamp(y2 / h),
      alphaDeg,
      length,
    })
  }
  return { peaks, lines, threshold, edgeCount, diag, rhoBins, thetaBins }
}

function detectTilt(lines: HoughLine[], meanLumaHint: number) {
  const horizontal = lines.filter((l) => Math.abs(l.alphaDeg) <= 25 && l.length > 0.28)
  if (!horizontal.length) return { tiltDeg: 0, confidence: 0, horizonY: 0.5 }
  const bins = new Map<number, number>()
  let total = 0
  for (const l of horizontal) {
    const key = Math.round(l.alphaDeg * 2) / 2
    const weight = l.count * l.length
    bins.set(key, (bins.get(key) ?? 0) + weight)
    total += weight
  }
  let bestAngle = 0
  let bestWeight = 0
  for (const [angle] of bins) {
    let smooth = 0
    for (const [a2, w2] of bins) if (Math.abs(a2 - angle) <= 2.5) smooth += w2
    if (smooth > bestWeight) {
      bestWeight = smooth
      bestAngle = angle
    }
  }
  // weighted mean inside the dominant band for sub-degree precision
  let num = 0
  let den = 0
  for (const l of horizontal) {
    if (Math.abs(l.alphaDeg - bestAngle) <= 3) {
      const w = l.count * l.length
      num += l.alphaDeg * w
      den += w
    }
  }
  const alpha = den > 0 ? num / den : bestAngle
  // canvas rotation: positive = clockwise. A horizon falling to the right needs a CCW nudge.
  const tiltDeg = -alpha
  const dominance = bestWeight / Math.max(1e-6, total)
  let confidence = clamp(Math.min(1, bestWeight / 900) * (0.45 + dominance * 0.55))
  // extreme angles are rarely camera tilt — usually a diagonal in the scene
  if (Math.abs(tiltDeg) > 10) confidence *= 0.35
  else if (Math.abs(tiltDeg) > 6) confidence *= 0.7
  // night shots: bright light strings on dark are strong diagonal edges
  if (meanLumaHint < 0.28) confidence *= 0.6
  const strongest = horizontal.reduce((a, b) => (b.length > a.length ? b : a))
  const horizonY = (strongest.y1 + strongest.y2) / 2
  return { tiltDeg, confidence, horizonY }
}

function findWires(
  lines: HoughLine[],
  grid: Grid,
  isSky: Uint8Array,
  skyBand: { top: number; bottom: number } | null,
): LineCandidate[] {
  const { w, h, gray } = grid
  const luma = (x: number, y: number) => {
    const xi = Math.min(w - 1, Math.max(0, Math.round(x)))
    const yi = Math.min(h - 1, Math.max(0, Math.round(y)))
    return gray[yi * w + xi]
  }
  const skyAt = (x: number, y: number) => {
    const xi = Math.min(w - 1, Math.max(0, Math.round(x)))
    const yi = Math.min(h - 1, Math.max(0, Math.round(y)))
    return isSky[yi * w + xi] === 1
  }

  /**
   * A cable is a *thin dark line with brighter background on both sides*.
   * Ridges, horizons and sand lines fail this test — one side is the object itself.
   */
  const midOf = (l: HoughLine) => `(${((l.x1 + l.x2) / 2).toFixed(2)},${((l.y1 + l.y2) / 2).toFixed(2)})`
  const verify = (l: HoughLine, kind: 'wire' | 'pole') => {
    const x1 = l.x1 * w
    const y1 = l.y1 * h
    const x2 = l.x2 * w
    const y2 = l.y2 * h
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy)
    if (len < 12) return null
    const nx = -dy / len
    const ny = dx / len
    const samples = 14
    let thin = 0
    let bright = 0
    let valid = 0
    for (let i = 1; i < samples; i++) {
      const t = i / samples
      const px = x1 + dx * t
      const py = y1 + dy * t
      if (py < 2 || py > h - 3 || px < 2 || px > w - 3) continue
      valid++
      // the Hough rho can be a pixel or two off — look for the line's darkest pixel nearby
      let center = 255
      let bestOff = 0
      for (let o = -3; o <= 3; o++) {
        const l = luma(px + nx * o, py + ny * o)
        if (l < center) {
          center = l
          bestOff = o
        }
      }
      const spread = kind === 'wire' ? [5, 8] : [4, 6]
      const sides: number[] = []
      for (const o of spread) {
        sides.push(
          luma(px + nx * (bestOff + o), py + ny * (bestOff + o)),
          luma(px - nx * (o - bestOff), py - ny * (o - bestOff)),
        )
      }
      const bg = sides.reduce((a, b) => a + b, 0) / sides.length
      const minSide = Math.min(...sides)
      if (center < minSide - 8 && center < bg - 5) thin++
      if (skyAt(px, py) || skyAt(px + nx * 6, py + ny * 6) || skyAt(px - nx * 6, py - ny * 6)) bright++
    }
    if ((globalThis as any).__DEBUG_WIRES) console.log('cand', kind, l.alphaDeg.toFixed(1), l.length.toFixed(2), 'valid', valid, 'thin', (thin / Math.max(1, valid)).toFixed(2), 'sky', (bright / Math.max(1, valid)).toFixed(2), 'mid', midOf(l))
    if (valid < samples * 0.4) return null
    const thinFrac = thin / valid
    const skyFrac = bright / valid
    if (thinFrac < 0.5) return null
    // cables are photographed against sky or plain bright backdrops
    if (skyFrac < 0.35 && luma((x1 + x2) / 2, (y1 + y2) / 2) > 150) return null
    if (skyFrac < 0.2) return null
    return { thinFrac, skyFrac }
  }

  const out: LineCandidate[] = []
  const seen: { x: number; y: number }[] = []
  for (const l of lines) {
    const midY = (l.y1 + l.y2) / 2
    const midX = (l.x1 + l.x2) / 2
    const isWire = Math.abs(l.alphaDeg) <= 16 && l.length > 0.45 && l.count > 18
    const isPole = Math.abs(l.alphaDeg) >= 62 && l.length > 0.28 && l.count > 22 && midY < 0.96
    if (!isWire && !isPole) continue
    if (skyBand && midY > skyBand.bottom + 0.14) continue
    const proof = verify(l, isWire ? 'wire' : 'pole')
    if (!proof) continue
    // de-duplicate near-identical lines
    if (seen.some((c) => Math.abs(c.x - midX) < 0.02 && Math.abs(c.y - midY) < 0.018)) continue
    seen.push({ x: midX, y: midY })
    out.push({
      x1: l.x1,
      y1: l.y1,
      x2: l.x2,
      y2: l.y2,
      kind: isWire ? 'wire' : 'pole',
      strength: clamp(Math.min(1, l.count / 300) * 0.5 + proof.thinFrac * 0.3 + proof.skyFrac * 0.2),
    })
    if (out.length >= 6) break
  }
  return out
}

function detectPeople(grid: Grid, isSky: Uint8Array): Box[] {
  const { w, h, r, g, b } = grid
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const rr = r[i]
    const gg = g[i]
    const bb = b[i]
    const mx = Math.max(rr, gg, bb)
    const mn = Math.min(rr, gg, bb)
    const y = 0.299 * rr + 0.587 * gg + 0.114 * bb
    const cb = 128 - 0.168736 * rr - 0.331264 * gg + 0.5 * bb
    const cr = 128 + 0.5 * rr - 0.418688 * gg - 0.081312 * bb
    // skin in YCbCr, tolerant across skin tones and warm light
    if (y > 45 && cb >= 76 && cb <= 133 && cr >= 130 && cr <= 180 && mx - mn > 10 && rr > 55) mask[i] = 1
    else mask[i] = 0
  }

  const labels = new Int32Array(w * h).fill(-1)
  const candidates: Box[] = []
  const stack: number[] = []
  const total = w * h

  const colourDistance = (a: number[], bb: number[]) =>
    Math.sqrt((a[0] - bb[0]) ** 2 + (a[1] - bb[1]) ** 2 + (a[2] - bb[2]) ** 2)

  for (let start = 0; start < total; start++) {
    if (!mask[start] || labels[start] !== -1) continue
    let minX = w
    let maxX = 0
    let minY = h
    let maxY = 0
    let count = 0
    let sumR = 0
    let sumG = 0
    let sumB = 0
    let skyCount = 0
    labels[start] = start
    stack.push(start)
    while (stack.length) {
      const idx = stack.pop()!
      const x = idx % w
      const y = (idx / w) | 0
      count++
      if (isSky[idx]) skyCount++
      sumR += r[idx]
      sumG += g[idx]
      sumB += b[idx]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const neighbours = [
        x > 0 ? idx - 1 : -1,
        x < w - 1 ? idx + 1 : -1,
        y > 0 ? idx - w : -1,
        y < h - 1 ? idx + w : -1,
      ]
      for (const n of neighbours) {
        if (n >= 0 && mask[n] && labels[n] === -1) {
          labels[n] = start
          stack.push(n)
        }
      }
    }
    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    const areaFrac = count / total
    const boxArea = bw * bh
    const fill = count / Math.max(1, boxArea)
    const aspect = bw / bh
    // a person is a compact, mostly-filled blob of human proportions
    if (areaFrac < 0.002 || areaFrac > 0.09) continue
    if (aspect < 0.22 || aspect > 2.6) continue
    if (fill < 0.42 || fill > 0.88) continue
    if (bh / h < 0.055) continue
    if (bw / h > 0.42) continue
    // reject background: warm sky / sand reads as skin, but it blends into its surroundings
    const ring = [0, 0, 0]
    let ringN = 0
    const step = 2
    const pad = 4
    for (let x = Math.max(0, minX - pad); x <= Math.min(w - 1, maxX + pad); x += step) {
      for (const y of [minY - pad, maxY + pad]) {
        if (y < 0 || y >= h) continue
        const i = y * w + x
        if (mask[i]) continue
        ring[0] += r[i]
        ring[1] += g[i]
        ring[2] += b[i]
        ringN++
      }
    }
    for (let y = Math.max(0, minY - pad); y <= Math.min(h - 1, maxY + pad); y += step) {
      for (const x of [minX - pad, maxX + pad]) {
        if (x < 0 || x >= w) continue
        const i = y * w + x
        if (mask[i]) continue
        ring[0] += r[i]
        ring[1] += g[i]
        ring[2] += b[i]
        ringN++
      }
    }
    const mean = [sumR / count, sumG / count, sumB / count]
    // warm sunsets and cloud rims read as skin — never trust a blob that is mostly sky
    if (skyCount / count > 0.3) continue
    if ((mean[0] * 0.2126 + mean[1] * 0.7152 + mean[2] * 0.0722) > 178) continue
    const ringMean = ringN ? [ring[0] / ringN, ring[1] / ringN, ring[2] / ringN] : mean
    if (colourDistance(mean, ringMean) < 26) continue
    // skies and walls are smooth vertical gradients; faces/limbs have local structure
    const topLuma =
      (0.299 * mean[0] + 0.587 * mean[1] + 0.114 * mean[2])
    let insideEdges = 0
    let insideCount = 0
    for (let y = minY; y <= maxY; y += 2) {
      for (let x = minX; x <= maxX; x += 2) {
        const i = y * w + x
        if (!mask[i]) continue
        insideEdges += Math.abs(grid.gray[i] - grid.gray[Math.max(0, i - 2)])
        insideCount++
      }
    }
    const flatInside = insideCount > 0 && insideEdges / insideCount < 1.6
    if (flatInside && topLuma > 100 && areaFrac > 0.006) continue
    candidates.push({
      x: minX / w,
      y: minY / h,
      w: bw / w,
      h: bh / h,
      confidence: clamp(0.3 + Math.min(0.35, areaFrac * 4) + fill * 0.2, 0, 0.86),
    })
  }

  candidates.sort((a, b) => b.w * b.h - a.w * a.h)
  const merged: Box[] = []
  for (const box of candidates) {
    const hit = merged.find((m) => {
      const ix = Math.max(0, Math.min(m.x + m.w, box.x + box.w) - Math.max(m.x, box.x))
      const iy = Math.max(0, Math.min(m.y + m.h, box.y + box.h) - Math.max(m.y, box.y))
      const inter = ix * iy
      const uni = m.w * m.h + box.w * box.h - inter
      return uni > 0 && inter / uni > 0.45
    })
    if (hit) {
      const x1 = Math.min(hit.x, box.x)
      const y1 = Math.min(hit.y, box.y)
      const x2 = Math.max(hit.x + hit.w, box.x + box.w)
      const y2 = Math.max(hit.y + hit.h, box.y + box.h)
      hit.x = x1
      hit.y = y1
      hit.w = x2 - x1
      hit.h = y2 - y1
      hit.confidence = Math.min(0.9, hit.confidence + 0.06)
    } else merged.push({ ...box })
    if (merged.length >= 4) break
  }
  return merged
}

/** Small, high-contrast blobs sitting in otherwise calm areas = "object" candidates. */
function detectObjects(grid: Grid, mag: Float32Array, people: Box[]): Box[] {
  const { w, h } = grid
  const cells = 20
  const density = new Float32Array(cells * cells)
  const cw = w / cells
  const ch = h / cells
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      let sum = 0
      let count = 0
      for (let y = Math.floor(cy * ch); y < Math.min(h, Math.floor((cy + 1) * ch)); y += 2) {
        for (let x = Math.floor(cx * cw); x < Math.min(w, Math.floor((cx + 1) * cw)); x += 2) {
          sum += mag[y * w + x] > 60 ? 1 : 0
          count++
        }
      }
      density[cy * cells + cx] = count ? sum / count : 0
    }
  }
  const sorted = Array.from(density).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length * 0.5)]
  const out: Box[] = []
  for (let cy = 1; cy < cells - 1; cy++) {
    for (let cx = 1; cx < cells - 1; cx++) {
      const d = density[cy * cells + cx]
      if (d < 0.16 || d < median * 2.2) continue
      // neighbours must be calmer than this cell
      const ring = [
        density[(cy - 1) * cells + cx],
        density[(cy + 1) * cells + cx],
        density[cy * cells + cx - 1],
        density[cy * cells + cx + 1],
      ]
      const ringAvg = ring.reduce((a, b) => a + b, 0) / 4
      if (d < ringAvg * 1.8) continue
      const box = { x: cx / cells, y: cy / cells, w: 1 / cells, h: 1 / cells, confidence: clamp(d * 0.9, 0.25, 0.7) }
      const overlapsPeople = people.some(
        (p) =>
          box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y,
      )
      if (overlapsPeople) continue
      if (out.some((o) => Math.abs(o.x - box.x) < 0.1 && Math.abs(o.y - box.y) < 0.1)) continue
      out.push(box)
      if (out.length >= 3) break
    }
    if (out.length >= 3) break
  }
  return out
}

function subjectCentroid(mag: Float32Array, w: number, h: number) {
  let sx = 0
  let sy = 0
  let weight = 0
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const m = mag[y * w + x]
      if (m < 40) continue
      const wx = m * (1 - Math.abs(x / w - 0.5) * 0.5)
      sx += x * wx
      sy += y * m
      weight += wx
    }
  }
  if (!weight) return { x: 0.5, y: 0.5 }
  return { x: clamp(sx / weight / w), y: clamp(sy / weight / h) }
}

function scoreFrom(values: {
  lapVar: number
  mean: number
  clipped: number
  crushed: number
  colorfulness: number
}): Scores {
  const sharpness = clamp((Math.log10(values.lapVar + 1) - 1.0) / 1.7) * 100
  const exposure =
    clamp(1 - Math.abs(values.mean - 0.47) * 1.9 - values.clipped * 1.4 - values.crushed * 0.9) * 100
  const color = clamp((values.colorfulness - 6) / 46) * 100
  const overall = clamp(sharpness * 0.46 + exposure * 0.34 + color * 0.2, 0, 100)
  return {
    sharpness: Math.round(sharpness),
    exposure: Math.round(exposure),
    color: Math.round(color),
    overall: Math.round(overall),
  }
}

export function analyseBitmap(bitmap: ImageBitmap): PhotoAnalysis {
  const img = drawAnalysisCanvas(bitmap)
  const grid = toGrid(img)
  const { w, h } = grid
  const lapVar = laplacianVariance(grid)
  const hist = histogramStats(grid)
  const { colorfulness, saturation } = colorfulnessStats(grid)
  const wbCast = whiteBalanceCast(grid)
  const sky = detectSky(grid)
  const { mag } = sobel(grid)
  const hough = houghPeaks(mag, w, h)
  const lines = hough.lines ?? []
  const tilt = detectTilt(lines, hist.mean)
  const wires = findWires(lines, grid, sky.isSky, sky.band)
  const people = detectPeople(grid, sky.isSky)
  const objects = detectObjects(grid, mag, people)
  const subject = subjectCentroid(mag, w, h)
  const scores = scoreFrom({
    lapVar,
    mean: hist.mean,
    clipped: hist.clippedHighlights,
    crushed: hist.crushedShadows,
    colorfulness,
  })

  return {
    scores,
    phash: dHash(grid),
    hist: hueHistogram(grid),
    coarse: coarseSignature(grid),
    tiltDeg: Math.abs(tilt.tiltDeg) < 0.35 ? 0 : tilt.tiltDeg,
    tiltConfidence: tilt.confidence,
    horizonY: tilt.horizonY,
    skyFraction: sky.fraction,
    skyBand: sky.band,
    wires,
    people,
    objects,
    subjectX: subject.x,
    subjectY: subject.y,
    aspect: bitmap.width / bitmap.height,
    meanLuma: hist.mean,
    clippedHighlights: hist.clippedHighlights,
    crushedShadows: hist.crushedShadows,
    colorfulness,
    saturation,
    wbCast,
  }
}

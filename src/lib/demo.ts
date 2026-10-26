/**
 * Procedural holiday photos so the app is testable with zero uploads.
 * Each shot is painted with a seeded RNG, then rotated / blurred / exposed
 * to mimic real burst + retake behaviour (soft frames, tilted horizons, wires).
 */
import { canvasToBlob, ctx2d, makeCanvas } from './image'

type Rng = () => number

function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const range = (rng: Rng, a: number, b: number) => a + rng() * (b - a)

function skyGradient(ctx: CanvasRenderingContext2D, w: number, h: number, stops: [number, string][]) {
  const g = ctx.createLinearGradient(0, -h * 0.1, 0, h)
  stops.forEach(([p, c]) => g.addColorStop(Math.min(1, Math.max(0, p)), c))
  ctx.fillStyle = g
  ctx.fillRect(-w * 0.3, -h * 0.3, w * 1.6, h * 1.6)
}

function softCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rng: Rng, color: string, alpha = 0.5) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  for (let i = 0; i < 14; i++) {
    const cx = x + range(rng, -s, s)
    const cy = y + range(rng, -s * 0.22, s * 0.22)
    const r = range(rng, s * 0.14, s * 0.36)
    ctx.beginPath()
    ctx.ellipse(cx, cy, r, r * range(rng, 0.36, 0.62), 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function grain(canvas: HTMLCanvasElement, amount: number, rng: Rng) {
  const ctx = ctx2d(canvas, { willReadFrequently: true })
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
}

function person(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  skin: string,
  clothes: string,
  rng: Rng,
) {
  const headR = 16 * scale
  ctx.save()
  // legs
  ctx.fillStyle = '#2a2b33'
  ctx.fillRect(x - headR * 0.55, y + headR * 1.9, headR * 0.45, headR * 2.1)
  ctx.fillRect(x + headR * 0.15, y + headR * 1.9, headR * 0.45, headR * 2.1)
  // torso
  ctx.fillStyle = clothes
  ctx.beginPath()
  ctx.moveTo(x - headR * 0.95, y + headR * 2.1)
  ctx.lineTo(x + headR * 0.95, y + headR * 2.1)
  ctx.lineTo(x + headR * 0.7, y + headR * 0.85)
  ctx.lineTo(x - headR * 0.7, y + headR * 0.85)
  ctx.closePath()
  ctx.fill()
  // arms
  ctx.strokeStyle = clothes
  ctx.lineWidth = headR * 0.42
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x - headR * 0.8, y + headR * 1.05)
  ctx.lineTo(x - headR * 1.25, y + headR * 2.1)
  ctx.moveTo(x + headR * 0.8, y + headR * 1.05)
  ctx.lineTo(x + headR * 1.35 + range(rng, -4, 6), y + headR * 1.85)
  ctx.stroke()
  // hands (extra skin so the heuristic has something to find)
  ctx.fillStyle = skin
  ctx.beginPath()
  ctx.arc(x - headR * 1.25, y + headR * 2.15, headR * 0.24, 0, Math.PI * 2)
  ctx.arc(x + headR * 1.38, y + headR * 1.88, headR * 0.24, 0, Math.PI * 2)
  ctx.fill()
  // neck + head
  ctx.fillStyle = skin
  ctx.fillRect(x - headR * 0.2, y + headR * 0.7, headR * 0.4, headR * 0.4)
  ctx.beginPath()
  ctx.ellipse(x, y, headR * 0.72, headR * 0.9, 0, 0, Math.PI * 2)
  ctx.fill()
  // hair
  ctx.fillStyle = 'rgba(30,22,18,0.85)'
  ctx.beginPath()
  ctx.ellipse(x, y - headR * 0.36, headR * 0.74, headR * 0.6, 0, Math.PI, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function wires(ctx: CanvasRenderingContext2D, w: number, _h: number, y: number, count: number, rng: Rng) {
  ctx.save()
  ctx.strokeStyle = 'rgba(24,24,30,0.85)'
  for (let i = 0; i < count; i++) {
    ctx.lineWidth = range(rng, 1.6, 2.8)
    const sag = range(rng, 14, 46)
    ctx.beginPath()
    ctx.moveTo(-w * 0.1, y + i * range(rng, 12, 26))
    ctx.quadraticCurveTo(w * 0.5, y + sag + i * 18, w * 1.1, y + i * range(rng, 8, 20) + range(rng, -10, 10))
    ctx.stroke()
  }
  ctx.restore()
}

function pole(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number, width: number) {
  ctx.save()
  ctx.fillStyle = 'rgba(38,38,44,0.95)'
  ctx.fillRect(x - width / 2, top, width, bottom - top)
  ctx.fillRect(x - width * 3.5, top + width, width * 7, width * 0.7)
  ctx.restore()
}

function paintSunsetBeach(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng) {
  const horizon = h * 0.48
  skyGradient(ctx, w, h, [
    [0, '#2c3f68'],
    [0.32, '#8a6a83'],
    [0.55, '#e08e63'],
    [0.72, '#ffcf9a'],
    [1, '#f7b078'],
  ])
  const sunX = w * range(rng, 0.5, 0.68)
  const sunY = horizon - h * 0.03
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, h * 0.5)
  glow.addColorStop(0, 'rgba(255,236,190,0.95)')
  glow.addColorStop(0.16, 'rgba(255,196,132,0.55)')
  glow.addColorStop(1, 'rgba(255,170,110,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#fff3d2'
  ctx.beginPath()
  ctx.arc(sunX, sunY, h * 0.045, 0, Math.PI * 2)
  ctx.fill()
  softCloud(ctx, w * 0.25, h * 0.18, w * 0.22, rng, '#f6c9a3', 0.32)
  softCloud(ctx, w * 0.72, h * 0.3, w * 0.18, rng, '#ffd6ad', 0.26)

  const sea = ctx.createLinearGradient(0, horizon, 0, h)
  sea.addColorStop(0, '#e3a877')
  sea.addColorStop(0.18, '#a8786d')
  sea.addColorStop(0.6, '#3f5a74')
  sea.addColorStop(1, '#22394f')
  ctx.fillStyle = sea
  ctx.fillRect(-w * 0.2, horizon, w * 1.4, h - horizon)
  // sun reflection
  ctx.save()
  ctx.globalAlpha = 0.5
  for (let i = 0; i < 40; i++) {
    const t = i / 40
    const y = horizon + t * (h - horizon) * 0.85
    const width = (0.04 + t * 0.16) * w * range(rng, 0.5, 1)
    ctx.fillStyle = `rgba(255, ${Math.round(200 - t * 60)}, ${Math.round(140 - t * 40)}, ${0.5 - t * 0.28})`
    ctx.fillRect(sunX - width / 2 + range(rng, -w * 0.02, w * 0.02), y, width, 2 + t * 3)
  }
  ctx.restore()
  // wave lines
  for (let i = 0; i < 26; i++) {
    const y = horizon + Math.pow(rng(), 0.7) * (h - horizon)
    ctx.strokeStyle = `rgba(255,255,255,${0.04 + rng() * 0.1})`
    ctx.lineWidth = 1 + rng() * 2
    ctx.beginPath()
    ctx.moveTo(-w * 0.1, y)
    ctx.bezierCurveTo(w * 0.3, y + range(rng, -4, 4), w * 0.7, y + range(rng, -5, 5), w * 1.1, y)
    ctx.stroke()
  }
  // sand
  const sandTop = h * 0.9
  const sand = ctx.createLinearGradient(0, sandTop, 0, h)
  sand.addColorStop(0, '#c9a077')
  sand.addColorStop(1, '#8f6b4c')
  ctx.fillStyle = sand
  ctx.beginPath()
  ctx.moveTo(-w * 0.2, sandTop + 18)
  ctx.quadraticCurveTo(w * 0.5, sandTop - 14, w * 1.2, sandTop + 6)
  ctx.lineTo(w * 1.2, h * 1.2)
  ctx.lineTo(-w * 0.2, h * 1.2)
  ctx.closePath()
  ctx.fill()
  // palm silhouette
  if (rng() > 0.35) {
    const px = w * range(rng, 0.06, 0.16)
    ctx.strokeStyle = 'rgba(30,26,28,0.9)'
    ctx.lineWidth = 9
    ctx.beginPath()
    ctx.moveTo(px, h * 1.02)
    ctx.quadraticCurveTo(px + 26, h * 0.62, px + 44, h * 0.32)
    ctx.stroke()
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.9 + i * 0.18)
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(px + 44, h * 0.32)
      ctx.quadraticCurveTo(
        px + 44 + Math.cos(a) * 90,
        h * 0.32 + Math.sin(a) * 60,
        px + 44 + Math.cos(a) * 165,
        h * 0.32 + Math.sin(a) * 105 + 20,
      )
      ctx.stroke()
    }
  }
}

function paintCoastCliff(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng) {
  const horizon = h * 0.44
  skyGradient(ctx, w, h, [
    [0, '#4f86b8'],
    [0.5, '#95c4de'],
    [0.78, '#d7e7ee'],
    [1, '#eef1e6'],
  ])
  softCloud(ctx, w * 0.7, h * 0.16, w * 0.24, rng, '#ffffff', 0.55)
  softCloud(ctx, w * 0.24, h * 0.26, w * 0.16, rng, '#ffffff', 0.4)
  const sea = ctx.createLinearGradient(0, horizon, 0, h)
  sea.addColorStop(0, '#7fb7c9')
  sea.addColorStop(0.4, '#3d7f9b')
  sea.addColorStop(1, '#1f5470')
  ctx.fillStyle = sea
  ctx.fillRect(-w * 0.2, horizon, w * 1.4, h - horizon)
  for (let i = 0; i < 40; i++) {
    const y = horizon + Math.pow(rng(), 0.8) * (h - horizon)
    ctx.fillStyle = `rgba(255,255,255,${0.05 + rng() * 0.16})`
    ctx.fillRect(range(rng, -w * 0.1, w), y, range(rng, 20, 130), 1 + rng() * 2)
  }
  // cliff
  const cliffX = w * range(rng, 0.6, 0.78)
  ctx.fillStyle = '#5a5346'
  ctx.beginPath()
  ctx.moveTo(cliffX, h)
  ctx.lineTo(cliffX + w * 0.02, horizon + h * 0.1)
  ctx.lineTo(cliffX + w * 0.14, horizon - h * 0.06)
  ctx.lineTo(w * 1.2, horizon - h * 0.02)
  ctx.lineTo(w * 1.2, h)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(120,128,96,0.75)'
  ctx.beginPath()
  ctx.moveTo(cliffX + w * 0.02, horizon + h * 0.12)
  ctx.lineTo(cliffX + w * 0.14, horizon - h * 0.06)
  ctx.lineTo(w * 1.2, horizon - h * 0.02)
  ctx.lineTo(w * 1.2, horizon + h * 0.06)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  for (let i = 0; i < 20; i++) {
    const y = h * 0.72 + rng() * h * 0.2
    ctx.fillRect(cliffX - range(rng, 10, 70), y, range(rng, 12, 60), 2)
  }
  // foreground rocks
  ctx.fillStyle = '#3c3a33'
  ctx.beginPath()
  ctx.moveTo(-w * 0.1, h * 1.05)
  ctx.lineTo(w * 0.06, h * 0.82)
  ctx.lineTo(w * 0.2, h * 0.9)
  ctx.lineTo(w * 0.34, h * 1.05)
  ctx.closePath()
  ctx.fill()
}

function paintMountainLake(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng) {
  const horizon = h * 0.54
  skyGradient(ctx, w, h, [
    [0, '#7fa8c9'],
    [0.45, '#c3d8e2'],
    [0.75, '#e8e3cf'],
  ])
  softCloud(ctx, w * 0.3, h * 0.16, w * 0.2, rng, '#ffffff', 0.5)
  const peaks = 5
  for (let p = 0; p < peaks; p++) {
    const baseY = horizon + 4
    const cx = w * (0.1 + p * 0.22) + range(rng, -30, 30)
    const peakY = horizon - h * range(rng, 0.16, 0.4)
    const halfW = w * range(rng, 0.14, 0.26)
    const shade = 40 + p * 12
    ctx.fillStyle = `rgb(${shade + 20}, ${shade + 30}, ${shade + 44})`
    ctx.beginPath()
    ctx.moveTo(cx - halfW, baseY)
    ctx.lineTo(cx + range(rng, -20, 20), peakY)
    ctx.lineTo(cx + halfW, baseY)
    ctx.closePath()
    ctx.fill()
    if (peakY < horizon - h * 0.22) {
      ctx.fillStyle = 'rgba(250,252,255,0.85)'
      ctx.beginPath()
      ctx.moveTo(cx + range(rng, -8, 8), peakY)
      ctx.lineTo(cx + halfW * 0.14, peakY + h * 0.09)
      ctx.lineTo(cx - halfW * 0.05, peakY + h * 0.07)
      ctx.closePath()
      ctx.fill()
    }
  }
  // lake + reflection
  const lake = ctx.createLinearGradient(0, horizon, 0, h)
  lake.addColorStop(0, '#6d8fa3')
  lake.addColorStop(0.45, '#3f6076')
  lake.addColorStop(1, '#233c4d')
  ctx.fillStyle = lake
  ctx.fillRect(-w * 0.2, horizon, w * 1.4, h - horizon)
  ctx.save()
  ctx.globalAlpha = 0.18
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = '#dfeaf1'
    ctx.fillRect(w * range(rng, 0, 0.3), horizon + rng() * (h - horizon), w * range(rng, 0.1, 0.5), 1.5)
  }
  ctx.restore()
  // shoreline trees
  for (let i = 0; i < 12; i++) {
    const x = w * (i / 11) + range(rng, -14, 14)
    const th = h * range(rng, 0.06, 0.14)
    ctx.fillStyle = 'rgba(24,42,34,0.9)'
    ctx.beginPath()
    ctx.moveTo(x, h * 0.9)
    ctx.lineTo(x - th * 0.32, h * 0.9 - th * 0.2)
    ctx.lineTo(x, h * 0.9 - th)
    ctx.lineTo(x + th * 0.32, h * 0.9 - th * 0.2)
    ctx.closePath()
    ctx.fill()
  }
}

function paintCityStreet(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng) {
  const horizon = h * 0.62
  skyGradient(ctx, w, h, [
    [0, '#3d4a70'],
    [0.35, '#8a7089'],
    [0.6, '#dc9a74'],
    [0.8, '#f2c496'],
  ])
  softCloud(ctx, w * 0.6, h * 0.22, w * 0.26, rng, '#ffd8b0', 0.35)
  // skyline
  for (let i = 0; i < 9; i++) {
    const bw = w * range(rng, 0.07, 0.16)
    const bx = -w * 0.1 + i * w * 0.13 + range(rng, -12, 12)
    const bh = h * range(rng, 0.12, 0.34)
    ctx.fillStyle = `rgba(${42 + i * 3}, ${40 + i * 2}, ${52 + i * 3}, 0.94)`
    ctx.fillRect(bx, horizon - bh, bw, bh + h * 0.1)
    // windows
    for (let wy = horizon - bh + 14; wy < horizon - 10; wy += 24) {
      for (let wx = bx + 10; wx < bx + bw - 14; wx += 20) {
        if (rng() > 0.55) {
          ctx.fillStyle = `rgba(255, ${Math.round(190 + rng() * 50)}, ${Math.round(120 + rng() * 60)}, ${0.35 + rng() * 0.5})`
          ctx.fillRect(wx, wy, 8, 11)
        }
      }
    }
  }
  // street
  const street = ctx.createLinearGradient(0, horizon, 0, h)
  street.addColorStop(0, '#4b4a4d')
  street.addColorStop(1, '#232226')
  ctx.fillStyle = street
  ctx.fillRect(-w * 0.2, horizon, w * 1.4, h - horizon)
  ctx.strokeStyle = 'rgba(230,230,220,0.35)'
  ctx.setLineDash([26, 26])
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(-w * 0.1, h * 0.94)
  ctx.lineTo(w * 1.1, h * 0.94)
  ctx.stroke()
  ctx.setLineDash([])
  // lamp
  ctx.strokeStyle = 'rgba(30,30,34,0.95)'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(w * 0.14, h * 0.78)
  ctx.lineTo(w * 0.14, h * 0.3)
  ctx.quadraticCurveTo(w * 0.16, h * 0.26, w * 0.2, h * 0.27)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,214,150,0.95)'
  ctx.beginPath()
  ctx.ellipse(w * 0.2, h * 0.28, 10, 6, 0, 0, Math.PI * 2)
  ctx.fill()
  const lampGlow = ctx.createRadialGradient(w * 0.2, h * 0.29, 0, w * 0.2, h * 0.29, h * 0.22)
  lampGlow.addColorStop(0, 'rgba(255,206,140,0.55)')
  lampGlow.addColorStop(1, 'rgba(255,206,140,0)')
  ctx.fillStyle = lampGlow
  ctx.fillRect(0, 0, w, h)
  // people
  person(ctx, w * 0.42, h * 0.6, h / 260, '#c08a63', '#2f4a6b', rng)
  person(ctx, w * 0.56, h * 0.62, h / 280, '#8a5a3c', '#8e3f3f', rng)
  if (rng() > 0.5) person(ctx, w * 0.72, h * 0.64, h / 320, '#d3a179', '#3c3c44', rng)
  // overhead lines + poles
  pole(ctx, w * 0.06, h * 0.18, horizon + h * 0.06, 9)
  pole(ctx, w * 0.93, h * 0.2, horizon + h * 0.06, 8)
  wires(ctx, w, h, h * 0.2, 3, rng)
  wires(ctx, w, h, h * 0.27, 2, rng)
}

function paintRooftopNight(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng) {
  const horizon = h * 0.6
  skyGradient(ctx, w, h, [
    [0, '#0d1730'],
    [0.45, '#1d2a4a'],
    [0.72, '#4a3f63'],
    [0.85, '#8a5f63'],
  ])
  for (let i = 0; i < 90; i++) {
    const x = rng() * w
    const y = rng() * horizon
    ctx.fillStyle = `rgba(255,255,255,${0.15 + rng() * 0.7})`
    ctx.fillRect(x, y, 1.4, 1.4)
  }
  for (let i = 0; i < 30; i++) {
    const bw = w * range(rng, 0.05, 0.12)
    const bh = h * range(rng, 0.08, 0.3)
    const bx = rng() * w * 1.1 - w * 0.05
    ctx.fillStyle = `rgba(18,20,32,0.95)`
    ctx.fillRect(bx, horizon - bh, bw, bh + h * 0.2)
    for (let wy = horizon - bh + 10; wy < horizon - 6; wy += 16) {
      for (let wx = bx + 6; wx < bx + bw - 8; wx += 13) {
        if (rng() > 0.6) {
          ctx.fillStyle = `rgba(255,${Math.round(180 + rng() * 60)},${Math.round(100 + rng() * 70)},${0.4 + rng() * 0.5})`
          ctx.fillRect(wx, wy, 5, 7)
        }
      }
    }
  }
  // rooftop edge
  ctx.fillStyle = '#15161c'
  ctx.fillRect(-w * 0.2, h * 0.82, w * 1.4, h * 0.24)
  ctx.fillStyle = '#22232b'
  ctx.fillRect(-w * 0.2, h * 0.8, w * 1.4, h * 0.03)
  // string lights
  ctx.strokeStyle = 'rgba(60,60,70,0.8)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, h * 0.22)
  ctx.quadraticCurveTo(w * 0.5, h * 0.38, w, h * 0.24)
  ctx.stroke()
  for (let i = 0; i < 14; i++) {
    const t = i / 13
    const x = w * t
    const y = h * 0.22 + Math.sin(Math.PI * t) * h * 0.15
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 26)
    glow.addColorStop(0, 'rgba(255,222,160,0.95)')
    glow.addColorStop(1, 'rgba(255,222,160,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y, 26, 0, Math.PI * 2)
    ctx.fill()
  }
  person(ctx, w * 0.66, h * 0.62, h / 300, '#b47c55', '#2b2b33', rng)
}

type Scene = (ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng) => void

const SCENES: Record<string, Scene> = {
  beach: paintSunsetBeach,
  coast: paintCoastCliff,
  mountain: paintMountainLake,
  street: paintCityStreet,
  rooftop: paintRooftopNight,
}

interface ShotSpec {
  scene: keyof typeof SCENES
  /** shots sharing a moment share one painted scene — like a real burst */
  sceneSeed: number
  /** relative time in hours from trip start */
  at: number
  orientation: 'landscape' | 'portrait'
  /** framing drift in % of the frame, mimics a hand shifting between frames */
  pan?: number
  zoom?: number
  tilt?: number
  blur?: number
  brightness?: number
  caption: string
}

const SHOTS: ShotSpec[] = [
  // Day 1 morning — mountain lake, a burst of four with one soft frame
  { scene: 'mountain', sceneSeed: 101, at: 0.0, orientation: 'landscape', tilt: 2.6, blur: 1.6, brightness: 0.95, pan: -1.4, caption: 'lake-a' },
  { scene: 'mountain', sceneSeed: 101, at: 0.02, orientation: 'landscape', tilt: 2.4, blur: 0.1, brightness: 1.0, pan: 0.6, caption: 'lake-b' },
  { scene: 'mountain', sceneSeed: 101, at: 0.04, orientation: 'landscape', tilt: 2.9, blur: 2.2, brightness: 0.9, pan: 1.8, zoom: 4, caption: 'lake-c' },
  { scene: 'mountain', sceneSeed: 101, at: 0.07, orientation: 'landscape', tilt: 0.8, blur: 0.1, brightness: 1.02, pan: 2.6, caption: 'lake-d' },
  // a portrait of the same view, shot a few minutes later
  { scene: 'mountain', sceneSeed: 101, at: 0.2, orientation: 'portrait', tilt: -0.6, blur: 0.1, brightness: 1.01, pan: 0.2, caption: 'lake-portrait' },

  // Day 1 afternoon — beach sunset, five frames
  { scene: 'beach', sceneSeed: 202, at: 7.2, orientation: 'landscape', tilt: -3.4, blur: 1.2, brightness: 1.0, pan: -2, caption: 'beach-a' },
  { scene: 'beach', sceneSeed: 202, at: 7.25, orientation: 'landscape', tilt: -3.1, blur: 0.1, brightness: 1.03, pan: 0.3, caption: 'beach-b' },
  { scene: 'beach', sceneSeed: 202, at: 7.3, orientation: 'landscape', tilt: -3.0, blur: 0.1, brightness: 0.97, pan: 1.1, zoom: 3, caption: 'beach-c' },
  { scene: 'beach', sceneSeed: 202, at: 7.4, orientation: 'landscape', tilt: -3.6, blur: 2.6, brightness: 0.84, pan: 2.2, caption: 'beach-d' },
  { scene: 'beach', sceneSeed: 202, at: 8.1, orientation: 'portrait', tilt: 0.4, blur: 0.1, brightness: 1.06, pan: 0, caption: 'beach-portrait' },

  // Day 2 morning — coast, four frames
  { scene: 'coast', sceneSeed: 303, at: 26.5, orientation: 'landscape', tilt: 3.1, blur: 0.2, brightness: 1.0, pan: -1, caption: 'coast-a' },
  { scene: 'coast', sceneSeed: 303, at: 26.6, orientation: 'landscape', tilt: 3.0, blur: 1.8, brightness: 0.92, pan: 1.2, caption: 'coast-b' },
  { scene: 'coast', sceneSeed: 303, at: 26.65, orientation: 'landscape', tilt: 2.8, blur: 0.1, brightness: 1.01, pan: 2.4, zoom: 5, caption: 'coast-c' },
  { scene: 'coast', sceneSeed: 303, at: 27.6, orientation: 'portrait', tilt: -1.4, blur: 0.1, brightness: 0.97, pan: 0, caption: 'coast-portrait' },

  // Day 2 golden hour — street with overhead lines and people
  { scene: 'street', sceneSeed: 404, at: 34.0, orientation: 'landscape', tilt: -2.6, blur: 0.1, brightness: 1.0, pan: -0.8, caption: 'street-a' },
  { scene: 'street', sceneSeed: 404, at: 34.1, orientation: 'landscape', tilt: -2.4, blur: 0.1, brightness: 1.04, pan: 0.4, caption: 'street-b' },
  { scene: 'street', sceneSeed: 404, at: 34.2, orientation: 'landscape', tilt: -2.8, blur: 2.4, brightness: 0.88, pan: 1.6, caption: 'street-c' },
  { scene: 'street', sceneSeed: 404, at: 34.8, orientation: 'portrait', tilt: 1.2, blur: 0.1, brightness: 0.95, pan: 0, caption: 'street-portrait' },

  // Day 2 night — rooftop, three frames
  { scene: 'rooftop', sceneSeed: 505, at: 39.0, orientation: 'landscape', tilt: -1.2, blur: 1.1, brightness: 0.82, pan: -1, caption: 'roof-a' },
  { scene: 'rooftop', sceneSeed: 505, at: 39.05, orientation: 'landscape', tilt: -1.1, blur: 0.1, brightness: 0.95, pan: 0.8, caption: 'roof-b' },
  { scene: 'rooftop', sceneSeed: 505, at: 39.4, orientation: 'portrait', tilt: 0.2, blur: 0.1, brightness: 0.9, pan: 0, caption: 'roof-c' },
]

export const DEMO_TRIP_START = new Date()
DEMO_TRIP_START.setHours(8, 12, 0, 0)

function paintShot(spec: ShotSpec): HTMLCanvasElement {
  const rng = mulberry32(spec.sceneSeed * 7919 + 13)
  const portrait = spec.orientation === 'portrait'
  const w = portrait ? 1120 : 1400
  const h = portrait ? 1400 : 1050
  // scene is painted slightly larger than the frame so bursts can drift
  const sw = Math.round(w * 1.1)
  const sh = Math.round(h * 1.1)
  const scene = makeCanvas(sw, sh)
  const sctx = ctx2d(scene)
  SCENES[spec.scene](sctx, sw, sh, rng)

  const out = makeCanvas(w, h)
  const ctx = ctx2d(out)
  const jitter = mulberry32(spec.sceneSeed + Math.round((spec.at ?? 0) * 1000) + (spec.pan ?? 0) * 101)
  ctx.save()
  ctx.fillStyle = '#0e0e12'
  ctx.fillRect(0, 0, w, h)
  const tilt = ((spec.tilt ?? 0) + (jitter() - 0.5) * 0.4) * (Math.PI / 180)
  ctx.translate(w / 2, h / 2)
  ctx.rotate(tilt)
  const zoom = 1.08 + (spec.zoom ?? 0) / 100
  ctx.scale(zoom, zoom)
  ctx.filter = `blur(${spec.blur ?? 0}px) brightness(${1 + (spec.brightness ? spec.brightness - 1 : 0)}) saturate(${0.96 + jitter() * 0.1})`
  const panX = ((spec.pan ?? 0) / 100) * w
  const panY = ((spec.pan ?? 0) / 240) * h
  ctx.drawImage(scene, -sw / 2 + panX, -sh / 2 + panY)
  ctx.restore()
  grain(out, 8, jitter)
  return out
}

export async function generateDemoFiles(
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<File[]> {
  const files: File[] = []
  for (let i = 0; i < SHOTS.length; i++) {
    const spec = SHOTS[i]
    onProgress?.(i, SHOTS.length, spec.caption)
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    const canvas = paintShot(spec)
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.86)
    const taken = DEMO_TRIP_START.getTime() + spec.at * 3_600_000 + Math.round(Math.random() * 20_000)
    const file = new File([blob], `IMG_${2100 + i}.JPG`, { type: 'image/jpeg', lastModified: taken })
    files.push(file)
  }
  onProgress?.(SHOTS.length, SHOTS.length, 'done')
  return files
}

export const DEMO_SHOT_COUNT = SHOTS.length

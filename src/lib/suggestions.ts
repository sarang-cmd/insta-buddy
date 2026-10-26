import { cropForAspect } from './image'
import type { Photo, Suggestion } from './types'

const ASPECT_4_5 = 4 / 5
const ASPECT_16_9 = 16 / 9

function round1(n: number) {
  return Math.round(n * 10) / 10
}

export function horizonSuggestion(photo: Photo): Suggestion | null {
  const a = photo.analysis
  if (!a) return null
  if (Math.abs(a.tiltDeg) < 1.0 || a.tiltConfidence < 0.45) return null
  const dir = a.tiltDeg > 0 ? 'clockwise' : 'anti-clockwise'
  return {
    id: 'straighten',
    kind: 'geometry',
    title: `Straighten ${round1(Math.abs(a.tiltDeg))}°`,
    detail: `The strongest straight line in frame is off level by ${round1(
      Math.abs(a.tiltDeg),
    )}° — nudge the frame ${dir} to level the horizon.`,
    confidence: Math.min(0.97, 0.55 + a.tiltConfidence * 0.45),
    safe: true,
    action: { type: 'recipe', patch: { straighten: a.tiltDeg }, label: 'Straighten' },
  }
}

export function cropSuggestion(photo: Photo): Suggestion | null {
  const a = photo.analysis
  if (!a) return null
  const cur = a.aspect
  if (Math.abs(cur - ASPECT_4_5) < 0.03) return null
  if (photo.recipe.crop) return null
  const crop = cropForAspect(a.aspect, 1, ASPECT_4_5, a.subjectX, a.subjectY)
  const lost = 1 - (crop.w * crop.h)
  if (lost > 0.55) return null
  return {
    id: 'crop-45',
    kind: 'geometry',
    title: 'Crop to 4:5',
    detail: `Fill the feed without letterboxing — keeps ${Math.round(
      (1 - lost) * 100,
    )}% of the frame around the busiest part of the scene.`,
    confidence: 0.62,
    safe: false,
    action: {
      type: 'recipe',
      patch: { crop: { x: 0, y: crop.y, w: crop.w, h: crop.h } },
      label: 'Crop 4:5',
    },
  }
}

export function horizonThirdSuggestion(photo: Photo): Suggestion | null {
  const a = photo.analysis
  if (!a) return null
  if (a.tiltConfidence < 0.45) return null
  if (a.aspect < 1.25) return null
  if (a.horizonY < 0.42 || a.horizonY > 0.62) return null
  // croppable band that puts the horizon on the upper third of a 16:9 frame
  const targetH = a.aspect / ASPECT_16_9 // fraction of height kept
  if (targetH < 0.6 || targetH > 0.95) return null
  const idealTop = a.horizonY - targetH / 3
  const y = Math.min(1 - targetH, Math.max(0, idealTop))
  return {
    id: 'crop-horizon',
    kind: 'geometry',
    title: 'Drop the horizon to a third',
    detail: `The horizon sits dead centre. A tighter 16:9 crop puts it on the upper third — classic rule-of-thirds framing.`,
    confidence: 0.58,
    safe: false,
    action: { type: 'recipe', patch: { crop: { x: 0, y, w: 1, h: targetH } }, label: 'Reframe' },
  }
}

export function sharpenSuggestion(photo: Photo): Suggestion | null {
  const a = photo.analysis
  if (!a) return null
  if (a.scores.sharpness >= 46) return null
  const amount = a.scores.sharpness < 26 ? 32 : 20
  return {
    id: 'sharpen',
    kind: 'quality',
    title: `Sharpen +${amount}`,
    detail:
      a.scores.sharpness < 30
        ? `This frame is soft (${a.scores.sharpness}/100). A rescue sharpen helps, but the keeper in this moment is probably sharper.`
        : `Slightly soft edges (${a.scores.sharpness}/100 sharpness). A light unsharp mask crisps it up without halos.`,
    confidence: a.scores.sharpness < 30 ? 0.72 : 0.84,
    safe: true,
    action: { type: 'recipe', patch: { adjust: { ...photo.recipe.adjust, sharpen: amount } }, label: 'Sharpen' },
  }
}

export function exposureSuggestions(photo: Photo): Suggestion[] {
  const a = photo.analysis
  if (!a) return []
  const out: Suggestion[] = []
  const adj = photo.recipe.adjust
  if (a.meanLuma < 0.34 && a.clippedHighlights < 0.02) {
    out.push({
      id: 'lift',
      kind: 'light',
      title: 'Lift the shadows',
      detail: `Average brightness is ${Math.round(a.meanLuma * 100)}% — a lift plus a shadow open reads much closer to how it felt.`,
      confidence: 0.8,
      safe: true,
      action: {
        type: 'recipe',
        patch: { adjust: { ...adj, exposure: 14, shadows: 30, contrast: 4 } },
        label: 'Lift',
      },
    })
  }
  if (a.meanLuma > 0.62 || a.clippedHighlights > 0.05) {
    out.push({
      id: 'recover',
      kind: 'light',
      title: 'Recover the highlights',
      detail:
        a.clippedHighlights > 0.05
          ? `${(a.clippedHighlights * 100).toFixed(1)}% of pixels are blown out — pull highlights back before you post.`
          : 'The frame is bright overall; recovering highlights keeps texture in the sky.',
      confidence: 0.76,
      safe: true,
      action: {
        type: 'recipe',
        patch: { adjust: { ...adj, exposure: -10, highlights: -34, contrast: 6 } },
        label: 'Recover',
      },
    })
  }
  if (a.crushedShadows > 0.08) {
    out.push({
      id: 'open-shadows',
      kind: 'light',
      title: 'Open the crushed blacks',
      detail: `${(a.crushedShadows * 100).toFixed(1)}% of the image is pure black — detail is hiding in there.`,
      confidence: 0.66,
      safe: true,
      action: { type: 'recipe', patch: { adjust: { ...adj, shadows: 42, contrast: -4 } }, label: 'Open up' },
    })
  }
  return out
}

export function colorSuggestions(photo: Photo): Suggestion[] {
  const a = photo.analysis
  if (!a) return []
  const out: Suggestion[] = []
  const adj = photo.recipe.adjust
  if (a.wbCast > 0.11) {
    out.push({
      id: 'cool',
      kind: 'color',
      title: 'Take the yellow cast out',
      detail: 'Warm indoor/street light is tinting the whole frame. Cooling it restores skin tones and whites.',
      confidence: 0.7,
      safe: true,
      action: { type: 'recipe', patch: { adjust: { ...adj, temp: -16, vibrance: 8 } }, label: 'Cool down' },
    })
  } else if (a.wbCast < -0.07) {
    out.push({
      id: 'warm',
      kind: 'color',
      title: 'Warm it up',
      detail: 'The frame reads cool/blue. A touch of warmth lifts the whole scene, especially skin.',
      confidence: 0.64,
      safe: true,
      action: { type: 'recipe', patch: { adjust: { ...adj, temp: 14, vibrance: 8 } }, label: 'Warm up' },
    })
  }
  if (a.colorfulness < 18) {
    out.push({
      id: 'vibrance',
      kind: 'color',
      title: 'Add a little vibrance',
      detail: `Saturation is low (${Math.round(a.saturation * 100)}%). Vibrance pushes the muted tones without nuking skin.`,
      confidence: 0.6,
      safe: true,
      action: { type: 'recipe', patch: { adjust: { ...adj, vibrance: 26, contrast: 5 } }, label: 'Vibrance' },
    })
  } else if (a.colorfulness > 72) {
    out.push({
      id: 'calm',
      kind: 'color',
      title: 'Calm the colours down',
      detail: `Very saturated scene (${Math.round(a.saturation * 100)}%). Trimming it stops the feed looking over-processed.`,
      confidence: 0.45,
      safe: false,
      action: { type: 'recipe', patch: { adjust: { ...adj, saturation: -12, vibrance: 6 } }, label: 'Calm' },
    })
  }
  return out
}

export function objectSuggestions(photo: Photo): Suggestion[] {
  const a = photo.analysis
  if (!a) return []
  const out: Suggestion[] = []
  if (a.wires.length) {
    const wires = a.wires.filter((w) => w.kind === 'wire').length
    const poles = a.wires.length - wires
    const strength = Math.max(...a.wires.map((w) => w.strength))
    out.push({
      id: 'remove-wires',
      kind: 'object',
      title: wires ? 'Remove the overhead lines' : 'Remove the pole',
      detail: `${[
        wires ? `${wires} long line${wires > 1 ? 's' : ''} crossing the sky` : null,
        poles ? `${poles} vertical pole${poles > 1 ? 's' : ''}` : null,
      ]
        .filter(Boolean)
        .join(' · ')}. We pre-paint the mask — you can add to it before we fill.`,
      confidence: Math.min(0.93, 0.5 + strength * 0.45),
      safe: false,
      action: { type: 'retouch', mode: 'wires' },
    })
  }
  if (a.people.length) {
    const biggest = a.people[0]
    const areaPct = ((biggest.w * biggest.h) * 100).toFixed(1)
    out.push({
      id: 'remove-people',
      kind: 'object',
      title: a.people.length > 1 ? `Remove the ${a.people.length} people` : 'Remove the person',
      detail: `Skin-tone region covering ~${areaPct}% of the frame (heuristic, so check the mask). Good for clearing strangers out of a landmark shot.`,
      confidence: Math.min(0.8, biggest.confidence * 0.85),
      safe: false,
      action: { type: 'retouch', mode: 'people' },
    })
  }
  if (a.objects.length) {
    out.push({
      id: 'remove-object',
      kind: 'object',
      title: 'Remove the distraction',
      detail: 'A small high-contrast object is sitting in an otherwise calm area. Brush over it and we synthesise the background back in.',
      confidence: Math.min(0.6, a.objects[0].confidence),
      safe: false,
      action: { type: 'retouch', mode: 'object' },
    })
  }
  return out
}

export function extendSuggestion(photo: Photo): Suggestion | null {
  const a = photo.analysis
  if (!a) return null
  if (a.aspect < 1.15) return null // already portrait-ish
  if (photo.recipe.extend) return null
  if (a.skyFraction < 0.12 && a.tiltConfidence > 0.4) return null
  return {
    id: 'extend-45',
    kind: 'geometry',
    title: 'Extend to 4:5',
    detail: 'Instead of cropping, grow the frame outward. Best on sky, sea and walls — it mirrors and softens the edges, so avoid text or faces.',
    confidence: a.skyFraction > 0.25 ? 0.56 : 0.4,
    safe: false,
    action: { type: 'recipe', patch: { extend: ASPECT_4_5 }, label: 'Extend' },
  }
}

export function suggestionsFor(photo: Photo): Suggestion[] {
  const list: Suggestion[] = []
  const tilt = horizonSuggestion(photo)
  if (tilt) list.push(tilt)
  const crop = cropSuggestion(photo)
  if (crop) list.push(crop)
  // reframe options conflict with each other — offer the strongest one only
  if (crop) {
    // crop already suggested, skip horizon-third and extend
  } else {
    const third = horizonThirdSuggestion(photo)
    if (third) list.push(third)
    const extend = extendSuggestion(photo)
    if (extend) list.push(extend)
  }
  const sharpen = sharpenSuggestion(photo)
  if (sharpen) list.push(sharpen)
  list.push(...exposureSuggestions(photo))
  list.push(...colorSuggestions(photo))
  list.push(...objectSuggestions(photo))
  return list.filter((s) => !photo.dismissed.includes(s.id)).sort((a, b) => b.confidence - a.confidence)
}

export function safeBulkPatch(photo: Photo): { straighten?: number; adjust?: Photo['recipe']['adjust'] } {
  const a = photo.analysis
  if (!a) return {}
  const patch: { straighten?: number; adjust?: Photo['recipe']['adjust'] } = {}
  if (Math.abs(a.tiltDeg) >= 1 && a.tiltConfidence >= 0.5) patch.straighten = a.tiltDeg
  const adj = { ...photo.recipe.adjust }
  let touched = false
  if (a.meanLuma < 0.34) {
    adj.exposure = 12
    adj.shadows = 26
    touched = true
  }
  if (a.meanLuma > 0.63 || a.clippedHighlights > 0.05) {
    adj.highlights = -28
    adj.exposure = Math.min(adj.exposure, -6)
    touched = true
  }
  if (a.scores.sharpness < 44) {
    adj.sharpen = Math.max(adj.sharpen, a.scores.sharpness < 26 ? 28 : 16)
    touched = true
  }
  if (a.colorfulness < 18) {
    adj.vibrance = 20
    touched = true
  }
  if (a.wbCast > 0.11) {
    adj.temp = -12
    touched = true
  } else if (a.wbCast < -0.07) {
    adj.temp = 10
    touched = true
  }
  if (touched) patch.adjust = adj
  return patch
}

export function suggestionTone(kind: Suggestion['kind']) {
  switch (kind) {
    case 'geometry':
      return 'Geometry'
    case 'light':
      return 'Light'
    case 'color':
      return 'Colour'
    case 'object':
      return 'Objects'
    default:
      return 'Quality'
  }
}

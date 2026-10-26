import { formatDay } from '../grouping'
import type { Photo, Session } from '../types'
import type { AiSettings } from './settings'
import { activeModel, activeProvider, assertCapability, runAi } from './client'
import { urlToDataUrl, maskToProviderPng } from './images'
import { extractJson, type AiImage } from './transport'

const CAPTION_SYSTEM = `You write Instagram captions for travel photo dumps.
Voice: warm, specific, lightly funny, never cringe, no emoji spam, no "blessed", no advertising tone.
Return ONLY valid JSON.`

export interface AiCaptionResult {
  short: string
  playful: string
  story: string
  hashtags: string[]
  vibe: { name: string; traits: string[] }
  altTexts: string[]
  model: string
}

function tripFacts(photos: Photo[], sessions: Session[]) {
  const days = new Set(photos.map((p) => new Date(p.meta.takenAt).toDateString())).size
  const scenes = photos
    .map((p) => p.analysis)
    .filter(Boolean)
    .slice(0, 12)
    .map((a) => {
      const bits: string[] = []
      if (a!.skyFraction > 0.28) bits.push('wide sky')
      if (a!.people.length) bits.push(`${a!.people.length} people`)
      if (a!.colorfulness > 55) bits.push('saturated colour')
      if (a!.colorfulness < 22) bits.push('muted colour')
      if (a!.meanLuma < 0.34) bits.push('low light')
      if (Math.abs(a!.tiltDeg) > 1.2) bits.push('tilted horizon corrected')
      return bits.join(', ')
    })
    .filter(Boolean)
  const sessionLines = sessions
    .slice(0, 8)
    .map((s) => `${formatDay(s.start)} ${new Date(s.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} — ${s.photoIds.length} shots`)
  return { days, scenes, sessionLines, total: photos.length }
}

export async function generateCaptionsWithAi(
  input: { photos: Photo[]; sessions: Session[]; stats: { total: number; kept: number; days: number } },
  settings: AiSettings,
  signal?: AbortSignal,
): Promise<AiCaptionResult> {
  const provider = activeProvider(settings)
  if (!provider) throw new Error('No AI provider configured.')
  const model = activeModel(settings)
  const facts = tripFacts(input.photos, input.sessions)
  const wantsImages = settings.allowImageUpload && input.photos.length > 0

  const prompt = [
    `A holiday photo dump. ${input.stats.kept} photos were kept out of ${input.stats.total}, across ${facts.days} day(s).`,
    facts.sessionLines.length ? `Sessions:\n- ${facts.sessionLines.join('\n- ')}` : '',
    facts.scenes.length ? `What is in the frames: ${facts.scenes.slice(0, 8).join(' | ')}` : '',
    wantsImages
      ? `I've attached ${Math.min(3, input.photos.length)} of the keeper frames — look at them and write captions that would only fit THIS trip (mention specifics you can actually see).`
      : `No photos attached, so rely on the metadata above and stay a little more general.`,
    '',
    'Return JSON with exactly these keys:',
    '{"short": "under 60 chars", "playful": "1-2 sentences, funny but not cringe", "story": "2-3 sentences, a small story", "hashtags": ["8-10 tags, no # in front, mix broad + specific"], "vibe": {"name": "2-3 words", "traits": ["3 short phrases"]}, "altTexts": ["one accessible description per attached photo, or 3 short generic ones"]}',
  ]
    .filter(Boolean)
    .join('\n')

  const images: AiImage[] = []
  if (wantsImages) {
    for (const photo of input.photos.slice(0, 3)) {
      if (!photo.baseUrl) continue
      const dataUrl = await urlToDataUrl(photo.baseUrl, settings.imageEdge)
      images.push({ dataUrl, mime: 'image/jpeg' })
    }
  }

  const result = await runAi(
    images.length
      ? { kind: 'vision', prompt, system: CAPTION_SYSTEM, images, json: true, maxTokens: 900 }
      : { kind: 'text', prompt, system: CAPTION_SYSTEM, json: true, maxTokens: 900 },
    { settings, signal },
  )

  const parsed = extractJson<{
    short?: string
    playful?: string
    story?: string
    hashtags?: string[]
    vibe?: { name?: string; traits?: string[] }
    altTexts?: string[]
  }>(result.text)

  if (!parsed?.short && !parsed?.playful) {
    throw new Error(`${provider.name} returned text that wasn't usable JSON. Try again or another model.`)
  }

  const cleanTags = (parsed.hashtags ?? [])
    .map((t) => `#${t.replace(/^#+/, '').replace(/[^a-zA-Z0-9_]/g, '')}`)
    .filter((t) => t.length > 2)
    .slice(0, 10)

  return {
    short: (parsed.short ?? '').trim(),
    playful: (parsed.playful ?? '').trim(),
    story: (parsed.story ?? '').trim(),
    hashtags: cleanTags,
    vibe: {
      name: (parsed.vibe?.name ?? 'The trip').trim(),
      traits: (parsed.vibe?.traits ?? []).map((t) => t.trim()).slice(0, 3),
    },
    altTexts: (parsed.altTexts ?? []).map((t) => t.trim()).filter(Boolean),
    model: `${provider.name} · ${model}`,
  }
}

export type AiEditKind = 'straighten' | 'crop' | 'sharpen' | 'exposure' | 'color' | 'remove' | 'extend' | 'note'

export interface AiAdvice {
  verdict: string
  score: number
  issues: { type: string; severity: 'low' | 'medium' | 'high'; note: string }[]
  edits: { kind: AiEditKind; amount?: number; reason: string; label: string }[]
  model: string
}

const REVIEW_SYSTEM = `You are a photo editor reviewing one frame for an Instagram dump.
Be blunt, specific and brief. Never invent objects that aren't visible. Return ONLY valid JSON.`

export async function reviewPhotoWithAi(photo: Photo, settings: AiSettings, signal?: AbortSignal): Promise<AiAdvice> {
  const { provider, model } = assertCapability(settings, 'vision')
  if (!settings.allowImageUpload) {
    throw new Error('Photo upload is off. Turn it on in Settings → AI to send the frame for review.')
  }
  if (!photo.baseUrl) throw new Error('This photo has no image data.')
  const dataUrl = await urlToDataUrl(photo.baseUrl, settings.imageEdge)
  const local = photo.analysis
  const context = local
    ? `Local analysis already found: sharpness ${local.scores.sharpness}/100, exposure ${local.scores.exposure}/100, horizon off by ${local.tiltDeg.toFixed(1)}°, ${local.people.length} people, ${local.wires.length} overhead lines, ${Math.round(local.skyFraction * 100)}% sky.`
    : ''

  const prompt = [
    'Review this photo for an Instagram dump.',
    context,
    '',
    'Return JSON:',
    '{"verdict": "one sentence on whether to post it", "score": 1-10, "issues": [{"type": "sharpness|exposure|composition|colour|clutter|people|horizon|other", "severity": "low|medium|high", "note": "what is wrong"}], "edits": [{"kind": "straighten|crop|sharpen|exposure|color|remove|extend|note", "amount": number, "reason": "why", "label": "3-5 words"}]}',
    'Rules: "amount" is degrees for straighten, a 0-100 strength for sharpen/exposure/color, or a target aspect ratio like 0.8 for crop/extend. Use "remove" only for something clearly removable (a wire, a bin, a stranger). Max 4 issues and max 4 edits.',
  ]
    .filter(Boolean)
    .join('\n')

  const result = await runAi(
    { kind: 'vision', prompt, system: REVIEW_SYSTEM, images: [{ dataUrl, mime: 'image/jpeg' }], json: true, maxTokens: 800 },
    { settings, signal },
  )

  const parsed = extractJson<{
    verdict?: string
    score?: number
    issues?: { type?: string; severity?: string; note?: string }[]
    edits?: { kind?: string; amount?: number; reason?: string; label?: string }[]
  }>(result.text)
  if (!parsed) throw new Error(`${provider.name} did not return usable JSON.`)

  const allowedKinds: AiEditKind[] = ['straighten', 'crop', 'sharpen', 'exposure', 'color', 'remove', 'extend', 'note']
  return {
    verdict: (parsed.verdict ?? '').trim(),
    score: Math.max(1, Math.min(10, Math.round(parsed.score ?? 6))),
    issues: (parsed.issues ?? []).slice(0, 4).map((i) => ({
      type: (i.type ?? 'other').trim(),
      severity: i.severity === 'high' ? 'high' : i.severity === 'low' ? 'low' : 'medium',
      note: (i.note ?? '').trim(),
    })),
    edits: (parsed.edits ?? [])
      .filter((e) => e.kind && allowedKinds.includes(e.kind as AiEditKind))
      .slice(0, 4)
      .map((e) => ({
        kind: e.kind as AiEditKind,
        amount: typeof e.amount === 'number' && isFinite(e.amount) ? e.amount : undefined,
        reason: (e.reason ?? '').trim(),
        label: (e.label ?? e.kind ?? 'edit').trim(),
      })),
    model: `${provider.name} · ${model}`,
  }
}

export interface BurstPick {
  winner: number
  why: string
  runners: { index: number; why: string }[]
  model: string
}

export async function pickKeeperWithAi(photos: Photo[], settings: AiSettings, signal?: AbortSignal): Promise<BurstPick> {
  const { provider, model } = assertCapability(settings, 'vision')
  if (!settings.allowImageUpload) throw new Error('Photo upload is off. Enable it in Settings → AI.')
  const list = photos.slice(0, 4)
  const images: AiImage[] = []
  for (const photo of list) {
    if (!photo.baseUrl) continue
    images.push({ dataUrl: await urlToDataUrl(photo.baseUrl, Math.min(768, settings.imageEdge)), mime: 'image/jpeg' })
  }
  if (images.length < 2) throw new Error('Need at least two frames to compare.')

  const prompt = [
    `These are ${images.length} frames of the same moment, numbered 1-${images.length} in the order attached.`,
    'Pick the one that best deserves to be posted, judging sharpness, expression/framing, exposure and clutter.',
    'Return JSON: {"winner": 1-based index, "why": "one sentence", "runners": [{"index": n, "why": "why it lost"}]}',
  ].join('\n')

  const result = await runAi(
    { kind: 'vision', prompt, system: REVIEW_SYSTEM, images, json: true, maxTokens: 500 },
    { settings, signal },
  )
  const parsed = extractJson<{ winner?: number; why?: string; runners?: { index?: number; why?: string }[] }>(result.text)
  if (!parsed?.winner) throw new Error(`${provider.name} did not pick a frame.`)
  return {
    winner: Math.max(0, Math.min(images.length - 1, Math.round(parsed.winner) - 1)),
    why: (parsed.why ?? '').trim(),
    runners: (parsed.runners ?? []).slice(0, 3).map((r) => ({
      index: Math.max(0, Math.round((r.index ?? 1) - 1)),
      why: (r.why ?? '').trim(),
    })),
    model: `${provider.name} · ${model}`,
  }
}

/** Ask a provider with an image model to erase what's painted in the mask. */
export async function removeWithAi(
  input: { image: HTMLCanvasElement; mask: HTMLCanvasElement; note?: string },
  settings: AiSettings,
  signal?: AbortSignal,
): Promise<{ dataUrl: string; model: string }> {
  const provider = activeProvider(settings)
  if (!provider) throw new Error('No AI provider configured.')
  const currentModel = activeModel(settings)
  const model = provider.models.find((m) => m.caps.includes('imageEdit'))?.id
  if (!model) {
    throw new Error(`${provider.name} has no image-editing model. OpenAI, Azure, Gemini or Together can do this — or use the on-device fill.`)
  }
  // re-check using the image model, not whatever text model was selected
  assertCapability({ ...settings, modelId: model }, 'imageEdit')

  const image = input.image.toDataURL('image/jpeg', 0.92)
  const mask = maskToProviderPng(input.mask)
  const prompt =
    input.note?.trim() ||
    'Remove the object marked by the mask and rebuild the background so it blends in. Keep everything outside the mask identical: same framing, colour, lighting and sharpness.'

  const result = await runAi(
    {
      kind: 'imageEdit',
      prompt,
      image: { dataUrl: image, mime: 'image/jpeg' },
      mask: { dataUrl: mask, mime: 'image/png' },
      size: '1024x1024',
    },
    { settings, modelId: model, signal },
  )
  const out = result.images?.[0]?.dataUrl
  if (!out) throw new Error(`${provider.name} returned no image.`)
  return { dataUrl: out, model: `${provider.name} · ${model} ${model === currentModel ? '' : '(auto-picked)'}` }
}

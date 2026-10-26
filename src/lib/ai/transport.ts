import type { AiProvider } from './providers'

export interface AiImage {
  /** data:image/jpeg;base64,… */
  dataUrl: string
  mime: string
}

export type AiRequest =
  | {
      kind: 'text'
      prompt: string
      system?: string
      maxTokens?: number
      json?: boolean
    }
  | {
      kind: 'vision'
      prompt: string
      system?: string
      images: AiImage[]
      maxTokens?: number
      json?: boolean
    }
  | {
      kind: 'imageEdit'
      prompt: string
      image: AiImage
      mask?: AiImage
      size?: string
    }

export interface AiResult {
  text?: string
  images?: AiImage[]
  model: string
  usage?: { input?: number; output?: number }
}

export interface BuiltRequest {
  url: string
  init: RequestInit
  timeoutMs: number
  parse: (json: unknown) => AiResult
}

export const AZURE_API_VERSION = '2024-10-21'

export function dataUrlToParts(dataUrl: string): { mime: string; base64: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) return { mime: 'image/jpeg', base64: dataUrl }
  return { mime: match[1] ?? 'image/jpeg', base64: match[3] ?? '' }
}

function splitDataUrl(dataUrl: string) {
  const { mime, base64 } = dataUrlToParts(dataUrl)
  return { mime, base64 }
}

function trimBase(url: string) {
  return url.replace(/\/+$/, '')
}

function joinUrl(base: string, path: string) {
  return `${trimBase(base)}${path.startsWith('/') ? path : `/${path}`}`
}

function authHeaders(provider: AiProvider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { ...(provider.extraHeaders ?? {}) }
  if (provider.transport === 'azure') {
    if (apiKey) headers['api-key'] = apiKey
  } else if (provider.transport === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
    // lets the browser build talk to Anthropic directly
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  } else if (provider.transport === 'gemini') {
    if (apiKey) headers['x-goog-api-key'] = apiKey
  } else if (!provider.keyless) {
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  }
  return headers
}

/* ------------------------------------------------------------------ parsing */

function textFromOpenAiPart(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        const p = part as { type?: string; text?: string }
        return typeof p?.text === 'string' ? p.text : ''
      })
      .join('')
  }
  return ''
}

function parseOpenAiImage(json: unknown): AiImage[] {
  const data = (json as { data?: { b64_json?: string; url?: string; revised_prompt?: string }[] })?.data
  if (!Array.isArray(data)) return []
  return data
    .map((item) => {
      if (item.b64_json) return { dataUrl: `data:image/png;base64,${item.b64_json}`, mime: 'image/png' }
      return null
    })
    .filter((x): x is AiImage => !!x)
}

function parseOpenAi(json: unknown, model: string): AiResult {
  const body = json as {
    choices?: { message?: { content?: unknown } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
    data?: unknown
  }
  const images = parseOpenAiImage(json)
  const text = body?.choices?.[0]?.message?.content
  return {
    text: text === undefined ? undefined : textFromOpenAiPart(text),
    images: images.length ? images : undefined,
    model,
    usage: body?.usage
      ? { input: body.usage.prompt_tokens, output: body.usage.completion_tokens }
      : undefined,
  }
}

function parseAnthropic(json: unknown, model: string): AiResult {
  const body = json as {
    content?: { type?: string; text?: string }[]
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const text = (body?.content ?? [])
    .filter((b) => b?.type === 'text' || typeof b?.text === 'string')
    .map((b) => b.text ?? '')
    .join('\n')
  return {
    text,
    model,
    usage: body?.usage ? { input: body.usage.input_tokens, output: body.usage.output_tokens } : undefined,
  }
}

function parseGemini(json: unknown, model: string): AiResult {
  const body = json as {
    candidates?: {
      content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] }
    }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  }
  const parts = body?.candidates?.[0]?.content?.parts ?? []
  const texts = parts.map((p) => p.text ?? '').filter(Boolean)
  const images: AiImage[] = parts
    .filter((p) => p.inlineData?.data)
    .map((p) => ({
      dataUrl: `data:${p.inlineData!.mimeType ?? 'image/png'};base64,${p.inlineData!.data}`,
      mime: p.inlineData!.mimeType ?? 'image/png',
    }))
  return {
    text: texts.length ? texts.join('\n') : undefined,
    images: images.length ? images : undefined,
    model,
    usage: body?.usageMetadata
      ? { input: body.usageMetadata.promptTokenCount, output: body.usageMetadata.candidatesTokenCount }
      : undefined,
  }
}

function parseOllama(json: unknown, model: string): AiResult {
  const body = json as {
    message?: { content?: string }
    response?: string
    prompt_eval_count?: number
    eval_count?: number
  }
  return {
    text: body?.message?.content ?? body?.response,
    model,
    usage: { input: body?.prompt_eval_count, output: body?.eval_count },
  }
}

/* ------------------------------------------------------------------ builders */

function baseResponseFormat(provider: AiProvider, json?: boolean) {
  if (!json || !provider.supportsJsonMode) return undefined
  return { type: 'json_object' as const }
}

function buildOpenAiChat(
  provider: AiProvider,
  apiKey: string,
  model: string,
  req: Extract<AiRequest, { kind: 'text' | 'vision' }>,
): BuiltRequest {
  const messages: unknown[] = []
  if (req.system) messages.push({ role: 'system', content: req.system })
  if (req.kind === 'vision') {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: req.prompt },
        ...req.images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
      ],
    })
  } else {
    messages.push({ role: 'user', content: req.prompt })
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    max_completion_tokens: req.maxTokens ?? 900,
  }
  const responseFormat = baseResponseFormat(provider, req.json)
  if (responseFormat) body.response_format = responseFormat

  return {
    url:
      provider.transport === 'azure'
        ? joinUrl(provider.baseUrl, `/chat/completions?api-version=${AZURE_API_VERSION}`)
        : joinUrl(provider.baseUrl, '/chat/completions'),
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(provider, apiKey) },
      body: JSON.stringify(body),
    },
    timeoutMs: 90_000,
    parse: (json) => parseOpenAi(json, model),
  }
}

function buildOpenAiEdits(
  provider: AiProvider,
  apiKey: string,
  model: string,
  req: Extract<AiRequest, { kind: 'imageEdit' }>,
): BuiltRequest {
  const form = new FormData()
  const image = splitDataUrl(req.image.dataUrl)
  form.append('model', model)
  form.append('prompt', req.prompt)
  form.append('n', '1')
  form.append('image', new Blob([base64ToBytes(image.base64)], { type: image.mime }), 'image.png')
  if (req.mask) {
    const mask = splitDataUrl(req.mask.dataUrl)
    form.append('mask', new Blob([base64ToBytes(mask.base64)], { type: mask.mime }), 'mask.png')
  }
  if (req.size) form.append('size', req.size)
  // dall-e-2/3 need this; gpt-image-1 returns b64 unconditionally
  form.append('response_format', 'b64_json')

  return {
    url:
      provider.transport === 'azure'
        ? joinUrl(provider.baseUrl, `/images/edits?api-version=${AZURE_API_VERSION}`)
        : joinUrl(provider.baseUrl, '/images/edits'),
    init: {
      method: 'POST',
      headers: authHeaders(provider, apiKey),
      body: form,
    },
    timeoutMs: 240_000,
    parse: (json) => parseOpenAi(json, model),
  }
}

function buildTogetherImage(
  provider: AiProvider,
  apiKey: string,
  model: string,
  req: Extract<AiRequest, { kind: 'imageEdit' }>,
): BuiltRequest {
  const body: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    image_url: req.image.dataUrl,
    response_format: 'b64_json',
    n: 1,
  }
  return {
    url: joinUrl(provider.baseUrl, '/images/generations'),
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(provider, apiKey) },
      body: JSON.stringify(body),
    },
    timeoutMs: 240_000,
    parse: (json) => parseOpenAi(json, model),
  }
}

function buildAnthropic(
  provider: AiProvider,
  apiKey: string,
  model: string,
  req: Extract<AiRequest, { kind: 'text' | 'vision' }>,
): BuiltRequest {
  const content: unknown[] = [{ type: 'text', text: req.prompt }]
  if (req.kind === 'vision') {
    for (const img of req.images) {
      const { mime, base64 } = splitDataUrl(img.dataUrl)
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mime, data: base64 },
      })
    }
  }
  const body: Record<string, unknown> = {
    model,
    max_tokens: req.maxTokens ?? 900,
    messages: [{ role: 'user', content }],
  }
  if (req.system) body.system = req.system

  return {
    url: joinUrl(provider.baseUrl, '/v1/messages'),
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(provider, apiKey) },
      body: JSON.stringify(body),
    },
    timeoutMs: 90_000,
    parse: (json) => parseAnthropic(json, model),
  }
}

function buildGemini(
  provider: AiProvider,
  apiKey: string,
  model: string,
  req: AiRequest,
): BuiltRequest {
  const parts: unknown[] = []
  if (req.kind === 'imageEdit') {
    parts.push({ text: req.prompt })
    const { mime, base64 } = splitDataUrl(req.image.dataUrl)
    parts.push({ inline_data: { mime_type: mime, data: base64 } })
    if (req.mask) {
      const mask = splitDataUrl(req.mask.dataUrl)
      parts.push({ inline_data: { mime_type: mask.mime, data: mask.base64 } })
    }
  } else {
    parts.push({ text: req.prompt })
    if (req.kind === 'vision') {
      for (const img of req.images) {
        const { mime, base64 } = splitDataUrl(img.dataUrl)
        parts.push({ inline_data: { mime_type: mime, data: base64 } })
      }
    }
  }

  const generationConfig: Record<string, unknown> = {}
  if (req.kind === 'imageEdit') {
    generationConfig.response_modalities = ['TEXT', 'IMAGE']
  } else {
    generationConfig.maxOutputTokens = req.maxTokens ?? 900
    if (req.json) generationConfig.responseMimeType = 'application/json'
  }

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig,
  }
  if (req.kind !== 'imageEdit' && req.system) {
    body.systemInstruction = { parts: [{ text: req.system }] }
  }

  return {
    url: joinUrl(provider.baseUrl, `/v1beta/models/${encodeURIComponent(model)}:generateContent`),
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(provider, apiKey) },
      body: JSON.stringify(body),
    },
    timeoutMs: req.kind === 'imageEdit' ? 240_000 : 90_000,
    parse: (json) => parseGemini(json, model),
  }
}

function buildOllama(
  provider: AiProvider,
  _apiKey: string,
  model: string,
  req: Extract<AiRequest, { kind: 'text' | 'vision' }>,
): BuiltRequest {
  const message: Record<string, unknown> = { role: 'user', content: req.prompt }
  if (req.kind === 'vision') {
    message.images = req.images.map((img) => splitDataUrl(img.dataUrl).base64)
  }
  const messages: unknown[] = []
  if (req.system) messages.push({ role: 'system', content: req.system })
  messages.push(message)

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    options: { num_predict: req.maxTokens ?? 900 },
  }
  if (req.json) body.format = 'json'

  return {
    url: joinUrl(provider.baseUrl, '/api/chat'),
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(provider, '') },
      body: JSON.stringify(body),
    },
    timeoutMs: 180_000,
    parse: (json) => parseOllama(json, model),
  }
}

export function buildRequest(provider: AiProvider, apiKey: string, model: string, req: AiRequest): BuiltRequest {
  if (req.kind === 'imageEdit') {
    if (provider.transport === 'gemini') return buildGemini(provider, apiKey, model, req)
    if (provider.imageEditStyle === 'together-generations') return buildTogetherImage(provider, apiKey, model, req)
    if (provider.transport === 'openai' || provider.transport === 'azure')
      return buildOpenAiEdits(provider, apiKey, model, req)
    throw new Error(`${provider.name} can't edit images — pick a provider with an image model.`)
  }
  if (provider.transport === 'anthropic') return buildAnthropic(provider, apiKey, model, req)
  if (provider.transport === 'gemini') return buildGemini(provider, apiKey, model, req)
  if (provider.transport === 'ollama') return buildOllama(provider, apiKey, model, req)
  return buildOpenAiChat(provider, apiKey, model, req)
}

/* ------------------------------------------------------------------- helpers */

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  if (typeof atob === 'function') {
    const binary = atob(base64)
    const out = new Uint8Array(new ArrayBuffer(binary.length))
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  const buf = (globalThis as unknown as { Buffer: { from: (s: string, e: string) => Uint8Array } }).Buffer
  const src = buf.from(base64, 'base64')
  const out = new Uint8Array(new ArrayBuffer(src.length))
  out.set(src)
  return out
}

/** Tolerant JSON extraction: models love wrapping JSON in fences or prose. */
export function extractJson<T = unknown>(text: string | undefined): T | null {
  if (!text) return null
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = fenced ? fenced[1] : text
  const attempts = [candidate.trim()]
  const first = candidate.indexOf('{')
  const last = candidate.lastIndexOf('}')
  if (first >= 0 && last > first) attempts.push(candidate.slice(first, last + 1))
  const firstArr = candidate.indexOf('[')
  const lastArr = candidate.lastIndexOf(']')
  if (firstArr >= 0 && lastArr > firstArr) attempts.push(candidate.slice(firstArr, lastArr + 1))
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as T
    } catch {
      /* try the next shape */
    }
  }
  return null
}

export interface AiError {
  message: string
  status?: number
  retryable: boolean
  hint?: string
}

export function normaliseError(status: number | undefined, body: string, providerName: string): AiError {
  let detail = body?.slice(0, 400) ?? ''
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    const err = parsed?.error
    detail = (typeof err === 'string' ? err : err?.message) ?? parsed?.message ?? detail
  } catch {
    /* keep raw text */
  }
  const base = { status, retryable: false as boolean, hint: undefined as string | undefined }
  if (status === 401 || status === 403) {
    return {
      ...base,
      message: `${providerName} rejected the key.`,
      hint: 'Paste a fresh API key in Settings → AI, and check the key has access to this model.',
    }
  }
  if (status === 404) {
    return {
      ...base,
      message: `${providerName} could not find that model or endpoint.`,
      hint: 'Check the model id and base URL. Azure needs the deployment name as the model.',
    }
  }
  if (status === 429) {
    return { ...base, message: `${providerName} is rate-limiting.`, retryable: true, hint: 'Wait a few seconds, or switch model/provider.' }
  }
  if (status && status >= 500) {
    return { ...base, message: `${providerName} had a server error.`, retryable: true, hint: 'Retry, or fall back to on-device.' }
  }
  if (status === 400) {
    return {
      ...base,
      message: `${providerName} did not like the request.`,
      hint: detail || 'The model may not support images or JSON mode — try another model.',
    }
  }
  return { ...base, message: detail || `${providerName} request failed.`, retryable: false }
}

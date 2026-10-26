import { getBridge } from './bridge'
import { modelCaps, providerById } from './providers'
import { getWebKey, resolveBaseUrl, resolveModel, type AiSettings } from './settings'
import { buildRequest, normaliseError, type AiError, type AiRequest, type AiResult } from './transport'

export class AiUnavailableError extends Error {
  hint?: string
  constructor(message: string, hint?: string) {
    super(message)
    this.name = 'AiUnavailableError'
    this.hint = hint
  }
}

export interface RunOptions {
  settings: AiSettings
  signal?: AbortSignal
  /** overrides the settings model, e.g. an image model for edits */
  modelId?: string
  providerId?: string
}

export function activeProvider(settings: AiSettings) {
  const id = settings.providerId
  return id ? providerById(id) : undefined
}

export function activeModel(settings: AiSettings, override?: string) {
  const provider = activeProvider(settings)
  if (!provider) return ''
  return override || resolveModel(settings) || provider.defaultModel
}

export function assertCapability(settings: AiSettings, cap: 'text' | 'vision' | 'imageEdit', modelOverride?: string) {
  const provider = activeProvider(settings)
  if (!provider) throw new AiUnavailableError('No AI provider is configured.', 'Open Settings → AI and pick one of the 12 providers.')
  const model = activeModel(settings, modelOverride)
  const caps = modelCaps(provider, model)
  if (!caps.includes(cap)) {
    const what =
      cap === 'imageEdit'
        ? 'image editing'
        : cap === 'vision'
          ? 'photo understanding'
          : 'text generation'
    throw new AiUnavailableError(
      `${provider.name} · ${model} can't do ${what}.`,
      cap === 'imageEdit'
        ? 'Pick an image model (gpt-image-1, Gemini 2.5 Flash Image or FLUX Kontext) or use the on-device fill.'
        : 'Pick a vision model in Settings → AI.',
    )
  }
  return { provider, model }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Browser fallback path: keys stay in memory and requests go direct (CORS permitting). */
async function runInBrowser(
  providerId: string,
  modelId: string,
  baseUrl: string | undefined,
  request: AiRequest,
  signal?: AbortSignal,
): Promise<AiResult> {
  const provider = providerById(providerId)
  if (!provider) throw new AiUnavailableError('Unknown AI provider.')
  const key = getWebKey(providerId) ?? ''
  if (!provider.keyless && !key) {
    throw new AiUnavailableError(
      `No ${provider.name} key in this browser session.`,
      'Keys are only stored in memory in the web build. Use the desktop app for the encrypted vault, or paste a key in Settings → AI.',
    )
  }
  const built = buildRequest(provider, key, modelId, request)
  const url = baseUrl ? built.url.replace(provider.baseUrl.replace(/\/+$/, ''), baseUrl.replace(/\/+$/, '')) : built.url
  let response: Response
  try {
    response = await fetchWithTimeout(url, built.init, built.timeoutMs, signal)
  } catch (err) {
    throw new AiUnavailableError(
      `Couldn't reach ${provider.name}.`,
      err instanceof DOMException && err.name === 'AbortError'
        ? 'The request was cancelled or timed out.'
        : 'Check your connection — and note that browsers block some providers unless CORS is allowed. The desktop app has no such limit.',
    )
  }
  const text = await response.text()
  if (!response.ok) {
    const err = normaliseError(response.status, text, provider.name)
    throw new AiUnavailableError(err.message, err.hint)
  }
  try {
    return built.parse(JSON.parse(text))
  } catch (err) {
    throw new AiUnavailableError(`${provider.name} returned something unexpected.`, String(err))
  }
}

export async function runAi(request: AiRequest, options: RunOptions): Promise<AiResult> {
  const providerId = options.providerId ?? options.settings.providerId
  if (!providerId) {
    throw new AiUnavailableError('No AI provider is configured.', 'Open Settings → AI and pick one of the 12 providers.')
  }
  const provider = providerById(providerId)
  if (!provider) throw new AiUnavailableError('Unknown AI provider.')
  const modelId = options.modelId || options.settings.modelId || provider.defaultModel
  const caps = modelCaps(provider, modelId)
  if (!caps.includes(request.kind === 'imageEdit' ? 'imageEdit' : request.kind === 'vision' ? 'vision' : 'text')) {
    throw new AiUnavailableError(
      `${provider.name} · ${modelId} can't do that.`,
      'Switch model in Settings → AI, or use the on-device engine.',
    )
  }
  const baseUrl = resolveBaseUrl(options.settings, providerId)
  const bridge = getBridge()

  if (!bridge) return runInBrowser(providerId, modelId, baseUrl, request, options.signal)

  const res = await bridge.ai.request({ providerId, modelId, baseUrl, request })
  if (!res.ok || !res.result) {
    const err: AiError = res.error ?? { message: 'The request failed.', retryable: false }
    throw new AiUnavailableError(err.message, err.hint)
  }
  return res.result
}

export async function testProvider(settings: AiSettings, providerId: string): Promise<{ ok: boolean; message: string }> {
  const provider = providerById(providerId)
  if (!provider) return { ok: false, message: 'Unknown provider.' }
  const started = Date.now()
  try {
    const result = await runAi(
      {
        kind: 'text',
        prompt: 'Reply with exactly: connected',
        maxTokens: 16,
      },
      { settings: { ...settings, providerId }, providerId },
    )
    const ms = Date.now() - started
    const head = (result.text ?? '').trim().slice(0, 60)
    return { ok: true, message: `${provider.name} answered in ${ms} ms${head ? ` · “${head}”` : ''}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Request failed.'
    const hint = err instanceof AiUnavailableError ? err.hint : undefined
    return { ok: false, message: hint ? `${message} ${hint}` : message }
  }
}

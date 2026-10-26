import { providerById, type AiProvider } from '../src/lib/ai/providers'
import { buildRequest, normaliseError, type AiError, type AiRequest, type AiResult } from '../src/lib/ai/transport'
import { getKey } from './vault'

export interface ProxyResult {
  ok: boolean
  result?: AiResult
  error?: AiError
  httpStatus?: number
  ms?: number
}

const MAX_TEXT_BYTES = 25 * 1024 * 1024
const MAX_IMAGE_BYTES = 40 * 1024 * 1024

let inFlight: AbortController | null = null

export function cancelRequest() {
  inFlight?.abort(new Error('cancelled'))
  inFlight = null
  return { ok: true }
}

function assertUrl(url: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid provider URL: ${url}`)
  }
  const isLocal = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
    throw new Error('Only https endpoints (or http on localhost for local models) are allowed.')
  }
  if (parsed.username || parsed.password) throw new Error('Credentials in URLs are not allowed.')
  return parsed
}

function rewriteBase(url: string, providerBase: string, overrideBase?: string) {
  if (!overrideBase) return url
  const from = providerBase.replace(/\/+$/, '')
  const to = overrideBase.replace(/\/+$/, '')
  return url.startsWith(from) ? to + url.slice(from.length) : url
}

function payloadSize(request: AiRequest): number {
  const json = JSON.stringify(request)
  return json.length * 2
}

async function attempt(
  provider: AiProvider,
  apiKey: string,
  modelId: string,
  request: AiRequest,
  baseUrl: string,
  signal: AbortSignal,
): Promise<{ response: Response; built: ReturnType<typeof buildRequest> }> {
  const built = buildRequest(provider, apiKey, modelId, request)
  const url = assertUrl(rewriteBase(built.url, provider.baseUrl, baseUrl)).toString()
  const response = await fetch(url, { ...built.init, signal })
  return { response, built }
}

/**
 * All provider traffic happens here, in the main process:
 * - the renderer never sees an API key
 * - no CORS rules, no browser origin restrictions
 * - one retry on 429/5xx, hard timeouts, friendly errors
 */
export async function proxyRequest(payload: {
  providerId: string
  modelId: string
  baseUrl?: string
  request: AiRequest
}): Promise<ProxyResult> {
  const started = Date.now()
  const provider = providerById(payload?.providerId)
  if (!provider) return { ok: false, error: { message: 'Unknown AI provider.', retryable: false } }
  if (!payload.request || typeof payload.request !== 'object') {
    return { ok: false, error: { message: 'Malformed request.', retryable: false } }
  }
  if (payloadSize(payload.request) > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: {
        message: 'That image is too large to send.',
        retryable: false,
        hint: 'Lower the image size in Settings → AI, or use the on-device engine.',
      },
    }
  }

  const apiKey = provider.keyless ? '' : (getKey(provider.id) ?? '')
  if (!provider.keyless && !apiKey) {
    return {
      ok: false,
      error: {
        message: `No ${provider.name} key saved.`,
        retryable: false,
        hint: 'Add one in Settings → AI. It is encrypted with your OS keychain.',
      },
    }
  }

  const modelId = (payload.modelId || provider.defaultModel).trim()
  if (!modelId) return { ok: false, error: { message: 'No model selected.', retryable: false } }

  inFlight?.abort(new Error('superseded'))
  const controller = new AbortController()
  inFlight = controller
  const builtForTimeout = (() => {
    try {
      return buildRequest(provider, apiKey, modelId, payload.request).timeoutMs
    } catch (err) {
      return -1
    }
  })()
  if (builtForTimeout < 0) {
    inFlight = null
    return {
      ok: false,
      error: {
        message: `${provider.name} can't run this kind of request.`,
        retryable: false,
        hint: 'Pick a model with the matching capability in Settings → AI.',
      },
    }
  }

  const timer = setTimeout(() => controller.abort(new Error('timeout')), builtForTimeout)
  try {
    let { response, built } = await attempt(provider, apiKey, modelId, payload.request, payload.baseUrl ?? '', controller.signal)
    if (!response.ok && (response.status === 429 || response.status >= 500)) {
      await new Promise((r) => setTimeout(r, 800))
      ;({ response } = await attempt(provider, apiKey, modelId, payload.request, payload.baseUrl ?? '', controller.signal))
    }
    const text = await response.text()
    const ms = Date.now() - started
    if (!response.ok) {
      return { ok: false, error: normaliseError(response.status, text, provider.name), httpStatus: response.status, ms }
    }
    if (text.length > MAX_TEXT_BYTES) {
      return { ok: false, error: { message: 'Provider response was unexpectedly large.', retryable: false }, ms }
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return {
        ok: false,
        error: { message: `${provider.name} returned a non-JSON response.`, retryable: false },
        ms,
      }
    }
    const result = built.parse(json)
    if (result.text && result.text.length > 200_000) result.text = result.text.slice(0, 200_000)
    return { ok: true, result, httpStatus: response.status, ms }
  } catch (err) {
    const ms = Date.now() - started
    if (controller.signal.aborted) {
      const reason = String((controller.signal.reason as Error)?.message ?? 'aborted')
      if (reason === 'timeout') {
        return {
          ok: false,
          error: { message: `${provider.name} timed out.`, retryable: true, hint: 'Try a smaller image, a faster model, or a local provider.' },
          ms,
        }
      }
      return { ok: false, error: { message: 'Request cancelled.', retryable: false }, ms }
    }
    const message = err instanceof Error ? err.message : String(err)
    const offline = /fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network/i.test(message)
    return {
      ok: false,
      error: {
        message: offline ? `Couldn't reach ${provider.name}.` : message,
        retryable: offline,
        hint: offline
          ? provider.local
            ? `Is ${provider.name} running? Check the base URL in Settings → AI.`
            : 'Check your internet connection or proxy settings.'
          : undefined,
      },
      ms,
    }
  } finally {
    clearTimeout(timer)
    if (inFlight === controller) inFlight = null
  }
}

import { PROVIDERS, providerById } from './providers'

export interface AiSettings {
  /** null = on-device engine only */
  providerId: string | null
  modelId: string
  /** per-provider base URL overrides (Azure resource, local ports, proxies) */
  baseUrls: Record<string, string>
  /** hard opt-in for sending photos to a cloud provider */
  allowImageUpload: boolean
  /** longest edge sent to a provider */
  imageEdge: 768 | 1024 | 1536
  enabled: boolean
}

const SETTINGS_KEY = 'insta-buddy.ai.settings.v1'

export const DEFAULT_AI_SETTINGS: AiSettings = {
  providerId: null,
  modelId: '',
  baseUrls: {},
  allowImageUpload: false,
  imageEdge: 1024,
  enabled: false,
}

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_AI_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<AiSettings>
    return { ...DEFAULT_AI_SETTINGS, ...parsed, baseUrls: { ...(parsed.baseUrls ?? {}) } }
  } catch {
    return { ...DEFAULT_AI_SETTINGS }
  }
}

export function saveAiSettings(settings: AiSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* private mode — settings just won't persist */
  }
}

export function resolveModel(settings: AiSettings): string {
  const provider = settings.providerId ? providerById(settings.providerId) : undefined
  if (!provider) return ''
  return settings.modelId || provider.defaultModel
}

export function resolveBaseUrl(settings: AiSettings, providerId: string): string | undefined {
  const provider = providerById(providerId)
  if (!provider) return undefined
  return settings.baseUrls[providerId]?.trim() || provider.baseUrl
}

/** Keys live in memory only in the browser build — the desktop app uses an encrypted vault. */
const webKeys = new Map<string, string>()

export function setWebKey(providerId: string, key: string) {
  if (key) webKeys.set(providerId, key)
  else webKeys.delete(providerId)
}

export function getWebKey(providerId: string): string | undefined {
  return webKeys.get(providerId)
}

export function hasWebKey(providerId: string) {
  return webKeys.has(providerId)
}

export const CLOUD_PROVIDERS = PROVIDERS.filter((p) => !p.local)
export const LOCAL_PROVIDERS = PROVIDERS.filter((p) => p.local)

import { create } from 'zustand'
import { getBridge } from './ai/bridge'
import { activeModel, activeProvider, testProvider } from './ai/client'
import { PROVIDERS, providerById, type AiProvider } from './ai/providers'
import {
  DEFAULT_AI_SETTINGS,
  hasWebKey,
  loadAiSettings,
  resolveBaseUrl,
  saveAiSettings,
  setWebKey,
  type AiSettings,
} from './ai/settings'
import { reviewPhotoWithAi, type AiAdvice } from './ai/tasks'
import type { Photo } from './types'

export interface AiNotice {
  tone: 'good' | 'warn' | 'info'
  message: string
  hint?: string
}

interface AiStore {
  settings: AiSettings
  desktop: boolean
  vault: { providers: Record<string, boolean>; encryption: string } | null
  open: boolean
  busy: string | null
  notice: AiNotice | null
  advice: Record<string, AiAdvice>
  adviceBusy: string | null
  testing: string | null
  testResult: { providerId: string; ok: boolean; message: string } | null
  captionBusy: boolean

  hydrate: () => Promise<void>
  refreshVault: () => Promise<void>
  setOpen: (open: boolean) => void
  patch: (partial: Partial<AiSettings>) => void
  selectProvider: (providerId: string | null) => void
  selectModel: (modelId: string) => void
  setBaseUrl: (providerId: string, url: string) => void
  hasKey: (providerId: string) => boolean
  saveKey: (providerId: string, key: string) => Promise<void>
  clearKey: (providerId: string) => Promise<void>
  runTest: (providerId?: string) => Promise<void>
  setNotice: (notice: AiNotice | null) => void
  setCaptionBusy: (busy: boolean) => void
  requestAdvice: (photo: Photo) => Promise<void>
  clearAdvice: (photoId: string) => void
  activeLabel: () => string
  provider: () => AiProvider | undefined
}

export const useAiStore = create<AiStore>((set, get) => ({
  settings: { ...DEFAULT_AI_SETTINGS },
  desktop: !!getBridge()?.desktop,
  vault: null,
  open: false,
  busy: null,
  notice: null,
  advice: {},
  adviceBusy: null,
  testing: null,
  testResult: null,
  captionBusy: false,

  hydrate: async () => {
    const settings = loadAiSettings()
    // make sure a stored provider/model pair is still valid
    const provider = settings.providerId ? providerById(settings.providerId) : undefined
    if (settings.providerId && !provider) {
      settings.providerId = null
      settings.enabled = false
    }
    set({ settings, desktop: !!getBridge()?.desktop })
    await get().refreshVault()
  },

  refreshVault: async () => {
    const bridge = getBridge()
    if (!bridge) {
      set({ vault: { providers: Object.fromEntries(PROVIDERS.map((p) => [p.id, hasWebKey(p.id)])), encryption: 'browser-memory' } })
      return
    }
    try {
      const vault = await bridge.ai.status()
      set({ vault })
    } catch {
      set({ vault: null })
    }
  },

  setOpen: (open) => set({ open }),

  patch: (partial) => {
    const settings = { ...get().settings, ...partial }
    saveAiSettings(settings)
    set({ settings })
  },

  selectProvider: (providerId) => {
    const current = get().settings
    if (!providerId) {
      const settings = { ...current, providerId: null, enabled: false, modelId: '' }
      saveAiSettings(settings)
      set({ settings, notice: { tone: 'info', message: 'Back to the on-device engine. Nothing leaves the machine.' } })
      return
    }
    const provider = providerById(providerId)
    if (!provider) return
    const settings: AiSettings = {
      ...current,
      providerId,
      enabled: true,
      modelId: provider.defaultModel,
      allowImageUpload: provider.local ? true : current.allowImageUpload,
    }
    saveAiSettings(settings)
    set({ settings, testResult: null })
  },

  selectModel: (modelId) => {
    const settings = { ...get().settings, modelId, enabled: true }
    saveAiSettings(settings)
    set({ settings })
  },

  setBaseUrl: (providerId, url) => {
    const settings = { ...get().settings, baseUrls: { ...get().settings.baseUrls, [providerId]: url } }
    saveAiSettings(settings)
    set({ settings })
  },

  hasKey: (providerId) => {
    const provider = providerById(providerId)
    if (provider?.keyless) return true
    const vault = get().vault
    if (vault) return !!vault.providers[providerId]
    return hasWebKey(providerId)
  },

  saveKey: async (providerId, key) => {
    const bridge = getBridge()
    if (!bridge) {
      setWebKey(providerId, key)
      await get().refreshVault()
      set({
        notice: {
          tone: 'warn',
          message: 'Key kept in this browser tab only.',
          hint: 'The web build never writes keys to disk. The desktop app stores them in your OS keychain.',
        },
      })
      return
    }
    const res = await bridge.ai.setKey(providerId, key)
    await get().refreshVault()
    set({
      notice: res.ok
        ? { tone: 'good', message: `${providerById(providerId)?.name} key saved to the encrypted vault.` }
        : { tone: 'warn', message: res.error ?? 'Could not save the key.' },
    })
  },

  clearKey: async (providerId) => {
    const bridge = getBridge()
    if (!bridge) setWebKey(providerId, '')
    else await bridge.ai.clearKey(providerId)
    await get().refreshVault()
    set({ notice: { tone: 'info', message: 'Key removed.' } })
  },

  runTest: async (providerId) => {
    const target = providerId ?? get().settings.providerId
    if (!target) return
    set({ testing: target, testResult: null })
    const result = await testProvider(get().settings, target)
    set({ testing: null, testResult: { providerId: target, ok: result.ok, message: result.message } })
  },

  setNotice: (notice) => set({ notice }),
  setCaptionBusy: (captionBusy) => set({ captionBusy }),

  requestAdvice: async (photo) => {
    const settings = get().settings
    if (!settings.providerId) {
      set({
        notice: {
          tone: 'info',
          message: 'No AI provider selected.',
          hint: 'Settings → AI has 12 providers, including local ones. The on-device suggestions keep working without any.',
        },
        open: true,
      })
      return
    }
    set({ adviceBusy: photo.id })
    try {
      const advice = await reviewPhotoWithAi(photo, settings)
      set((s) => ({ advice: { ...s.advice, [photo.id]: advice }, notice: { tone: 'good', message: `Reviewed by ${advice.model}` } }))
    } catch (err) {
      set({
        notice: { tone: 'warn', message: err instanceof Error ? err.message : 'The review failed.', hint: (err as { hint?: string }).hint },
      })
    } finally {
      set({ adviceBusy: null })
    }
  },

  clearAdvice: (photoId) =>
    set((s) => {
      const next = { ...s.advice }
      delete next[photoId]
      return { advice: next }
    }),

  activeLabel: () => {
    const settings = get().settings
    if (!settings.providerId) return 'on-device'
    const provider = providerById(settings.providerId)
    if (!provider) return 'on-device'
    return `${provider.name} · ${resolveModelLabel(settings.modelId, provider.id)}`
  },

  provider: () => activeProvider(get().settings),
}))

function resolveModelLabel(modelId: string, providerId: string) {
  const provider = providerId ? providerById(providerId) : undefined
  return activeModel({ ...DEFAULT_AI_SETTINGS, providerId, modelId }) || provider?.defaultModel || modelId
}

export function aiReadyForImages(settings: AiSettings) {
  return !!settings.providerId && settings.allowImageUpload
}

export function providerBaseUrl(settings: AiSettings, providerId: string) {
  return resolveBaseUrl(settings, providerId) ?? ''
}

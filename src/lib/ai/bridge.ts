import type { AiError, AiRequest, AiResult } from './transport'

export interface AiBridgeRequest {
  providerId: string
  modelId: string
  baseUrl?: string
  request: AiRequest
}

export interface AiBridgeResult {
  ok: boolean
  result?: AiResult
  error?: AiError
  httpStatus?: number
  ms?: number
}

export interface VaultStatus {
  providers: Record<string, boolean>
  encryption: 'os-keychain' | 'obfuscated' | 'unavailable'
}

export interface DroppedFile {
  name: string
  type: string
  lastModified: number
  data: ArrayBuffer
}

export interface BuddyBridge {
  desktop: true
  appInfo: () => Promise<{ version: string; electron: string; platform: string; userData: string }>
  ai: {
    status: () => Promise<VaultStatus>
    setKey: (providerId: string, key: string) => Promise<{ ok: boolean; error?: string }>
    clearKey: (providerId: string) => Promise<{ ok: boolean }>
    request: (payload: AiBridgeRequest) => Promise<AiBridgeResult>
    cancel: () => Promise<{ ok: boolean }>
  }
  files: {
    openImages: () => Promise<DroppedFile[]>
    saveFile: (name: string, data: ArrayBuffer) => Promise<{ saved: boolean; path?: string }>
  }
  openExternal: (url: string) => Promise<{ ok: boolean }>
}

declare global {
  interface Window {
    buddy?: BuddyBridge
  }
}

export function getBridge(): BuddyBridge | undefined {
  return typeof window !== 'undefined' ? window.buddy : undefined
}

export const isDesktop = () => !!getBridge()?.desktop

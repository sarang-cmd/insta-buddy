import { contextBridge, ipcRenderer } from 'electron'
import type { AiBridgeRequest, AiBridgeResult, BuddyBridge, DroppedFile, VaultStatus } from '../src/lib/ai/bridge'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

const bridge: BuddyBridge = {
  desktop: true,
  appInfo: () => invoke('app:info'),
  ai: {
    status: () => invoke<VaultStatus>('ai:status'),
    setKey: (providerId: string, key: string) => invoke('ai:setKey', providerId, key),
    clearKey: (providerId: string) => invoke('ai:clearKey', providerId),
    request: (payload: AiBridgeRequest) => invoke<AiBridgeResult>('ai:request', payload),
    cancel: () => invoke('ai:cancel'),
  },
  files: {
    openImages: () => invoke<DroppedFile[]>('files:openImages'),
    saveFile: (name: string, data: ArrayBuffer) => invoke('files:saveFile', name, data),
  },
  openExternal: (url: string) => invoke('shell:openExternal', url),
}

contextBridge.exposeInMainWorld('buddy', bridge)

// Menu → renderer events (open photos, show settings, export)
const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
for (const channel of ['menu:open-photos', 'menu:settings', 'menu:export', 'menu:review', 'menu:compose']) {
  ipcRenderer.on(channel, () => {
    for (const fn of listeners.get(channel) ?? []) fn()
  })
}

contextBridge.exposeInMainWorld('buddyEvents', {
  on(channel: string, fn: () => void) {
    const list = listeners.get(channel) ?? []
    list.push(fn)
    listeners.set(channel, list)
    return () => {
      const next = (listeners.get(channel) ?? []).filter((f) => f !== fn)
      listeners.set(channel, next)
    }
  },
})

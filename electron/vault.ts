import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

interface VaultFile {
  version: 1
  /** providerId → base64 (encrypted with the OS keychain when available) */
  keys: Record<string, string>
}

function vaultPath() {
  return path.join(app.getPath('userData'), 'ai-keys.json')
}

function read(): VaultFile {
  try {
    const raw = fs.readFileSync(vaultPath(), 'utf8')
    const parsed = JSON.parse(raw) as VaultFile
    if (parsed && typeof parsed.keys === 'object') return { version: 1, keys: parsed.keys }
  } catch {
    /* first run, or corrupt file — start clean */
  }
  return { version: 1, keys: {} }
}

function write(data: VaultFile) {
  const file = vaultPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 })
}

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function vaultEncryption(): 'os-keychain' | 'obfuscated' | 'unavailable' {
  if (encryptionAvailable()) return 'os-keychain'
  return process.platform === 'linux' ? 'obfuscated' : 'unavailable'
}

export function setKey(providerId: string, key: string) {
  const trimmed = key.trim()
  const data = read()
  if (!trimmed) {
    delete data.keys[providerId]
    write(data)
    return { ok: true }
  }
  const stored = encryptionAvailable()
    ? safeStorage.encryptString(trimmed).toString('base64')
    : Buffer.from(trimmed, 'utf8').toString('base64')
  data.keys[providerId] = stored
  write(data)
  return { ok: true }
}

export function clearKey(providerId: string) {
  const data = read()
  delete data.keys[providerId]
  write(data)
  return { ok: true }
}

export function getKey(providerId: string): string | undefined {
  const stored = read().keys[providerId]
  if (!stored) return undefined
  try {
    if (encryptionAvailable()) return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    return Buffer.from(stored, 'base64').toString('utf8')
  } catch {
    return undefined
  }
}

export function keyStatus(providerIds: string[]): Record<string, boolean> {
  const keys = read().keys
  const out: Record<string, boolean> = {}
  for (const id of providerIds) out[id] = !!keys[id]
  return out
}

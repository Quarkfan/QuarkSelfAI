import { lstat } from 'node:fs/promises'
import { recoverInactiveClientInstallation } from './client-installation.js'
import { EncryptedFileDeviceSecretStoreV1 } from './encrypted-file-secret-store.js'
import { MacOsKeychainMasterKeyProviderV1 } from './macos-keychain-master-key.js'
import type { LocalMasterKeyProviderV1 } from './contracts.js'

export interface InstalledDshInferenceSecretReceiptV1 {
  readonly schemaVersion: 1
  readonly installationId: string
  readonly configured: boolean
  readonly state: 'dsh-inference-secret-configured' | 'dsh-inference-secret-absent'
  readonly externalWritesEnabled: false
}

/** Writes only the DSH key named by the sealed local bootstrap plan. */
export async function provisionInstalledDshInferenceSecretV1(installRoot: string, value: Uint8Array, provider?: LocalMasterKeyProviderV1): Promise<InstalledDshInferenceSecretReceiptV1> {
  if (!value.byteLength || value.byteLength > 8_192) throw new Error('DSH inference secret input is invalid')
  const installation = await recoverInactiveClientInstallation(installRoot); const binding = installation.plan.dshInference
  if (!binding) throw new Error('DSH inference binding is not configured')
  const key = await (provider ?? new MacOsKeychainMasterKeyProviderV1(installation.plan.keychainAccount)).load(); let store: EncryptedFileDeviceSecretStoreV1 | undefined
  try { store = await EncryptedFileDeviceSecretStoreV1.open(installation.plan.client.secretRoot, key); await store.put(binding.apiKeyRef, value); return receipt(installation.receipt.installationId, true) }
  finally { store?.close(); key.fill(0) }
}

export async function inspectInstalledDshInferenceSecretV1(installRoot: string, provider?: LocalMasterKeyProviderV1): Promise<InstalledDshInferenceSecretReceiptV1> {
  const installation = await recoverInactiveClientInstallation(installRoot); const binding = installation.plan.dshInference
  if (!binding) throw new Error('DSH inference binding is not configured')
  if (!await secretStoreExists(installation.plan.client.secretRoot)) return receipt(installation.receipt.installationId, false)
  const key = await (provider ?? new MacOsKeychainMasterKeyProviderV1(installation.plan.keychainAccount)).load(); let store: EncryptedFileDeviceSecretStoreV1 | undefined; let value: Uint8Array | undefined
  try { store = await EncryptedFileDeviceSecretStoreV1.open(installation.plan.client.secretRoot, key); value = await store.get(binding.apiKeyRef); return receipt(installation.receipt.installationId, Boolean(value)) }
  finally { value?.fill(0); store?.close(); key.fill(0) }
}

/** Removes only the exact configured reference; installation and device state are preserved. */
export async function removeInstalledDshInferenceSecretV1(installRoot: string, provider?: LocalMasterKeyProviderV1): Promise<InstalledDshInferenceSecretReceiptV1> {
  const installation = await recoverInactiveClientInstallation(installRoot); const binding = installation.plan.dshInference
  if (!binding) throw new Error('DSH inference binding is not configured')
  if (!await secretStoreExists(installation.plan.client.secretRoot)) return receipt(installation.receipt.installationId, false)
  const key = await (provider ?? new MacOsKeychainMasterKeyProviderV1(installation.plan.keychainAccount)).load(); let store: EncryptedFileDeviceSecretStoreV1 | undefined
  try { store = await EncryptedFileDeviceSecretStoreV1.open(installation.plan.client.secretRoot, key); await store.remove(binding.apiKeyRef); return receipt(installation.receipt.installationId, false) }
  finally { store?.close(); key.fill(0) }
}

function receipt(installationId: string, configured: boolean): InstalledDshInferenceSecretReceiptV1 { return Object.freeze({ schemaVersion: 1, installationId, configured, state: configured ? 'dsh-inference-secret-configured' : 'dsh-inference-secret-absent', externalWritesEnabled: false }) }
async function secretStoreExists(root: string): Promise<boolean> { try { await lstat(root); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error } }

import type { DeviceSessionServerPortV1 } from '../control-plane/contracts.js'
import type { ClientRuntimeSnapshotV1, LocalMasterKeyProviderV1, PlanSignatureVerifierV1 } from './contracts.js'
import { EncryptedFileDeviceSecretStoreV1 } from './encrypted-file-secret-store.js'
import { InactiveLocalClientApplicationV1, type LocalClientEnrollmentInputV1, type LocalClientPathsV1 } from './local-client-application.js'
import type { DeviceEnrollmentMaterialV1 } from './device-identity.js'
import type { InactiveClientCycleReceiptV1 } from './inactive-client-cycle.js'

export interface EncryptedLocalClientConfigV1 {
  readonly paths: LocalClientPathsV1
  readonly secretRoot: string
  readonly enrollment: LocalClientEnrollmentInputV1
}

/** Inactive process owner that keeps its local key source and encrypted secret store behind one close boundary. */
export class InactiveEncryptedLocalClientV1 {
  private constructor(readonly application: InactiveLocalClientApplicationV1, readonly enrollment: DeviceEnrollmentMaterialV1 | null, private readonly secrets: EncryptedFileDeviceSecretStoreV1) {}

  static async initialize(config: EncryptedLocalClientConfigV1, verifier: PlanSignatureVerifierV1, masterKeys: LocalMasterKeyProviderV1, now = new Date()): Promise<InactiveEncryptedLocalClientV1> {
    const key = await masterKeys.load()
    if (key.byteLength !== 32) { key.fill(0); throw new Error('local master key provider returned an invalid key') }
    let secrets: EncryptedFileDeviceSecretStoreV1 | undefined
    try {
      secrets = await EncryptedFileDeviceSecretStoreV1.open(config.secretRoot, key)
      const result = await InactiveLocalClientApplicationV1.initialize(config.paths, config.enrollment, verifier, secrets, now)
      return new InactiveEncryptedLocalClientV1(result.application, result.enrollment, secrets)
    } catch (error) { secrets?.close(); throw error }
    finally { key.fill(0) }
  }

  snapshot(now = new Date()): ClientRuntimeSnapshotV1 { return this.application.snapshot(now) }
  async syncOnce(server: DeviceSessionServerPortV1, now = new Date()): Promise<InactiveClientCycleReceiptV1> { return await this.application.syncOnce(server, this.secrets, now) }
  async close(): Promise<void> { try { await this.application.close() } finally { this.secrets.close() } }
}

import { InactiveConfiguredLocalClientV1 } from './configured-local-client.js'
import { recoverInactiveClientInstallation, type InactiveClientInstallationV1 } from './client-installation.js'
import { NoEffectConfiguredClientWorkerV1, type NoEffectClientWorkerConfigV1, type NoEffectClientWorkerDependenciesV1, type NoEffectClientWorkerSnapshotV1, type NoEffectConfiguredClientPortV1 } from './no-effect-client-worker.js'

export interface OwnedConfiguredClientPortV1 extends NoEffectConfiguredClientPortV1 { close(): Promise<void> }

export interface InstalledClientProcessDependenciesV1 {
  readonly recover?: (installRoot: string) => Promise<InactiveClientInstallationV1>
  readonly initialize?: (installation: InactiveClientInstallationV1) => Promise<OwnedConfiguredClientPortV1>
  readonly createWorker?: (config: NoEffectClientWorkerConfigV1, client: NoEffectConfiguredClientPortV1, dependencies?: NoEffectClientWorkerDependenciesV1) => Promise<NoEffectConfiguredClientWorkerV1>
  readonly worker?: NoEffectClientWorkerDependenciesV1
}

export interface InstalledClientProcessSnapshotV1 {
  readonly schemaVersion: 1
  readonly installationId: string
  readonly clientVersion: string
  readonly installationState: 'installed-inactive'
  readonly worker: NoEffectClientWorkerSnapshotV1
  readonly externalWritesEnabled: false
}

/** Owns one recovered configured client and one explicitly started worker behind one close boundary. */
export class InstalledNoEffectClientProcessV1 {
  #closed = false
  private constructor(private readonly installation: InactiveClientInstallationV1, private readonly client: OwnedConfiguredClientPortV1, private readonly worker: NoEffectConfiguredClientWorkerV1) {}

  static async open(installRoot: string, workerConfig: NoEffectClientWorkerConfigV1, dependencies: InstalledClientProcessDependenciesV1 = {}): Promise<InstalledNoEffectClientProcessV1> {
    const installation = await (dependencies.recover ?? recoverInactiveClientInstallation)(installRoot)
    const client = await (dependencies.initialize ?? (async value => await InactiveConfiguredLocalClientV1.initializePinned(value.plan)))(installation)
    try {
      const worker = await (dependencies.createWorker ?? NoEffectConfiguredClientWorkerV1.create)(workerConfig, client, dependencies.worker)
      return new InstalledNoEffectClientProcessV1(installation, client, worker)
    } catch (error) { await client.close(); throw error }
  }

  snapshot(): InstalledClientProcessSnapshotV1 {
    return Object.freeze({ schemaVersion: 1, installationId: this.installation.receipt.installationId, clientVersion: this.installation.receipt.clientVersion, installationState: 'installed-inactive', worker: this.worker.snapshot(), externalWritesEnabled: false })
  }

  start(): void { this.#requireOpen(); this.worker.start() }

  async close(): Promise<void> {
    if (this.#closed) return
    try { await this.worker.stop() } finally { this.#closed = true; await this.client.close() }
  }

  #requireOpen(): void { if (this.#closed) throw new Error('installed client process is closed') }
}

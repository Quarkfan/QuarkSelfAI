import { isAbsolute, resolve } from 'node:path'
import type { DeviceEnrollmentClientPortV1, DeviceSessionServerPortV1 } from '../control-plane/contracts.js'
import type { ClientDeviceEnrollmentViewV1, ClientRuntimeSnapshotV1, ExecutorCapabilityReportV1, LocalDeviceSecretStoreV1, PlanSignatureVerifierV1, RemovableLocalDeviceSecretStoreV1 } from './contracts.js'
import { InactiveArtifactStoreV1, type InactiveArtifactRecoveryReportV1 } from './inactive-artifact-store.js'
import { runInactiveClientCycle, type InactiveClientCycleReceiptV1 } from './inactive-client-cycle.js'
import { LocalClientInstanceLeaseV1 } from './client-instance-lease.js'
import { InactiveClientDeviceEnrollmentV1 } from './client-device-enrollment.js'
import { assertDeviceEnrollmentSecret, createEd25519DeviceEnrollment, type DeviceEnrollmentMaterialV1 } from './device-identity.js'
import { InactiveExecutorDiscoveryV1 } from './discovery.js'
import { openSqliteInactiveClientState, type SqliteInactiveClientStateV1 } from './sqlite-client-state.js'

export interface LocalClientPathsV1 { readonly databasePath: string; readonly migrationPath: string; readonly artifactRoot: string; readonly instanceLeasePath: string }
export interface LocalClientEnrollmentInputV1 { readonly tenantId: string; readonly userId: string; readonly deviceId: string; readonly privateKeyRef: string; readonly attestationReference?: string }

/** A single-owner client composition root. Opening it never connects, probes, loads or runs anything. */
export class InactiveLocalClientApplicationV1 {
  readonly artifacts: InactiveArtifactStoreV1
  readonly recovery: InactiveArtifactRecoveryReportV1
  #connection: ClientRuntimeSnapshotV1['connection'] = 'disconnected'
  #closed = false
  private constructor(private readonly state: SqliteInactiveClientStateV1, artifacts: InactiveArtifactStoreV1, recovery: InactiveArtifactRecoveryReportV1, private readonly lease: LocalClientInstanceLeaseV1) { this.artifacts = artifacts; this.recovery = recovery }

  static async open(paths: LocalClientPathsV1, verifier: PlanSignatureVerifierV1, now = new Date()): Promise<InactiveLocalClientApplicationV1> {
    for (const value of Object.values(paths)) if (!isAbsolute(value)) throw new Error('local client paths must be absolute')
    const lease = await LocalClientInstanceLeaseV1.acquire(resolve(paths.instanceLeasePath), now)
    let state: SqliteInactiveClientStateV1 | undefined
    try {
      state = await openSqliteInactiveClientState(resolve(paths.databasePath), resolve(paths.migrationPath), verifier)
      state.localEnrollment()
      const artifacts = await InactiveArtifactStoreV1.open(resolve(paths.artifactRoot), state)
      const recovery = await artifacts.verifyRecovery()
      return new InactiveLocalClientApplicationV1(state, artifacts, recovery, lease)
    } catch (error) { try { if (state) await state.close() } finally { await lease.release() }; throw error }
  }

  static async enroll(paths: LocalClientPathsV1, input: LocalClientEnrollmentInputV1, verifier: PlanSignatureVerifierV1, secrets: RemovableLocalDeviceSecretStoreV1, now = new Date()): Promise<{ readonly application: InactiveLocalClientApplicationV1; readonly enrollment: DeviceEnrollmentMaterialV1 }> {
    for (const value of Object.values(paths)) if (!isAbsolute(value)) throw new Error('local client paths must be absolute')
    const lease = await LocalClientInstanceLeaseV1.acquire(resolve(paths.instanceLeasePath), now); let state: SqliteInactiveClientStateV1 | undefined; let enrollment: DeviceEnrollmentMaterialV1 | undefined; let persisted = false
    try {
      state = await openSqliteInactiveClientState(resolve(paths.databasePath), resolve(paths.migrationPath), verifier)
      if (state.isEnrolled()) throw new Error('local client is already enrolled')
      enrollment = await createEd25519DeviceEnrollment(input, secrets, now)
      state.enroll(enrollment.identity, enrollment.privateKeyRef); persisted = true
      const artifacts = await InactiveArtifactStoreV1.open(resolve(paths.artifactRoot), state); const recovery = await artifacts.verifyRecovery()
      return Object.freeze({ application: new InactiveLocalClientApplicationV1(state, artifacts, recovery, lease), enrollment })
    } catch (error) {
      if (enrollment && !persisted) await secrets.remove(enrollment.privateKeyRef)
      try { if (state) await state.close() } finally { await lease.release() }
      throw error
    }
  }

  /** Opens the exact enrolled identity or creates it once while holding the same process-owner lease. */
  static async initialize(paths: LocalClientPathsV1, input: LocalClientEnrollmentInputV1, verifier: PlanSignatureVerifierV1, secrets: RemovableLocalDeviceSecretStoreV1, now = new Date()): Promise<{ readonly application: InactiveLocalClientApplicationV1; readonly enrollment: DeviceEnrollmentMaterialV1 | null }> {
    for (const value of Object.values(paths)) if (!isAbsolute(value)) throw new Error('local client paths must be absolute')
    const lease = await LocalClientInstanceLeaseV1.acquire(resolve(paths.instanceLeasePath), now); let state: SqliteInactiveClientStateV1 | undefined; let enrollment: DeviceEnrollmentMaterialV1 | undefined; let persisted = false
    try {
      state = await openSqliteInactiveClientState(resolve(paths.databasePath), resolve(paths.migrationPath), verifier)
      if (state.isEnrolled()) {
        const existing = state.localEnrollment()
        if (existing.identity.tenantId !== input.tenantId || existing.identity.userId !== input.userId || existing.identity.deviceId !== input.deviceId || existing.privateKeyRef !== input.privateKeyRef) throw new Error('local client bootstrap identity does not match persisted enrollment')
        await assertDeviceEnrollmentSecret(existing.identity, existing.privateKeyRef, secrets)
      } else {
        enrollment = await createEd25519DeviceEnrollment(input, secrets, now)
        state.enroll(enrollment.identity, enrollment.privateKeyRef); persisted = true
      }
      const artifacts = await InactiveArtifactStoreV1.open(resolve(paths.artifactRoot), state); const recovery = await artifacts.verifyRecovery()
      return Object.freeze({ application: new InactiveLocalClientApplicationV1(state, artifacts, recovery, lease), enrollment: enrollment ?? null })
    } catch (error) {
      if (enrollment && !persisted) await secrets.remove(enrollment.privateKeyRef)
      try { if (state) await state.close() } finally { await lease.release() }
      throw error
    }
  }

  snapshot(now = new Date()): ClientRuntimeSnapshotV1 {
    this.#requireOpen(); const projection = this.state.cloudProjection(now)
    return Object.freeze({ deviceId: projection.identity.deviceId, connection: this.#connection, registeredCapabilities: projection.installedCapabilityCount,
      activeCapabilities: 0, ownedConsumers: 0, ownedProviders: 0, ownedSchedulers: 0, externalWritesEnabled: false })
  }

  async refreshExecutors(discovery: InactiveExecutorDiscoveryV1, now = new Date()): Promise<readonly ExecutorCapabilityReportV1[]> {
    this.#requireOpen(); const deviceId = this.state.localEnrollment().identity.deviceId
    const reports = await discovery.inspect(deviceId, now)
    for (const report of reports) this.state.saveExecutorReport(report)
    return Object.freeze(reports.map(item => Object.freeze(structuredClone(item))))
  }

  async syncOnce(server: DeviceSessionServerPortV1, secrets: LocalDeviceSecretStoreV1, now = new Date()): Promise<InactiveClientCycleReceiptV1> {
    this.#requireOpen(); this.#connection = 'connecting'
    try { const receipt = await runInactiveClientCycle({ state: this.state, secrets, server, now }); this.#connection = 'online'; return receipt }
    catch (error) { this.#connection = 'degraded'; throw error }
  }

  async beginDeviceEnrollment(server: DeviceEnrollmentClientPortV1, secrets: RemovableLocalDeviceSecretStoreV1, now = new Date()): Promise<ClientDeviceEnrollmentViewV1> { this.#requireOpen(); return await new InactiveClientDeviceEnrollmentV1(this.state, secrets, server).begin(now) }
  async pollDeviceEnrollment(server: DeviceEnrollmentClientPortV1, secrets: RemovableLocalDeviceSecretStoreV1, now = new Date()): Promise<ClientDeviceEnrollmentViewV1> { this.#requireOpen(); return await new InactiveClientDeviceEnrollmentV1(this.state, secrets, server).poll(now) }

  async close(): Promise<void> {
    if (this.#closed) return
    try { await this.state.close() } finally { this.#closed = true; await this.lease.release() }
  }

  #requireOpen(): void { if (this.#closed) throw new Error('local client application is closed') }
}

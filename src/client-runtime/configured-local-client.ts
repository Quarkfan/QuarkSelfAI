import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { DeviceEnrollmentClientPortV1, DeviceSessionServerPortV1 } from '../control-plane/contracts.js'
import type { ClientDeviceEnrollmentViewV1, ClientRuntimeSnapshotV1, ExecutorCapabilityReportV1, LocalMasterKeyProviderV1, LocalMasterKeyProvisionerV1, NoEffectClientExecutorPortV1, PlanSignatureVerifierV1 } from './contracts.js'
import { InactiveEncryptedLocalClientV1, type EncryptedLocalClientConfigV1 } from './encrypted-local-client.js'
import { NodeInactiveHttpDeviceEnrollmentTransportV1 } from './http-device-enrollment-transport.js'
import { NodeInactiveHttpDeviceTransportV1 } from './http-device-transport.js'
import type { InactiveClientCycleReceiptV1, NoEffectClientExecutionReceiptV1 } from './inactive-client-cycle.js'
import { MacOsKeychainMasterKeyLifecycleV1, MacOsKeychainMasterKeyProviderV1 } from './macos-keychain-master-key.js'
import { NodePinnedEd25519PlanVerifierV1 } from './plan-signature.js'
import { NodeInstalledExecutorDiscoveryV1, type InstalledExecutorDiscoveryDependenciesV1 } from './installed-executor-discovery.js'

const idPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/
const referencePattern = /^(?:secret|keychain):[a-z0-9][a-z0-9._:-]{0,127}$/
const accountPattern = /^[a-z0-9][a-z0-9.-]{0,63}$/

export interface InactiveClientBootstrapDocumentV1 {
  readonly schemaVersion: 1
  readonly controlPlaneEndpoint: string
  readonly stateRoot: string
  readonly tenantId: string
  readonly userId: string
  readonly deviceId: string
  readonly privateKeyRef: string
  readonly keychainAccount: string
  readonly planVerification: { readonly keyId: string; readonly publicKey: string }
}

export interface InactiveClientBootstrapPlanV1 {
  readonly schemaVersion: 1
  readonly controlPlaneEndpoint: string
  readonly keychainAccount: string
  readonly planVerification: { readonly keyId: string; readonly publicKey: string }
  readonly client: EncryptedLocalClientConfigV1
  readonly autoConnect: false
  readonly autoPollEnrollment: false
  readonly externalWritesEnabled: false
}

export interface InactiveConfiguredClientDependenciesV1 {
  readonly masterKeys?: LocalMasterKeyProviderV1
  readonly enrollment?: DeviceEnrollmentClientPortV1
  readonly sessions?: DeviceSessionServerPortV1
}

/** Compiles local-only installer input. It neither creates state nor reads a credential. */
export async function compileInactiveClientBootstrap(document: unknown, clientMigrationPath: string): Promise<InactiveClientBootstrapPlanV1> {
  const input = exactDocument(document)
  if (!isAbsolute(clientMigrationPath)) throw new Error('client migration path must be absolute')
  const migration = await lstat(clientMigrationPath)
  if (!migration.isFile() || migration.isSymbolicLink()) throw new Error('client migration must be a regular file')
  const root = resolve(input.stateRoot)
  if (!isAbsolute(input.stateRoot) || root === '/' || root !== input.stateRoot) throw new Error('client state root must be an exact absolute path')
  const state = await lstat(root)
  if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) !== 0 || await realpath(root) !== root) throw new Error('client state root must be a private canonical directory')
  // Construction performs the same endpoint policy check without opening a connection.
  new NodeInactiveHttpDeviceEnrollmentTransportV1(input.controlPlaneEndpoint)
  new NodePinnedEd25519PlanVerifierV1(input.planVerification.keyId, input.planVerification.publicKey)
  return deepFreeze({ schemaVersion: 1, controlPlaneEndpoint: input.controlPlaneEndpoint, keychainAccount: input.keychainAccount, planVerification: { ...input.planVerification },
    client: { paths: { databasePath: join(root, 'client.sqlite3'), migrationPath: clientMigrationPath, artifactRoot: join(root, 'artifacts'), instanceLeasePath: join(root, 'instance') },
      secretRoot: join(root, 'secrets'), enrollment: { tenantId: input.tenantId, userId: input.userId, deviceId: input.deviceId, privateKeyRef: input.privateKeyRef } },
    autoConnect: false, autoPollEnrollment: false, externalWritesEnabled: false })
}

/** One explicit inactive client facade. Construction has no network, discovery, polling, executor or effect side effect. */
export class InactiveConfiguredLocalClientV1 {
  private constructor(private readonly client: InactiveEncryptedLocalClientV1, private readonly enrollment: DeviceEnrollmentClientPortV1, private readonly sessions: DeviceSessionServerPortV1) {}

  static async initializePinned(plan: InactiveClientBootstrapPlanV1, dependencies: InactiveConfiguredClientDependenciesV1 = {}, now = new Date()): Promise<InactiveConfiguredLocalClientV1> {
    return await InactiveConfiguredLocalClientV1.initialize(plan, new NodePinnedEd25519PlanVerifierV1(plan.planVerification.keyId, plan.planVerification.publicKey), dependencies, now)
  }

  static async provisionMasterKey(plan: InactiveClientBootstrapPlanV1, provisioner?: LocalMasterKeyProvisionerV1): Promise<'created' | 'existing'> {
    await assertInactivePlan(plan)
    return await (provisioner ?? new MacOsKeychainMasterKeyLifecycleV1(plan.keychainAccount)).ensure()
  }

  static async initialize(plan: InactiveClientBootstrapPlanV1, verifier: PlanSignatureVerifierV1, dependencies: InactiveConfiguredClientDependenciesV1 = {}, now = new Date()): Promise<InactiveConfiguredLocalClientV1> {
    await assertInactivePlan(plan)
    const masterKeys = dependencies.masterKeys ?? new MacOsKeychainMasterKeyProviderV1(plan.keychainAccount)
    const enrollment = dependencies.enrollment ?? new NodeInactiveHttpDeviceEnrollmentTransportV1(plan.controlPlaneEndpoint)
    const sessions = dependencies.sessions ?? new NodeInactiveHttpDeviceTransportV1(plan.controlPlaneEndpoint)
    const client = await InactiveEncryptedLocalClientV1.initialize(plan.client, verifier, masterKeys, now)
    return new InactiveConfiguredLocalClientV1(client, enrollment, sessions)
  }

  snapshot(now = new Date()): ClientRuntimeSnapshotV1 { return this.client.snapshot(now) }
  async refreshInstalledExecutors(cwd: string, now = new Date(), dependencies: InstalledExecutorDiscoveryDependenciesV1 = {}): Promise<readonly ExecutorCapabilityReportV1[]> { return await this.client.refreshExecutors(new NodeInstalledExecutorDiscoveryV1(cwd, dependencies), now) }
  async beginEnrollment(now = new Date()): Promise<ClientDeviceEnrollmentViewV1> { return await this.client.beginDeviceEnrollment(this.enrollment, now) }
  async pollEnrollment(now = new Date()): Promise<ClientDeviceEnrollmentViewV1> { return await this.client.pollDeviceEnrollment(this.enrollment, now) }
  async syncOnce(now = new Date()): Promise<InactiveClientCycleReceiptV1> { return await this.client.syncOnce(this.sessions, now) }
  async executeNoEffectOnce(executors: readonly NoEffectClientExecutorPortV1[], now = new Date()): Promise<NoEffectClientExecutionReceiptV1> { return await this.client.executeNoEffectOnce(this.sessions, executors, now) }
  async close(): Promise<void> { await this.client.close() }
}

function exactDocument(value: unknown): InactiveClientBootstrapDocumentV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client bootstrap document must be an object')
  const item = value as Record<string, unknown>
  const keys = ['schemaVersion', 'controlPlaneEndpoint', 'stateRoot', 'tenantId', 'userId', 'deviceId', 'privateKeyRef', 'keychainAccount', 'planVerification']
  if (Object.keys(item).sort().join(',') !== keys.sort().join(',') || item.schemaVersion !== 1 || typeof item.controlPlaneEndpoint !== 'string' || typeof item.stateRoot !== 'string' || ![item.tenantId, item.userId, item.deviceId].every(value => typeof value === 'string' && idPattern.test(value)) || typeof item.privateKeyRef !== 'string' || !referencePattern.test(item.privateKeyRef) || typeof item.keychainAccount !== 'string' || !accountPattern.test(item.keychainAccount) || !item.planVerification || typeof item.planVerification !== 'object' || Array.isArray(item.planVerification) || !exactKeys(item.planVerification as Record<string, unknown>, ['keyId', 'publicKey']) || typeof (item.planVerification as Record<string, unknown>).keyId !== 'string' || typeof (item.planVerification as Record<string, unknown>).publicKey !== 'string') throw new Error('client bootstrap document is invalid')
  return item as unknown as InactiveClientBootstrapDocumentV1
}

async function assertInactivePlan(value: unknown): Promise<void> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client bootstrap plan is invalid')
  const plan = value as Record<string, unknown>
  if (!exactKeys(plan, ['schemaVersion', 'controlPlaneEndpoint', 'keychainAccount', 'planVerification', 'client', 'autoConnect', 'autoPollEnrollment', 'externalWritesEnabled']) || plan.schemaVersion !== 1 || plan.autoConnect !== false || plan.autoPollEnrollment !== false || plan.externalWritesEnabled !== false || typeof plan.controlPlaneEndpoint !== 'string' || typeof plan.keychainAccount !== 'string' || !accountPattern.test(plan.keychainAccount) || !plan.planVerification || typeof plan.planVerification !== 'object' || Array.isArray(plan.planVerification) || !exactKeys(plan.planVerification as Record<string, unknown>, ['keyId', 'publicKey'])) throw new Error('client bootstrap plan is not inactive')
  if (!plan.client || typeof plan.client !== 'object' || Array.isArray(plan.client)) throw new Error('client bootstrap plan is invalid')
  const client = plan.client as Record<string, unknown>
  if (!exactKeys(client, ['paths', 'secretRoot', 'enrollment']) || typeof client.secretRoot !== 'string' || !client.paths || typeof client.paths !== 'object' || Array.isArray(client.paths) || !client.enrollment || typeof client.enrollment !== 'object' || Array.isArray(client.enrollment)) throw new Error('client bootstrap plan is invalid')
  const paths = client.paths as Record<string, unknown>; const enrollment = client.enrollment as Record<string, unknown>
  if (!exactKeys(paths, ['databasePath', 'migrationPath', 'artifactRoot', 'instanceLeasePath']) || !Object.values(paths).every(item => typeof item === 'string' && isAbsolute(item)) || !exactKeys(enrollment, ['tenantId', 'userId', 'deviceId', 'privateKeyRef']) || ![enrollment.tenantId, enrollment.userId, enrollment.deviceId].every(item => typeof item === 'string' && idPattern.test(item)) || typeof enrollment.privateKeyRef !== 'string' || !referencePattern.test(enrollment.privateKeyRef)) throw new Error('client bootstrap plan is invalid')
  const root = dirname(paths.databasePath as string)
  if ((paths.databasePath as string) !== join(root, 'client.sqlite3') || client.secretRoot !== join(root, 'secrets') || paths.artifactRoot !== join(root, 'artifacts') || paths.instanceLeasePath !== join(root, 'instance')) throw new Error('client bootstrap paths drifted')
  const rootState = await lstat(root); const migrationState = await lstat(paths.migrationPath as string)
  if (!rootState.isDirectory() || rootState.isSymbolicLink() || (rootState.mode & 0o077) !== 0 || await realpath(root) !== root || !migrationState.isFile() || migrationState.isSymbolicLink()) throw new Error('client bootstrap local paths are unsafe')
  new NodeInactiveHttpDeviceEnrollmentTransportV1(plan.controlPlaneEndpoint)
  const verification = plan.planVerification as Record<string, unknown>
  if (typeof verification.keyId !== 'string' || typeof verification.publicKey !== 'string') throw new Error('client bootstrap plan verification key is invalid')
  new NodePinnedEd25519PlanVerifierV1(verification.keyId, verification.publicKey)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).sort().join(',') === [...keys].sort().join(',') }

function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value) }; return value }

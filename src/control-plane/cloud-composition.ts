import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { DeviceProofVerifierV1, PlanSignatureVerifierV1 } from '../client-runtime/contracts.js'
import { InactiveCloudControlPlaneApplicationV1 } from './cloud-application.js'
import { InactiveCloudHttpHandlerV1 } from './http-handler.js'
import { openSqliteInactiveAgentStudio, type SqliteInactiveAgentStudioV1 } from './sqlite-agent-studio.js'
import { openSqliteInactiveCapabilityRegistry, type SqliteInactiveCapabilityRegistryV1 } from './sqlite-capability-registry.js'
import { openSqliteCloudIdentityProvider, type SqliteCloudIdentityProviderV1 } from './sqlite-cloud-identity.js'
import { openSqliteInactiveDeviceEnrollment, type SqliteInactiveDeviceEnrollmentV1 } from './device-enrollment.js'
import { openSqliteInactiveDeviceSessionProvider, type SqliteInactiveDeviceSessionProviderV1 } from './sqlite-device-session-provider.js'
import { openSqliteTenantControlRepository, type SqliteTenantControlRepositoryV1 } from './sqlite-tenant-repository.js'
import { RoleTenantAuthorizationV1, TenantControlServiceV1 } from './tenant-service.js'
import type { TenantAuthorizationPortV1 } from './tenant-persistence.js'

type TokenSource = { next(label: 'challenge' | 'nonce' | 'session' | 'lease'): string }
export interface CloudControlPlaneMigrationsV1 { readonly tenant: string; readonly studio: string; readonly capability: string; readonly deviceSession: string; readonly deviceEnrollment: string; readonly identity: string; readonly identityAdministration: string }
export interface CloudControlPlaneCompositionConfigV1 { readonly schemaVersion: 1; readonly databasePath: string; readonly migrations: CloudControlPlaneMigrationsV1; readonly listenerEnabled: false; readonly externalEffectsEnabled: false }
export interface CloudControlPlaneCompositionDependenciesV1 { readonly tokens: TokenSource; readonly proofVerifier: DeviceProofVerifierV1; readonly planVerifier: PlanSignatureVerifierV1; readonly authorization?: TenantAuthorizationPortV1 }

/** Opens one registered-tenant provider graph without a listener, scheduler, executor or effect port. */
export class InactiveCloudControlPlaneCompositionV1 {
  readonly application: InactiveCloudControlPlaneApplicationV1
  readonly http: InactiveCloudHttpHandlerV1
  private constructor(identity: SqliteCloudIdentityProviderV1, readonly capabilities: SqliteInactiveCapabilityRegistryV1, readonly studio: SqliteInactiveAgentStudioV1, readonly sessions: SqliteInactiveDeviceSessionProviderV1, readonly enrollment: SqliteInactiveDeviceEnrollmentV1, readonly tenants: SqliteTenantControlRepositoryV1, authorization: TenantAuthorizationPortV1) {
    const devices = new TenantControlServiceV1(tenants, authorization)
    this.application = new InactiveCloudControlPlaneApplicationV1(identity, capabilities, studio, devices, sessions, enrollment, identity)
    this.http = new InactiveCloudHttpHandlerV1(this.application, identity)
    this.identity = identity
  }
  private readonly identity: SqliteCloudIdentityProviderV1

  static async open(configValue: unknown, dependencies: CloudControlPlaneCompositionDependenciesV1): Promise<InactiveCloudControlPlaneCompositionV1> {
    const config = await validateConfig(configValue)
    if (!dependencies || typeof dependencies.tokens?.next !== 'function' || typeof dependencies.proofVerifier?.verify !== 'function' || typeof dependencies.planVerifier?.verify !== 'function' || (dependencies.authorization !== undefined && typeof dependencies.authorization.authorize !== 'function')) throw new Error('cloud composition dependencies are invalid')
    const authorization = dependencies.authorization ?? new RoleTenantAuthorizationV1(); const opened: Array<{ close(): Promise<void> }> = []
    try {
      const tenants = await openSqliteTenantControlRepository(config.databasePath, config.migrations.tenant); opened.push(tenants)
      const identity = await openSqliteCloudIdentityProvider(config.databasePath, [config.migrations.tenant, config.migrations.identity, config.migrations.identityAdministration], authorization); opened.push(identity)
      const capabilities = await openSqliteInactiveCapabilityRegistry(config.databasePath, [config.migrations.tenant, config.migrations.capability], authorization, 'registered'); opened.push(capabilities)
      const studio = await openSqliteInactiveAgentStudio(config.databasePath, [config.migrations.tenant, config.migrations.studio], authorization, 'registered'); opened.push(studio)
      const sessions = await openSqliteInactiveDeviceSessionProvider(config.databasePath, [config.migrations.tenant, config.migrations.deviceSession], dependencies.tokens, dependencies.proofVerifier, dependencies.planVerifier, 'registered'); opened.push(sessions)
      const devices = new TenantControlServiceV1(tenants, authorization)
      const enrollment = await openSqliteInactiveDeviceEnrollment(config.databasePath, config.migrations.deviceEnrollment, devices); opened.push(enrollment)
      return new InactiveCloudControlPlaneCompositionV1(identity, capabilities, studio, sessions, enrollment, tenants, authorization)
    } catch (error) { for (const item of opened.reverse()) { try { await item.close() } catch {} }; throw error }
  }

  async close(): Promise<void> { await this.enrollment.close(); await this.sessions.close(); await this.studio.close(); await this.capabilities.close(); await this.identity.close(); await this.tenants.close() }
}

async function validateConfig(value: unknown): Promise<CloudControlPlaneCompositionConfigV1> {
  if (!isRecord(value)) throw new Error('cloud composition config is invalid')
  const keys = ['schemaVersion', 'databasePath', 'migrations', 'listenerEnabled', 'externalEffectsEnabled']
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',') || value.schemaVersion !== 1 || value.listenerEnabled !== false || value.externalEffectsEnabled !== false || typeof value.databasePath !== 'string' || !isRecord(value.migrations)) throw new Error('cloud composition must remain inactive')
  const migrationKeys = ['tenant', 'studio', 'capability', 'deviceSession', 'deviceEnrollment', 'identity', 'identityAdministration']
  if (Object.keys(value.migrations).sort().join(',') !== migrationKeys.sort().join(',') || Object.values(value.migrations).some(path => typeof path !== 'string')) throw new Error('cloud composition migration set is invalid')
  if (!isAbsolute(value.databasePath) || resolve(value.databasePath) !== value.databasePath || /[\r\n\0]/.test(value.databasePath)) throw new Error('cloud composition database path is invalid')
  const root = dirname(value.databasePath); const state = await lstat(root); const uid = process.getuid?.()
  if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) !== 0 || await realpath(root) !== root || (uid !== undefined && state.uid !== uid)) throw new Error('cloud composition root must be private, owned and canonical')
  const database = await lstat(value.databasePath)
  if (!database.isFile() || database.isSymbolicLink() || database.nlink !== 1 || (database.mode & 0o077) !== 0 || await realpath(value.databasePath) !== value.databasePath || (uid !== undefined && database.uid !== uid)) throw new Error('cloud composition database is unsafe')
  for (const path of Object.values(value.migrations) as string[]) { if (!isAbsolute(path) || resolve(path) !== path || /[\r\n\0]/.test(path)) throw new Error('cloud composition migration path is invalid'); const item = await lstat(path); if (!item.isFile() || item.isSymbolicLink() || item.nlink !== 1 || await realpath(path) !== path) throw new Error('cloud composition migration is invalid') }
  return value as unknown as CloudControlPlaneCompositionConfigV1
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }

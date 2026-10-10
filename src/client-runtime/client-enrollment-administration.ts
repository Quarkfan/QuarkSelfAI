import { lstat } from 'node:fs/promises'
import { recoverInactiveClientInstallation } from './client-installation.js'
import { InactiveConfiguredLocalClientV1, type InactiveConfiguredClientDependenciesV1 } from './configured-local-client.js'
import type { ClientDeviceEnrollmentViewV1 } from './contracts.js'

export interface InstalledClientEnrollmentReceiptV1 {
  readonly schemaVersion: 1
  readonly installationId: string
  readonly state: ClientDeviceEnrollmentViewV1['state']
  readonly userCode: string
  readonly verificationPath: '/devices/activate'
  readonly expiresAt: string
  readonly pollAfterSeconds: 5
  readonly credentialCleanupPending: boolean
  readonly serviceRegistered: false
  readonly serviceStarted: false
  readonly externalWritesEnabled: false
}

/** Starts one explicit device-code enrollment without activating the client service. */
export async function beginInstalledClientEnrollmentV1(installRoot: string, dependencies: InactiveConfiguredClientDependenciesV1 = {}, now = new Date()): Promise<InstalledClientEnrollmentReceiptV1> {
  return await operate(installRoot, dependencies, client => client.beginEnrollment(now))
}

/** Advances only the existing local enrollment request and preserves pending state on transport failure. */
export async function pollInstalledClientEnrollmentV1(installRoot: string, dependencies: InactiveConfiguredClientDependenciesV1 = {}, now = new Date()): Promise<InstalledClientEnrollmentReceiptV1> {
  return await operate(installRoot, dependencies, client => client.pollEnrollment(now))
}

/** Activation preflight: an initialized local identity is insufficient until cloud approval is durable. */
export async function assertInstalledClientEnrollmentApprovedV1(installRoot: string, dependencies: InactiveConfiguredClientDependenciesV1 = {}): Promise<InstalledClientEnrollmentReceiptV1> {
  const installation = await recoverInactiveClientInstallation(installRoot)
  try { await lstat(installation.plan.client.paths.databasePath) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('client device enrollment is unavailable'); throw error }
  const client = await InactiveConfiguredLocalClientV1.initializePinned(installation.plan, dependencies)
  try { const enrollment = client.enrollmentStatus(); if (!enrollment || enrollment.state !== 'approved' || enrollment.credentialCleanupPending) throw new Error('client device enrollment is not approved'); return receipt(installation.receipt.installationId, enrollment) }
  finally { await client.close() }
}

async function operate(installRoot: string, dependencies: InactiveConfiguredClientDependenciesV1, operation: (client: InactiveConfiguredLocalClientV1) => Promise<ClientDeviceEnrollmentViewV1>): Promise<InstalledClientEnrollmentReceiptV1> {
  const installation = await recoverInactiveClientInstallation(installRoot); const client = await InactiveConfiguredLocalClientV1.initializePinned(installation.plan, dependencies)
  try { return receipt(installation.receipt.installationId, await operation(client)) } finally { await client.close() }
}
function receipt(installationId: string, enrollment: ClientDeviceEnrollmentViewV1): InstalledClientEnrollmentReceiptV1 { return Object.freeze({ schemaVersion: 1, installationId, state: enrollment.state, userCode: enrollment.userCode, verificationPath: enrollment.verificationPath, expiresAt: enrollment.expiresAt, pollAfterSeconds: enrollment.pollAfterSeconds, credentialCleanupPending: enrollment.credentialCleanupPending, serviceRegistered: false, serviceStarted: false, externalWritesEnabled: false }) }

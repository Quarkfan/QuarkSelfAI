import type { SignedExecutionPlanV1 } from '../client-runtime/contracts.js'

export interface TenantContextV1 {
  readonly tenantId: string
  readonly userId: string
  readonly roles: readonly ('owner' | 'member' | 'auditor')[]
}

export interface TenantRecordV1 { readonly tenantId: string; readonly name: string; readonly state: 'test' | 'active' | 'suspended'; readonly createdAt: string }
export interface UserRecordV1 { readonly tenantId: string; readonly userId: string; readonly displayName: string; readonly state: 'active' | 'disabled'; readonly createdAt: string }
export interface DeviceRecordV1 { readonly tenantId: string; readonly userId: string; readonly deviceId: string; readonly publicKey: string; readonly state: 'pending' | 'registered' | 'revoked'; readonly createdAt: string }
export interface CapabilityReleaseRecordV1 { readonly tenantId: string; readonly capabilityId: string; readonly version: string; readonly artifactDigest: string; readonly visibility: 'private' | 'tenant' | 'public'; readonly state: 'draft' | 'verified' | 'retired'; readonly createdAt: string }
export interface BlueprintReleaseRecordV1 { readonly tenantId: string; readonly blueprintId: string; readonly version: string; readonly blueprintDigest: string; readonly state: 'draft' | 'test' | 'shadow' | 'released' | 'retired'; readonly createdAt: string }
export interface DispatchRecordV1 { readonly tenantId: string; readonly userId: string; readonly taskId: string; readonly deviceId: string; readonly plan: SignedExecutionPlanV1; readonly idempotencyKey: string; readonly state: 'queued' | 'leased' | 'completed' | 'failed' | 'cancelled'; readonly createdAt: string }
export interface RedactedResultV1 { readonly tenantId: string; readonly userId: string; readonly taskId: string; readonly outcome: 'succeeded' | 'failed' | 'cancelled'; readonly summaryCode: string; readonly artifactDigests: readonly string[]; readonly completedAt: string }
export interface TenantAuditRecordV1 { readonly tenantId: string; readonly auditId: string; readonly actorUserId: string; readonly action: string; readonly subjectRef: string; readonly outcome: 'allowed' | 'denied'; readonly occurredAt: string }

export interface TestTenantControlPlanePortV1 {
  createTestTenant(input: { readonly tenantId: string; readonly name: string }, now?: Date): TenantRecordV1
  registerUser(context: TenantContextV1, input: { readonly userId: string; readonly displayName: string }, now?: Date): UserRecordV1
  registerDevice(context: TenantContextV1, input: { readonly deviceId: string; readonly publicKey: string }, now?: Date): DeviceRecordV1
  publishCapability(context: TenantContextV1, input: Omit<CapabilityReleaseRecordV1, 'tenantId' | 'createdAt'>, now?: Date): CapabilityReleaseRecordV1
  publishBlueprint(context: TenantContextV1, input: Omit<BlueprintReleaseRecordV1, 'tenantId' | 'createdAt'>, now?: Date): BlueprintReleaseRecordV1
  dispatch(context: TenantContextV1, input: Omit<DispatchRecordV1, 'tenantId' | 'userId' | 'state' | 'createdAt'>, now?: Date): DispatchRecordV1
  complete(context: TenantContextV1, result: Omit<RedactedResultV1, 'tenantId' | 'userId'>): RedactedResultV1
}

export interface ExecutionPlanSignerV1 {
  readonly keyId: string
  sign(input: { readonly algorithm: 'ed25519'; readonly payloadDigest: string }): Promise<string>
}

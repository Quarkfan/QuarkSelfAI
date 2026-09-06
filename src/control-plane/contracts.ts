import type { ArtifactVerificationReportV1, DeviceSessionChallengeV1, DeviceSessionProofV1, DeviceSessionV1, DeviceTaskLeaseAcknowledgementV1, DeviceTaskLeaseV1, SignedExecutionPlanV1 } from '../client-runtime/contracts.js'
import type { AgentBlueprintV1 } from '../capability-platform/blueprint.js'
import type { ManifestPublicationCandidateV1 } from '../capability-platform/artifact-candidates.js'
import type { CapabilityManifestV1 } from '../capability-platform/manifest.js'

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
export interface RedactedResultV1 { readonly tenantId: string; readonly userId: string; readonly deviceId: string; readonly taskId: string; readonly planId: string; readonly outcome: 'succeeded' | 'failed' | 'cancelled'; readonly summaryCode: string; readonly artifactDigests: readonly string[]; readonly completedAt: string }
export interface TenantAuditRecordV1 { readonly tenantId: string; readonly auditId: string; readonly actorUserId: string; readonly action: string; readonly subjectRef: string; readonly outcome: 'allowed' | 'denied'; readonly occurredAt: string }

export type { TenantAuthorizationPortV1, TenantControlActionV1, TenantControlRepositoryV1 } from './tenant-persistence.js'

export interface TestTenantControlPlanePortV1 {
  createTestTenant(input: { readonly tenantId: string; readonly name: string }, now?: Date): TenantRecordV1
  registerUser(context: TenantContextV1, input: { readonly userId: string; readonly displayName: string }, now?: Date): UserRecordV1
  registerDevice(context: TenantContextV1, input: { readonly deviceId: string; readonly publicKey: string }, now?: Date): DeviceRecordV1
  publishCapability(context: TenantContextV1, input: Omit<CapabilityReleaseRecordV1, 'tenantId' | 'createdAt'>, now?: Date): CapabilityReleaseRecordV1
  publishBlueprint(context: TenantContextV1, input: Omit<BlueprintReleaseRecordV1, 'tenantId' | 'createdAt'>, now?: Date): BlueprintReleaseRecordV1
  dispatch(context: TenantContextV1, input: Omit<DispatchRecordV1, 'tenantId' | 'userId' | 'state' | 'createdAt'>, now?: Date): DispatchRecordV1
  acknowledgeLease(context: TenantContextV1, input: { readonly taskId: string; readonly planId: string; readonly deviceId: string }, now?: Date): DispatchRecordV1
  complete(context: TenantContextV1, result: Omit<RedactedResultV1, 'tenantId' | 'userId'>): RedactedResultV1
}

export interface ExecutionPlanSignerV1 {
  readonly keyId: string
  sign(input: { readonly algorithm: 'ed25519'; readonly payloadDigest: string }): Promise<string>
}

export interface AgentDraftRecordV1 {
  readonly tenantId: string
  readonly userId: string
  readonly draftId: string
  readonly blueprint: AgentBlueprintV1
  readonly revision: number
  readonly state: 'draft' | 'test-released'
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AgentTestReleaseV1 {
  readonly tenantId: string
  readonly userId: string
  readonly draftId: string
  readonly blueprintId: string
  readonly version: string
  readonly blueprintDigest: string
  readonly draftRevision: number
  readonly state: 'test'
  readonly createdAt: string
}

export interface TestAgentStudioPortV1 {
  saveDraft(context: TenantContextV1, input: { readonly draftId: string; readonly blueprint: AgentBlueprintV1; readonly expectedRevision: number }, now?: Date): AgentDraftRecordV1
  publishTest(context: TenantContextV1, input: { readonly draftId: string; readonly expectedRevision: number }, now?: Date): AgentTestReleaseV1
  getDraft(context: TenantContextV1, draftId: string): AgentDraftRecordV1 | undefined
  listDrafts(context: TenantContextV1): readonly AgentDraftRecordV1[]
}

export interface PersistentAgentStudioPortV1 {
  saveDraft(context: TenantContextV1, input: { readonly draftId: string; readonly blueprint: AgentBlueprintV1; readonly expectedRevision: number }, now?: Date): Promise<AgentDraftRecordV1>
  publishTest(context: TenantContextV1, input: { readonly draftId: string; readonly expectedRevision: number }, now?: Date): Promise<AgentTestReleaseV1>
  getDraft(context: TenantContextV1, draftId: string): Promise<AgentDraftRecordV1 | undefined>
  listDrafts(context: TenantContextV1): Promise<readonly AgentDraftRecordV1[]>
  close(): Promise<void>
}

export interface CapabilityCatalogRecordV1 {
  readonly tenantId: string
  readonly ownerUserId: string
  readonly manifest: CapabilityManifestV1
  readonly manifestDigest: string
  readonly evidencePolicyRevision: string
  readonly visibility: 'private' | 'tenant'
  readonly state: 'catalogued-inactive'
  readonly registeredAt: string
  readonly consumerCount: 0
  readonly providerLease: null
  readonly schedulerCount: 0
  readonly externalWritesEnabled: false
}

export interface PersistentCapabilityRegistryPortV1 {
  registerInactive(context: TenantContextV1, input: { readonly candidate: ManifestPublicationCandidateV1; readonly evidence: ArtifactVerificationReportV1; readonly visibility: 'private' | 'tenant' }, now?: Date): Promise<CapabilityCatalogRecordV1>
  get(context: TenantContextV1, capabilityId: string, version: string): Promise<CapabilityCatalogRecordV1 | undefined>
  listVisible(context: TenantContextV1): Promise<readonly CapabilityCatalogRecordV1[]>
  close(): Promise<void>
}

export interface TenantDevicePortV1 {
  registerDevice(context: TenantContextV1, input: { readonly deviceId: string; readonly publicKey: string }, now?: Date): Promise<DeviceRecordV1>
  listDevices(context: TenantContextV1): Promise<readonly DeviceRecordV1[]>
}

export interface DeviceSessionServerPortV1 {
  /** Pre-authentication entry: public scope selects an enrolled device; proof still establishes possession. */
  issueChallenge(input: { readonly tenantId: string; readonly userId: string; readonly deviceId: string }, now?: Date): Promise<DeviceSessionChallengeV1>
  openSession(proof: DeviceSessionProofV1, now?: Date): Promise<DeviceSessionV1>
  poll(sessionId: string, now?: Date): Promise<DeviceTaskLeaseV1 | null>
  acknowledge(sessionId: string, input: { readonly leaseToken: string; readonly taskId: string }, now?: Date): Promise<DeviceTaskLeaseAcknowledgementV1>
  submitResult(sessionId: string, input: Omit<RedactedResultV1, 'tenantId' | 'userId'>, now?: Date): Promise<RedactedResultV1>
}

export interface DeviceDispatchQueuePortV1 {
  enqueue(dispatch: DispatchRecordV1, now?: Date): Promise<DispatchRecordV1>
}

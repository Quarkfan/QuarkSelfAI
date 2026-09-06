import type { ApprovalGrantV1, WorkspaceGrantV1 } from './permissions.js'

export interface ExecutionCapabilityRefV1 {
  readonly id: string
  readonly version: string
  readonly artifactDigest: string
}

export interface ExecutionContextReferenceV1 {
  readonly id: string
  readonly kind: string
  readonly dataClass: string
  readonly location: 'local' | 'cloud'
  readonly opaqueReference: string
}

export interface ExecutionEnvelopeV1 {
  readonly schemaVersion: 1
  readonly tenantId: string
  readonly userId: string
  readonly deviceId: string
  readonly agentId: string
  readonly runId: string
  readonly actionId: string
  readonly blueprint: { readonly id: string; readonly version: string; readonly digest: string }
  readonly capabilities: readonly ExecutionCapabilityRefV1[]
  readonly context: readonly ExecutionContextReferenceV1[]
  readonly workspaceGrants: readonly WorkspaceGrantV1[]
  readonly approvalGrants: readonly ApprovalGrantV1[]
  readonly idempotencyKey: string
  readonly deadline: string
  readonly budget: { readonly tokens: number; readonly durationMs: number; readonly costMinorUnits: number }
  readonly dataClasses: readonly string[]
  readonly allowedEffects: readonly string[]
  readonly continuity: {
    readonly sessionId: string | null
    readonly continuationToken: string | null
    readonly fallbackAllowed: boolean
    readonly midActionSwitchAllowed: false
  }
  readonly plan: { readonly digest: string; readonly signature: string; readonly keyId: string }
}

export interface ExecutorAdapterInputV1 {
  readonly executorId: string
  readonly envelope: ExecutionEnvelopeV1
  readonly normalizedContextDigest: string
}


import type { CapabilityPermissionDeclarationV1 } from './permissions.js'

export type AgentBlueprintReleaseState = 'draft' | 'test' | 'shadow' | 'released' | 'retired'

export interface AgentCapabilityReferenceV1 {
  readonly id: string
  readonly versionRange: string
  readonly artifactDigest: string
  readonly required: boolean
}

export interface AgentGraphNodeV1 {
  readonly id: string
  readonly capabilityId: string
  readonly interfaceId: string
  readonly configuration: Readonly<Record<string, unknown>>
}

export interface AgentGraphEdgeV1 {
  readonly from: string
  readonly to: string
  readonly output: string
  readonly input: string
}

export interface AgentTriggerV1 {
  readonly id: string
  readonly kind: 'manual' | 'event' | 'schedule'
  readonly specification: string
  readonly timezone?: string
  readonly enabled: boolean
}

export interface AgentExecutorPolicyV1 {
  readonly preferred: readonly string[]
  readonly fallback: readonly string[]
  readonly allowInfrastructureFallback: boolean
  readonly allowMidActionSwitch: false
  readonly preserveSessionContinuity: true
}

export interface AgentBlueprintV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly version: string
  readonly revision: string
  readonly digest: string
  readonly releaseState: AgentBlueprintReleaseState
  readonly role: string
  readonly goals: readonly string[]
  readonly capabilities: readonly AgentCapabilityReferenceV1[]
  readonly graph: { readonly nodes: readonly AgentGraphNodeV1[]; readonly edges: readonly AgentGraphEdgeV1[] }
  readonly triggers: readonly AgentTriggerV1[]
  readonly executorPolicy: AgentExecutorPolicyV1
  readonly deviceSelector: string
  readonly workspaceHandles: readonly string[]
  readonly permissions: readonly CapabilityPermissionDeclarationV1[]
  readonly modelPolicy: { readonly allowed: readonly string[]; readonly preferred: string | null }
  readonly budget: { readonly tokens: number; readonly durationMs: number; readonly costMinorUnits: number }
  readonly retry: { readonly infrastructureAttempts: number; readonly deterministicAttempts: 1 }
  readonly notifications: { readonly channels: readonly string[]; readonly on: readonly ('approval' | 'completion' | 'failure')[] }
  readonly retention: { readonly localRawDays: number; readonly cloudSummaryDays: number }
}


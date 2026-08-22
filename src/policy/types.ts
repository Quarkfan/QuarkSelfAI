export type PolicyFact =
  | 'channel.chatType'
  | 'channel.external'
  | 'source.chatId'
  | 'source.senderId'
  | 'message.text'
  | 'message.mentionsOwner'
  | 'message.hasDeadline'
  | 'relation.kind'
  | 'business.tags'
  | 'attention.current'
  | 'urgency'

export type PolicyOperator = 'eq' | 'neq' | 'contains' | 'in' | 'exists' | 'gte' | 'lte'

export interface FactCondition {
  readonly fact: PolicyFact
  readonly op: PolicyOperator
  readonly value?: string | number | boolean | readonly string[]
}

export type PolicyCondition =
  | FactCondition
  | { readonly all: readonly PolicyCondition[] }
  | { readonly any: readonly PolicyCondition[] }
  | { readonly not: PolicyCondition }

export interface PolicyEffect {
  readonly attention?: 'unchanged' | 'silent' | 'batch' | 'realtime'
  readonly task?: 'unchanged' | 'ignore' | 'upsert'
  readonly reply?: 'never' | 'draft' | 'ask'
  readonly settleMinutes?: number
  readonly addTags?: readonly string[]
}

export interface PolicyDocument {
  readonly version: 1
  readonly name: string
  readonly description: string
  readonly priority: number
  readonly when: PolicyCondition
  readonly effect: PolicyEffect
  readonly expiresAt?: string
}

export interface PolicySample {
  readonly id: string
  readonly facts: Readonly<Record<string, unknown>>
}

export interface PolicySimulation {
  readonly sampleCount: number
  readonly matchedCount: number
  readonly silentCount: number
  readonly batchCount: number
  readonly realtimeCount: number
  readonly urgentSuppressedCount: number
  readonly safeToActivate: boolean
  readonly matchedSampleIds: readonly string[]
}

export interface PolicyCandidate {
  readonly sourceText: string
  readonly document: PolicyDocument
  readonly simulation: PolicySimulation
}

export interface NaturalLanguagePolicyCompiler {
  compile(sourceText: string, samples: readonly PolicySample[], signal: AbortSignal): Promise<PolicyCandidate>
}

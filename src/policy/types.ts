export type PolicyOperator = 'eq' | 'neq' | 'contains' | 'in' | 'exists' | 'gte' | 'lte'

export interface FactCondition {
  /** Open dotted fact id supplied by the product policy schema. */
  readonly fact: string
  readonly op: PolicyOperator
  readonly value?: string | number | boolean | readonly string[]
}

export type PolicyCondition =
  | FactCondition
  | { readonly all: readonly PolicyCondition[] }
  | { readonly any: readonly PolicyCondition[] }
  | { readonly not: PolicyCondition }

export interface PolicyDocument<Effect extends object = object> {
  readonly version: 1
  readonly name: string
  readonly description: string
  readonly priority: number
  readonly when: PolicyCondition
  readonly effect: Effect
  readonly expiresAt?: string
}

export interface PolicySample {
  readonly id: string
  readonly facts: Readonly<Record<string, unknown>>
}

export interface PolicySimulation {
  readonly sampleCount: number
  readonly matchedCount: number
  readonly coverageSufficient: boolean
  readonly safeToActivate: boolean
  readonly matchedSampleIds: readonly string[]
  /** Product-owned metrics remain serializable without entering the skeleton vocabulary. */
  readonly [metric: string]: unknown
}

export interface PolicyCandidate<Document extends PolicyDocument<object> = PolicyDocument<object>, Simulation extends PolicySimulation = PolicySimulation> {
  readonly sourceText: string
  readonly document: Document
  readonly simulation: Simulation
}

export interface NaturalLanguagePolicyCompiler<Candidate extends PolicyCandidate = PolicyCandidate> {
  compile(sourceText: string, samples: readonly PolicySample[], signal: AbortSignal): Promise<Candidate>
}

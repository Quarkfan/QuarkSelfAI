import { randomUUID } from 'node:crypto'
import type { AssistantStore } from '../storage/types.js'
import { policyRequiresApproval, simulatePolicy, validatePolicy } from './engine.js'
import type { NaturalLanguagePolicyCompiler, PolicyDocument, PolicySample, PolicySimulation } from './types.js'

export interface PolicyProposal {
  readonly id: string
  readonly revision: number
  readonly document: PolicyDocument
  readonly simulation: PolicySimulation
  readonly requiresApproval: boolean
}

export class PolicyAuthoringService {
  constructor(
    private readonly store: AssistantStore,
    private readonly compiler: NaturalLanguagePolicyCompiler,
  ) {}

  async propose(sourceText: string, samples: readonly PolicySample[], signal: AbortSignal): Promise<PolicyProposal> {
    if (!sourceText.trim() || sourceText.length > 4_000) throw new Error('policy request must contain 1-4000 characters')
    const candidate = await this.compiler.compile(sourceText, samples, signal)
    validatePolicy(candidate.document)
    // Never trust a model-supplied simulation; recompute against the exact local samples.
    const simulation = simulatePolicy(candidate.document, samples)
    const id = randomUUID()
    const revision = await this.store.savePolicyDraft({
      id,
      name: candidate.document.name,
      sourceText,
      document: candidate.document,
      simulation,
    })
    return {
      id,
      revision,
      document: candidate.document,
      simulation,
      requiresApproval: policyRequiresApproval(candidate.document),
    }
  }

  async activate(id: string, revision: number, ownerConfirmed: boolean): Promise<void> {
    if (!ownerConfirmed) throw new Error('explicit owner confirmation is required to activate a policy')
    await this.store.activatePolicy(id, revision, new Date().toISOString())
  }
}

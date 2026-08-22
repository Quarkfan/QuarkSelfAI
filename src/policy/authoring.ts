import { createHash, randomUUID } from 'node:crypto'
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

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function policyProposalId(sourceText: string, document: PolicyDocument): string {
  const digest = createHash('sha256').update(sourceText.trim()).update('\0').update(canonical(document)).digest('hex')
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`
}

export class PolicyAuthoringService {
  constructor(
    private readonly store: AssistantStore,
    private readonly compiler: NaturalLanguagePolicyCompiler,
  ) {}

  async propose(sourceText: string, samples: readonly PolicySample[], signal: AbortSignal): Promise<PolicyProposal> {
    if (!sourceText.trim() || sourceText.length > 4_000) throw new Error('policy request must contain 1-4000 characters')
    const candidate = await this.compiler.compile(sourceText, samples, signal)
    return await this.proposeCompiled(sourceText, candidate.document, samples)
  }

  async proposeCompiled(
    sourceText: string,
    document: PolicyDocument,
    samples: readonly PolicySample[],
    id: string = randomUUID(),
  ): Promise<PolicyProposal> {
    if (!sourceText.trim() || sourceText.length > 4_000) throw new Error('policy request must contain 1-4000 characters')
    validatePolicy(document)
    // Never trust a model-supplied simulation; recompute against the exact local samples.
    const simulation = simulatePolicy(document, samples)
    const revision = await this.store.savePolicyDraft({
      id,
      name: document.name,
      sourceText,
      document,
      simulation,
    })
    return {
      id,
      revision,
      document,
      simulation,
      requiresApproval: policyRequiresApproval(document),
    }
  }

  async activate(id: string, revision: number, ownerConfirmed: boolean): Promise<void> {
    if (!ownerConfirmed) throw new Error('explicit owner confirmation is required to activate a policy')
    await this.store.activatePolicy(id, revision, new Date().toISOString())
  }

  async rollback(id: string, revision: number, ownerConfirmed: boolean): Promise<void> {
    if (!ownerConfirmed) throw new Error('explicit owner confirmation is required to roll back a policy')
    await this.store.activatePolicy(id, revision, new Date().toISOString())
  }
}

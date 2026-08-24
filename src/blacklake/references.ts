import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { ExecutorId, SourceRef } from '../domain/contracts.js'
import { WorkspacePolicy } from '../execution/workspace-policy.js'
import type { DurableActionInput } from '../storage/types.js'

const REQUIRED_SOURCES = [
  'docs/guides/reference-projects/blacklake-reference-router.md',
  'ai/ai-devops-knowledge-base/README.md',
  'ai/ai-devops-knowledge-base/indexes/knowledge-docs.md',
  'ai/ai-devops-knowledge-base/indexes/rules.md',
  'ai/devops-virtual-employee/README.md',
  'ai/devops-virtual-employee/AGENTS.md',
  'ai/devops-virtual-employee/skills/virtual-employee-router/SKILL.md',
  'harness/bl-common-harness/README.md',
  'harness/bl-common-harness/CLAUDE.md',
  'harness/bl-common-harness/.claude/rules/skill-routing.md',
] as const

const SKILL_DIRECTORIES = [
  'ai/devops-virtual-employee/skills',
  'harness/bl-common-harness/.claude/skills',
] as const

function compact(text: string, maximum = 24_000): string {
  const selected = text.split('\n').filter((line) => /^(#|\||-|\d+\.)/.test(line.trim())).join('\n').trim()
  return selected.length <= maximum ? selected : `${selected.slice(0, maximum)}\n[content truncated]`
}

function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function skillNames(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const names: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const text = await readFile(join(directory, entry.name, 'SKILL.md'), 'utf8')
      const match = /^name:\s*(.+)$/m.exec(text)
      if (match?.[1]) names.push(match[1].trim())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return names
}

export interface BlacklakeReferenceConfig {
  readonly workspaceRoot: string
}

export interface BlacklakeReferenceSnapshot {
  readonly workspaceRoot: string
  readonly generatedAt: string
  readonly sources: readonly { readonly path: string; readonly sha256: string; readonly modifiedAt: string }[]
  readonly skills: readonly string[]
}

export interface BlacklakeRouteCandidate {
  readonly blacklakeRelated: boolean
  readonly recommendedSkills: readonly string[]
  readonly operationChain: boolean
  readonly reason: string
}

export type BlacklakeResearchDecision = 'start' | 'confirm' | 'skip'

export interface BlacklakeResearchPlanInput {
  readonly actionId: string
  readonly matterId: string
  readonly title: string
  readonly summary: string
  readonly source: SourceRef
  readonly workspace: string
  readonly candidate: BlacklakeRouteCandidate
  readonly researchDecision: BlacklakeResearchDecision
  readonly decisionReason: string
  readonly expectedBenefit: string
  readonly evidenceGap: string
  readonly researchPrompt?: string
  readonly requestedExecutor?: ExecutorId
  readonly risk: 'production' | 'security' | 'customer-blocking' | 'ordinary'
  readonly goalClear: boolean
  readonly evidenceNeedsLocalInspection: boolean
  readonly expectedDirectValue: boolean
  readonly approvalId?: string
  readonly approvalPrompt?: string
}

export interface BlacklakeResearchPlanResult {
  readonly decision: BlacklakeResearchDecision
  readonly enqueued: boolean
  readonly awaitingApproval: boolean
  readonly actionId?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    blacklakeReferences: BlacklakeReferenceService
  }
}

export class BlacklakeReferenceService extends Service {
  private readonly root: string

  constructor(ctx: Context, config: BlacklakeReferenceConfig) {
    super(ctx, 'blacklakeReferences')
    if (!config.workspaceRoot?.trim()) throw new Error('blacklake reference workspaceRoot is required')
    this.root = resolve(config.workspaceRoot)
  }

  async inspect(): Promise<BlacklakeReferenceSnapshot> {
    const policy = await WorkspacePolicy.create([this.root])
    const root = await policy.authorizeExisting(this.root)
    const sources = await Promise.all(REQUIRED_SOURCES.map(async (path) => {
      const filename = await policy.authorizeExisting(join(root, path))
      const [text, metadata] = await Promise.all([readFile(filename, 'utf8'), stat(filename)])
      return { path: relative(root, filename), sha256: fingerprint(text), modifiedAt: metadata.mtime.toISOString() }
    }))
    const skills = new Set<string>(['blacklake-reference-router'])
    for (const directory of SKILL_DIRECTORIES) {
      const filename = await policy.authorizeExisting(join(root, directory))
      for (const name of await skillNames(filename)) skills.add(name)
    }
    return {
      workspaceRoot: root,
      generatedAt: new Date().toISOString(),
      sources,
      skills: [...skills].sort(),
    }
  }

  async routingContext(): Promise<string> {
    const policy = await WorkspacePolicy.create([this.root])
    const root = await policy.authorizeExisting(this.root)
    const sections = await Promise.all(REQUIRED_SOURCES.map(async (path) => {
      const filename = await policy.authorizeExisting(join(root, path))
      return `### ${path}\n${compact(await readFile(filename, 'utf8'))}`
    }))
    return sections.join('\n\n')
  }

  async validate(candidate: BlacklakeRouteCandidate): Promise<void> {
    if (!candidate.reason.trim()) throw new Error('BlackLake route candidate must include a reason')
    if (!candidate.blacklakeRelated) {
      if (candidate.recommendedSkills.length || candidate.operationChain) {
        throw new Error('non-BlackLake work cannot select BlackLake skills')
      }
      return
    }
    const snapshot = await this.inspect()
    if (!candidate.recommendedSkills.includes('blacklake-reference-router')) {
      throw new Error('BlackLake work must include blacklake-reference-router')
    }
    const unknown = candidate.recommendedSkills.filter((skill) => !snapshot.skills.includes(skill))
    if (unknown.length) throw new Error(`unknown BlackLake skills: ${unknown.join(', ')}`)
    if (candidate.operationChain && !candidate.recommendedSkills.includes('virtual-employee-operation-chain')) {
      throw new Error('multi-step BlackLake work must include virtual-employee-operation-chain')
    }
  }

  async planResearch(input: BlacklakeResearchPlanInput): Promise<BlacklakeResearchPlanResult> {
    await this.validate(input.candidate)
    if (!input.decisionReason.trim() || !input.expectedBenefit.trim() || !input.evidenceGap.trim()) {
      throw new Error('BlackLake research decision must state reason, expected benefit and evidence gap')
    }
    if (input.researchDecision === 'skip') {
      if (input.researchPrompt?.trim() || input.approvalId || input.approvalPrompt) {
        throw new Error('skipped BlackLake research cannot carry a prompt or approval')
      }
      return { decision: 'skip', enqueued: false, awaitingApproval: false }
    }
    if (!input.candidate.blacklakeRelated) throw new Error('non-BlackLake work cannot enqueue BlackLake research')
    if (!input.researchPrompt?.trim()) throw new Error('BlackLake start/confirm research requires a concrete prompt')
    if (input.researchDecision === 'start') {
      const highRisk = input.risk === 'production' || input.risk === 'security' || input.risk === 'customer-blocking'
      if (!highRisk || !input.goalClear || !input.evidenceNeedsLocalInspection || !input.expectedDirectValue) {
        throw new Error('BlackLake research may start directly only for clear high-risk work with a local evidence gap and direct value')
      }
      if (input.approvalId || input.approvalPrompt) throw new Error('direct-start BlackLake research cannot carry a pending approval')
    } else if (!input.approvalId?.trim() || !input.approvalPrompt?.trim()) {
      throw new Error('confirmed BlackLake research requires an exact durable approval')
    }
    const action: DurableActionInput = {
      actionId: input.actionId,
      matterId: input.matterId,
      matterTitle: input.title,
      matterSummary: input.summary,
      intent: `blacklake-research:${input.researchDecision}`,
      source: input.source,
      request: {
        title: input.title,
        prompt: input.researchPrompt,
        workspace: input.workspace,
        mode: 'read-only',
      },
      requestedExecutor: input.requestedExecutor ?? 'claude-code',
      ...(input.researchDecision === 'confirm'
        ? { approval: { id: input.approvalId as string, prompt: input.approvalPrompt as string } }
        : {}),
    }
    const result = await this.ctx.quarkActionLedger.enqueue(action)
    return {
      decision: input.researchDecision,
      enqueued: result.inserted,
      awaitingApproval: input.researchDecision === 'confirm',
      actionId: input.actionId,
    }
  }
}

export { REQUIRED_SOURCES as BLACKLAKE_REFERENCE_SOURCES }

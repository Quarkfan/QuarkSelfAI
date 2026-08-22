import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { WorkspacePolicy } from '../execution/workspace-policy.js'

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
}

export { REQUIRED_SOURCES as BLACKLAKE_REFERENCE_SOURCES }

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type EvolutionBlueprint = {
  schemaVersion: number
  projectId: string
  automationId: string
  name: string
  kind: string
  desiredStatus: string
  schedule: { rrule: string; timezone: string }
  executor: { model: string; reasoningEffort: string }
  target: { type: string; binding: string }
  task: { promptFile: string; promptSha256: string; titlePattern: string }
  recovery: {
    initialStatus: string
    requiresOwnerApprovalToActivate: boolean
    oneActiveAutomationId: boolean
    externalState: string
  }
}

type WorkDomainConfig = { markers?: unknown }

export type EvolutionPortabilityOptions = {
  projectRoot: string
  codexHome?: string
  inspectInstalled?: boolean
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalPrompt(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/^# QuarkSelfAI 能力进化任务\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function trackedPaths(root: string): Set<string> {
  const output = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  return new Set(output.split(/\r?\n/).filter(Boolean))
}

function tomlString(text: string, key: string): string | undefined {
  const match = new RegExp(`^${key}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")\\s*$`, 'm').exec(text)
  if (!match?.[1]) return undefined
  try { return JSON.parse(match[1]) as string } catch { return undefined }
}

function inlineTomlString(text: string, key: string): string | undefined {
  const match = new RegExp(`${key}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")`).exec(text)
  if (!match?.[1]) return undefined
  try { return JSON.parse(match[1]) as string } catch { return undefined }
}

function portablePath(path: string): boolean {
  return !path.startsWith('/') && !path.includes('..') && !/^[A-Za-z]:[\\/]/.test(path)
}

async function loadMarkers(root: string): Promise<string[]> {
  const value = JSON.parse(await readFile(resolve(root, 'config/work-domain-isolation.json'), 'utf8')) as WorkDomainConfig
  if (!Array.isArray(value.markers)) throw new Error('work-domain marker inventory is invalid')
  return value.markers.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

export async function auditCapabilityEvolutionPortability(options: EvolutionPortabilityOptions) {
  const root = resolve(options.projectRoot)
  const blueprintPath = resolve(root, 'config/capability-evolution-automation.json')
  const blueprint = JSON.parse(await readFile(blueprintPath, 'utf8')) as EvolutionBlueprint
  const promptPath = resolve(root, blueprint.task?.promptFile ?? '')
  const prompt = await readFile(promptPath, 'utf8')
  const promptSha256 = digest(canonicalPrompt(prompt))
  const tracked = trackedPaths(root)
  const markers = await loadMarkers(root)
  const serializedBlueprint = JSON.stringify(blueprint)
  const lowerSource = `${serializedBlueprint}\n${prompt}`.toLowerCase()
  const workDomainMatches = markers.filter(marker => lowerSource.includes(marker.toLowerCase()))
  const blockers: string[] = []

  if (blueprint.schemaVersion !== 1 || blueprint.projectId !== 'quarkselfai') blockers.push('unsupported-blueprint')
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(blueprint.automationId ?? '')) blockers.push('invalid-automation-id')
  if (blueprint.kind !== 'cron') blockers.push('unsupported-automation-kind')
  if (blueprint.desiredStatus !== 'ACTIVE' || blueprint.recovery?.initialStatus !== 'PAUSED') blockers.push('unsafe-recovery-status')
  if (blueprint.recovery?.requiresOwnerApprovalToActivate !== true) blockers.push('owner-activation-gate-missing')
  if (blueprint.recovery?.oneActiveAutomationId !== true) blockers.push('single-automation-gate-missing')
  if (blueprint.schedule?.timezone !== 'local' || !blueprint.schedule?.rrule) blockers.push('invalid-schedule')
  if (!blueprint.executor?.model || !blueprint.executor?.reasoningEffort) blockers.push('executor-not-pinned')
  if (blueprint.target?.type !== 'project' || blueprint.target?.binding !== 'select-this-clone-on-the-current-host') blockers.push('non-portable-target-binding')
  if (!portablePath(blueprint.task?.promptFile ?? '')) blockers.push('non-portable-prompt-path')
  if (!tracked.has('config/capability-evolution-automation.json') || !tracked.has(blueprint.task.promptFile)) blockers.push('blueprint-source-not-tracked')
  if (blueprint.task.promptSha256 !== promptSha256) blockers.push('prompt-digest-mismatch')
  if (!blueprint.task.titlePattern.includes('YYYY-MM-DD')) blockers.push('non-unique-title-pattern')
  if (/\/(?:Users|home)\//.test(prompt) || /[A-Za-z]:\\/.test(prompt)) blockers.push('host-path-in-prompt')
  if (workDomainMatches.length > 0) blockers.push('work-domain-reference-in-blueprint')

  let installed: { inspected: boolean; state: string; matches: boolean; activeDefinitionCount?: number; scanFailureCount?: number; mismatches: string[] } = {
    inspected: false,
    state: 'not-requested',
    matches: false,
    mismatches: [],
  }
  if (options.inspectInstalled) {
    const automationsRoot = join(options.codexHome ?? process.env.CODEX_HOME?.trim() ?? join(homedir(), '.codex'), 'automations')
    const automationPath = join(automationsRoot, blueprint.automationId, 'automation.toml')
    try {
      const text = await readFile(automationPath, 'utf8')
      const expected: Record<string, string> = {
        id: blueprint.automationId,
        name: blueprint.name,
        kind: blueprint.kind,
        status: blueprint.desiredStatus,
        rrule: blueprint.schedule.rrule,
        model: blueprint.executor.model,
        reasoning_effort: blueprint.executor.reasoningEffort,
      }
      const mismatches = Object.entries(expected)
        .filter(([key, value]) => tomlString(text, key) !== value)
        .map(([key]) => `${key}-mismatch`)
      const installedPrompt = tomlString(text, 'prompt')
      if (!installedPrompt || digest(canonicalPrompt(installedPrompt)) !== promptSha256) mismatches.push('prompt-digest-mismatch')
      const target = /^target\s*=\s*\{([^\n]*)\}\s*$/m.exec(text)?.[1] ?? ''
      if (inlineTomlString(target, 'type') !== blueprint.target.type || !inlineTomlString(target, 'project_id')) mismatches.push('target-binding-mismatch')
      let activeDefinitionCount = 0
      let scanFailureCount = 0
      for (const entry of await readdir(automationsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        try {
          const candidate = await readFile(join(automationsRoot, entry.name, 'automation.toml'), 'utf8')
          const sameDefinition = tomlString(candidate, 'id') === blueprint.automationId || tomlString(candidate, 'name') === blueprint.name
          if (sameDefinition && tomlString(candidate, 'status') === 'ACTIVE') activeDefinitionCount += 1
        } catch {
          scanFailureCount += 1
        }
      }
      if (activeDefinitionCount !== 1) mismatches.push('active-definition-count-mismatch')
      if (scanFailureCount > 0) mismatches.push('automation-inventory-incomplete')
      installed = { inspected: true, state: 'present', matches: mismatches.length === 0, activeDefinitionCount, scanFailureCount, mismatches }
    } catch {
      installed = { inspected: true, state: 'missing', matches: false, mismatches: ['automation-missing'] }
    }
  }

  return {
    ok: blockers.length === 0 && (!options.inspectInstalled || installed.matches),
    projectId: blueprint.projectId,
    automationId: blueprint.automationId,
    blueprint: {
      valid: blockers.length === 0,
      promptTracked: tracked.has(blueprint.task.promptFile),
      promptSha256,
      schedule: blueprint.schedule.rrule,
      model: blueprint.executor.model,
      reasoningEffort: blueprint.executor.reasoningEffort,
      initialStatus: blueprint.recovery.initialStatus,
      activationRequiresOwnerApproval: blueprint.recovery.requiresOwnerApprovalToActivate,
      workDomainReferenceCount: workDomainMatches.length,
    },
    installed,
    blockers,
    privacy: { promptIncluded: false, workDomainMarkersIncluded: false, credentialValuesIncluded: false },
  }
}

async function main(): Promise<void> {
  const report = await auditCapabilityEvolutionPortability({
    projectRoot,
    inspectInstalled: process.argv.includes('--installed'),
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (process.argv.includes('--strict') && !report.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  })
}

import { execFile } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { requireAuthorizationEvidence } from '../domain/authorization.js'
import { validateIntakeDecision } from '../intake/types.js'
import type { ClaimedWorkflowEffect } from '../storage/types.js'
import type {} from '../workflow/contracts.js'
import { TASK_PROJECTION_EFFECTS } from './projection-effects.js'
import { validateFollowupUpdate } from '../followup/types.js'

const SCOPE = 'dida.task-projection'
const URGENCY = { 1: '跟进', 3: '重要', 5: '紧急' } as const

export interface DidaProjectionEffectConfig { readonly executable?: string; readonly projectIds: readonly string[] }
export interface ProjectionCommandRunner { run(executable: string, args: readonly string[]): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> }

class ProcessProjectionRunner implements ProjectionCommandRunner {
  async run(executable: string, args: readonly string[]) {
    return await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = execFile(executable, [...args], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') { reject(error); return }
        resolve({ exitCode: typeof error?.code === 'number' ? error.code : 0, stdout, stderr })
      })
      child.once('error', reject)
    })
  }
}

export class DidaProjectionEffectAdapter {
  private readonly allowedProjects: ReadonlySet<string>
  constructor(private readonly config: DidaProjectionEffectConfig, private readonly runner: ProjectionCommandRunner = new ProcessProjectionRunner()) {
    if (!config.projectIds.length) throw new Error('Dida projection effects require projectIds')
    this.allowedProjects = new Set(config.projectIds.map((id, index) => required(id, `projectIds[${index}]`, 300)))
  }

  async execute(effect: ClaimedWorkflowEffect): Promise<Readonly<Record<string, unknown>>> {
    const projectId = this.authorizedProject(effect)
    if (effect.kind === TASK_PROJECTION_EFFECTS.upsertIntake) return await this.upsertIntake(effect, projectId)
    if (effect.kind === TASK_PROJECTION_EFFECTS.applyFollowupUpdate) return await this.applyFollowupUpdate(effect, projectId)
    if (effect.kind === TASK_PROJECTION_EFFECTS.recordResearchResult) return await this.appendResult(effect, projectId, '智造湖小维调研结果')
    if (effect.kind === TASK_PROJECTION_EFFECTS.recordFollowupReply) return await this.appendResult(effect, projectId, '联系人跟进回复')
    throw new Error(`unsupported Dida projection effect ${effect.kind}`)
  }

  private async applyFollowupUpdate(effect: ClaimedWorkflowEffect, projectId: string) {
    const update = validateFollowupUpdate(effect.payload.update)
    const task = await this.get(projectId, update.taskId)
    assertOrdinaryTask(task, projectId)
    if (Number(task.status) === 2 || task.completedTime) throw new Error('followup projection cannot update a completed task')
    const marker = `[projection:${required(effect.payload.idempotencyKey, 'projection idempotencyKey', 1_000)}]`
    if (String(task.content ?? '').includes(marker)) return result(task, 'unchanged', [], update.summary)
    const content = `${rewriteSummary(String(task.content ?? ''), update.summary)}\n\n### 自动化巡检进展 · ${String(effect.payload.effectiveAt)}\n变化：${update.changes.join('；')}\n原因：${update.reason}\n${marker}`
    await this.write(['task', 'update', update.taskId, '--id', update.taskId, '--project', projectId,
      '--title', update.title, '--content', content,
      ...(update.priority !== undefined ? ['--priority', String(update.priority)] : []),
      ...(update.tags ? ['--tags', update.tags.join(',')] : []),
      ...(update.dueDate ? ['--due-date', update.dueDate] : []), '--json'])
    const verified = await this.get(projectId, update.taskId)
    assertOrdinaryTask(verified, projectId)
    if (!String(verified.content ?? '').includes(marker)) throw new Error('followup update is missing projection lineage')
    return result(verified, 'updated', update.changes, update.summary)
  }

  private authorizedProject(effect: ClaimedWorkflowEffect): string {
    const projectId = required(effect.payload.projectId, 'projection projectId', 300)
    if (!this.allowedProjects.has(projectId)) throw new Error(`project ${projectId} is outside the projection allowlist`)
    const effectiveAt = timestamp(effect.payload.effectiveAt, 'projection effectiveAt')
    requireAuthorizationEvidence(effect.payload.authorization, SCOPE, effectiveAt)
    const authorization = object(effect.payload.authorization, 'projection authorization')
    if (authorization.projectId !== projectId) throw new Error('projection authorization does not cover this project')
    return projectId
  }

  private async upsertIntake(effect: ClaimedWorkflowEffect, projectId: string) {
    const decision = validateIntakeDecision(effect.payload.decision)
    if (decision.outcome !== 'task') throw new Error('intake projection requires a task decision')
    const sourceEvent = object(effect.payload.sourceEvent, 'projection source event')
    const source = object(sourceEvent.source, 'projection source')
    const messageId = required(source.resourceId ?? sourceEvent.deduplicationKey, 'projection source resourceId', 500)
    const marker = `[feishu:${messageId}]`
    const explicit = decision.existingTaskId ? await this.get(projectId, decision.existingTaskId) : undefined
    const matches = explicit ? [explicit] : await this.search(projectId, marker)
    if (matches.length > 1) throw new Error(`multiple tasks contain projection marker ${marker}`)
    const existing = matches[0]
    if (existing && taskProject(existing) !== projectId) throw new Error('projection target belongs to another project')
    if (existing && existing.kind === 'NOTE') throw new Error('projection marker belongs to a NOTE and requires reconciliation')
    if (existing && (Number(existing.status) === 2 || existing.completedTime)) throw new Error('projection target is completed and cannot be reopened implicitly')
    const presentation = present(decision)
    const dueDate = decision.dueDate
    const content = intakeContent(existing?.content, decision.summary, marker, sourceEvent, String(effect.payload.effectiveAt))
    if (existing && same(existing, presentation.title, content, decision.priority!, presentation.tags, dueDate)) {
      return result(existing, 'unchanged', [], decision.summary)
    }
    if (existing) {
      const updated = object(await this.write(['task', 'update', taskId(existing), '--id', taskId(existing), '--project', projectId,
        '--title', presentation.title, '--content', content, '--priority', String(decision.priority), '--tags', presentation.tags.join(','),
        ...(dueDate ? ['--due-date', dueDate] : []), '--json']), 'Dida update result')
      const verified = await this.get(projectId, taskId(existing))
      assertOrdinaryTask(verified, projectId)
      return result(verified, 'updated', ['重写当前摘要', '追加飞书血缘'], decision.summary)
    }
    const created = object(await this.write(['task', 'create', '--project', projectId, '--title', presentation.title, '--content', content,
      '--priority', String(decision.priority), '--tags', presentation.tags.join(','), ...(dueDate ? ['--due-date', dueDate] : []), '--json']), 'Dida create result')
    const createdId = taskId(created)
    const verified = await this.get(projectId, createdId)
    assertOrdinaryTask(verified, projectId)
    if (!String(verified.content ?? '').includes(marker)) throw new Error('created task is missing projection lineage')
    return result(verified, 'created', ['创建普通任务', '写入飞书血缘'], decision.summary)
  }

  private async appendResult(effect: ClaimedWorkflowEffect, projectId: string, heading: string) {
    const id = required(effect.payload.taskId, 'projection taskId', 300)
    const task = await this.get(projectId, id)
    assertOrdinaryTask(task, projectId)
    const idempotencyKey = required(effect.payload.idempotencyKey, 'projection idempotencyKey', 1_000)
    const marker = `[projection:${idempotencyKey}]`
    if (String(task.content ?? '').includes(marker)) return result(task, 'unchanged', [], summaryFor(effect))
    const summary = summaryFor(effect)
    const detail = effect.kind === TASK_PROJECTION_EFFECTS.recordResearchResult
      ? required(effect.payload.result, 'research result', 12_000)
      : required(effect.payload.replyContent, 'followup reply', 5_000)
    const content = rewriteSummary(String(task.content ?? ''), summary)
      + `\n\n### ${heading} · ${String(effect.payload.effectiveAt)}\n${detail}${optional(effect.payload.replyUrl, 2_000) ? `\n${optional(effect.payload.replyUrl, 2_000)}` : ''}\n${marker}`
    const updated = object(await this.write(['task', 'update', id, '--id', id, '--project', projectId, '--content', content, '--json']), 'Dida update result')
    const verified = await this.get(projectId, id)
    assertOrdinaryTask(verified, projectId)
    return result(verified, 'updated', [`追加${heading}`, '重写当前摘要'], summary)
  }

  private async search(projectId: string, marker: string): Promise<Readonly<Record<string, unknown>>[]> {
    return rows(await this.write(['task', 'search', marker, '--projects', projectId, '--status', '0,2', '--json']))
      .filter(task => taskProject(task) === projectId && String(task.content ?? '').includes(marker))
  }
  private async get(projectId: string, id: string): Promise<Readonly<Record<string, unknown>>> {
    return object(await this.write(['task', 'get', projectId, id, '--json']), 'Dida task')
  }
  private async write(args: readonly string[]): Promise<unknown> {
    const output = await this.runner.run(this.config.executable ?? 'dida', args)
    if (output.exitCode !== 0) throw new Error(`dida exited ${output.exitCode}: ${(output.stderr || output.stdout).trim().slice(-1_000)}`)
    return parse(output.stdout)
  }
}

function present(decision: ReturnType<typeof validateIntakeDecision>) {
  const priority = decision.priority as 1 | 3 | 5
  const urgency = URGENCY[priority]
  const key = decision.tags?.includes('关键事项') ?? false
  const core = required(decision.title, 'task title', 300).replace(/^【[^】]+】\s*/, '').trim()
  const title = `【${urgency}${key ? '·关键' : ''}】${core}`.slice(0, 100)
  const tags = [...new Set(['飞书', urgency, ...(decision.approvalRequired ? ['待批准'] : []), ...(decision.tags ?? [])])].slice(0, 5)
  return { title, tags }
}
function intakeContent(existing: unknown, summary: string, marker: string, source: Readonly<Record<string, unknown>>, at: string): string {
  const rewritten = rewriteSummary(typeof existing === 'string' ? existing : '', summary)
  if (rewritten.includes(marker)) return rewritten
  const sourceLine = JSON.stringify(source).slice(0, 4_000)
  return `${rewritten}\n\n### 飞书进展 · ${at}\n${summary}\n来源：${sourceLine}\n${marker}`
}
function rewriteSummary(content: string, summary: string): string {
  const section = `## 当前摘要\n${summary.slice(0, 600)}`
  const stripped = content.replace(/^## 当前摘要\n[\s\S]*?(?=\n\n### |\n\n## |$)/, '').trim()
  return stripped ? `${section}\n\n${stripped}` : `${section}\n\n## 进展记录`
}
function summaryFor(effect: ClaimedWorkflowEffect): string {
  if (effect.kind === TASK_PROJECTION_EFFECTS.recordResearchResult) return required(effect.payload.result, 'research result', 12_000).slice(0, 600)
  const contact = object(effect.payload.contact, 'followup contact')
  return `${required(contact.name, 'followup contact name', 300)}回复：${required(effect.payload.replyContent, 'followup reply', 5_000)}`.slice(0, 600)
}
function same(task: Readonly<Record<string, unknown>>, title: string, content: string, priority: number, tags: readonly string[], dueDate?: string): boolean {
  return task.title === title && task.content === content && Number(task.priority) === priority
    && JSON.stringify(Array.isArray(task.tags) ? task.tags : []) === JSON.stringify(tags)
    && String(task.dueDate ?? '') === String(dueDate ?? '')
}
function result(task: Readonly<Record<string, unknown>>, action: string, changes: readonly string[], summary: string) {
  return { result: { taskId: taskId(task), title: required(task.title, 'task title', 500), action, changes, summary, ...(optional(task.url, 2_000) ? { url: optional(task.url, 2_000) } : {}) } }
}
function assertOrdinaryTask(task: Readonly<Record<string, unknown>>, projectId: string): void {
  if (taskProject(task) !== projectId) throw new Error('Dida write escaped the target project')
  if (task.kind === 'NOTE') throw new Error('Dida projection created or updated a NOTE instead of a task')
}
function taskId(task: Readonly<Record<string, unknown>>): string { return required(task.id ?? task.taskId, 'Dida task id', 300) }
function taskProject(task: Readonly<Record<string, unknown>>): string { return required(task.projectId ?? task.project_id, 'Dida project id', 300) }
function rows(value: unknown): Readonly<Record<string, unknown>>[] { if (Array.isArray(value)) return value.map((item, i) => object(item, `task ${i}`)); const root = object(value, 'Dida output'); if (!Array.isArray(root.tasks)) return [root]; return root.tasks.map((item, i) => object(item, `task ${i}`)) }
function parse(stdout: string): unknown { for (let i = 0; i < stdout.length; i += 1) { if (stdout[i] !== '{' && stdout[i] !== '[') continue; try { return JSON.parse(stdout.slice(i)) } catch {} } throw new Error('dida did not return JSON') }
function object(value: unknown, label: string): Readonly<Record<string, unknown>> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Readonly<Record<string, unknown>> }
function required(value: unknown, label: string, max: number): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`); if (value.length > max) throw new Error(`${label} exceeds ${max} characters`); return value }
function optional(value: unknown, max: number): string | undefined { return value === undefined || value === null || value === '' ? undefined : required(value, 'optional text', max) }
function timestamp(value: unknown, label: string): string { const result = required(value, label, 100); if (Number.isNaN(new Date(result).getTime())) throw new Error(`${label} must be a timestamp`); return result }

export const name = 'quark-dida-projection-effects'
export const inject = ['quarkWorkflows']
export function apply(ctx: Context, config: DidaProjectionEffectConfig): void {
  const adapter = new DidaProjectionEffectAdapter(config)
  const disposers = Object.values(TASK_PROJECTION_EFFECTS).map(kind => ctx.quarkWorkflows.registerEffect(kind, { execute: effect => adapter.execute(effect) }))
  ctx.effect(() => () => { for (const dispose of disposers.reverse()) dispose() }, 'quark Dida projection effects')
}

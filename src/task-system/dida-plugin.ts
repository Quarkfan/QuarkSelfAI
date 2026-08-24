import type { Context } from '@deepseek-ai/cordis'
import { execFile } from 'node:child_process'
import type { ClaimedWorkflowEffect } from '../storage/types.js'
import type {} from '../workflow/runtime.js'
import { TASK_STORE_EFFECTS } from './store-effects.js'
import { TASK_MAINTENANCE_EFFECTS } from './maintenance-effects.js'
import { requireAuthorizationEvidence } from '../domain/authorization.js'

export interface DidaTaskEffectConfig {
  readonly executable?: string
  readonly projectIds: readonly string[]
}
export interface DidaCommandRunner { run(executable: string, args: readonly string[]): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> }

class ProcessDidaRunner implements DidaCommandRunner {
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

export class DidaTaskEffectAdapter {
  private readonly allowedProjects: ReadonlySet<string>
  constructor(private readonly config: DidaTaskEffectConfig, private readonly runner: DidaCommandRunner = new ProcessDidaRunner()) {
    if (!Array.isArray(config.projectIds) || config.projectIds.length === 0) throw new Error('Dida task effects require projectIds')
    this.allowedProjects = new Set(config.projectIds.map((id, index) => required(id, `projectIds[${index}]`, 300)))
  }
  async execute(effect: ClaimedWorkflowEffect): Promise<Readonly<Record<string, unknown>>> {
    if (effect.kind === TASK_STORE_EFFECTS.listOverdue) return await this.listOverdue(effect)
    if (effect.kind === TASK_STORE_EFFECTS.isCompleted) return await this.isCompleted(effect)
    if (effect.kind === TASK_MAINTENANCE_EFFECTS.cleanupCompleted) return await this.cleanupCompleted(effect)
    throw new Error(`unsupported Dida task effect ${effect.kind}`)
  }
  private async listOverdue(effect: ClaimedWorkflowEffect) {
    const projectId = this.project(effect.payload.projectId)
    const now = new Date().toISOString()
    const tasks = rows(await this.json(['task', 'filter', '--projects', projectId, '--status', '0', '--end-date', now, '--json']))
      .map((task, index) => ({
        taskId: required(field(task, 'id', 'taskId'), `task ${index} id`, 300), title: required(task.title, `task ${index} title`, 500),
        dueDate: required(field(task, 'dueDate', 'due_date'), `task ${index} dueDate`, 100), priority: number(task.priority, `task ${index} priority`),
        ...(typeof task.url === 'string' && task.url ? { url: task.url } : {}),
      }))
    return { tasks }
  }
  private async isCompleted(effect: ClaimedWorkflowEffect) {
    const taskId = required(effect.payload.taskId, 'taskId', 300)
    const tasks = rows(await this.json(['task', 'filter', '--projects', [...this.allowedProjects].join(','), '--status', '0,2', '--json']))
    const task = tasks.find(item => field(item, 'id', 'taskId') === taskId)
    if (!task) throw new Error(`task ${taskId} was not found in an allowed project`)
    return { completed: Number(task.status) === 2 || Boolean(task.completedTime), taskId }
  }
  private async cleanupCompleted(effect: ClaimedWorkflowEffect) {
    const projectId = this.project(effect.payload.projectId)
    const cutoff = timestamp(effect.payload.cutoff, 'cleanup cutoff')
    const maxDeletes = integer(effect.payload.maxDeletes, 'cleanup maxDeletes')
    const effectiveAt = timestamp(effect.payload.effectiveAt, 'cleanup effectiveAt')
    const evidence = requireAuthorizationEvidence(effect.payload.authorization, 'dida.completed-task-cleanup', effectiveAt)
    const authorization = object(effect.payload.authorization, 'cleanup authorization')
    if (authorization.projectId !== projectId) throw new Error('cleanup authorization does not cover this project')
    const minimumRetentionDays = integer(authorization.minimumRetentionDays, 'authorization minimumRetentionDays')
    const maximumDeletesPerRun = integer(authorization.maximumDeletesPerRun, 'authorization maximumDeletesPerRun')
    if (maxDeletes > maximumDeletesPerRun) throw new Error('cleanup maxDeletes exceeds authorization')
    if (new Date(effectiveAt).getTime() - new Date(cutoff).getTime() < minimumRetentionDays * 86_400_000) {
      throw new Error('cleanup cutoff is newer than the authorized retention period')
    }
    const completed = rows(await this.json(['task', 'completed', '--projects', projectId, '--end-date', cutoff, '--json']))
      .map((task, index) => ({
        taskId: required(field(task, 'id', 'taskId'), `completed task ${index} id`, 300),
        title: required(task.title, `completed task ${index} title`, 500),
        completedAt: timestamp(field(task, 'completedTime', 'completed_at', 'completedAt'), `completed task ${index} completedAt`),
      }))
      .filter(task => new Date(task.completedAt).getTime() <= new Date(cutoff).getTime())
      .slice(0, maxDeletes)
    const deleted = []
    for (const task of completed) {
      await this.command(['task', 'delete', projectId, task.taskId])
      deleted.push(task)
    }
    return { deleted, authorizationId: evidence.id }
  }
  private project(value: unknown): string { const id = required(value, 'projectId', 300); if (!this.allowedProjects.has(id)) throw new Error(`project ${id} is outside the Dida allowlist`); return id }
  private async json(args: readonly string[]): Promise<unknown> {
    const output = await this.command(args)
    return parse(output.stdout)
  }
  private async command(args: readonly string[]) {
    const output = await this.runner.run(this.config.executable ?? 'dida', args)
    if (output.exitCode !== 0) throw new Error(`dida exited ${output.exitCode}: ${(output.stderr || output.stdout).trim().slice(-1_000)}`)
    return output
  }
}

export const name = 'quark-dida-task-effects'
export const inject = ['quarkWorkflows']
export function apply(ctx: Context, config: DidaTaskEffectConfig): void {
  const adapter = new DidaTaskEffectAdapter(config)
  const disposers = [TASK_STORE_EFFECTS.listOverdue, TASK_STORE_EFFECTS.isCompleted, TASK_MAINTENANCE_EFFECTS.cleanupCompleted]
    .map(kind => ctx.quarkWorkflows.registerEffect(kind, { execute: effect => adapter.execute(effect) }))
  ctx.effect(() => () => { for (const dispose of disposers.reverse()) dispose() }, 'quark Dida task effects')
}

function rows(value: unknown): ReadonlyArray<Readonly<Record<string, unknown>>> { if (Array.isArray(value)) return value.map((item, index) => object(item, `task ${index}`)); const root = object(value, 'Dida output'); if (!Array.isArray(root.tasks)) throw new Error('Dida output must contain tasks'); return root.tasks.map((item, index) => object(item, `task ${index}`)) }
function parse(stdout: string): unknown { for (let index = 0; index < stdout.length; index += 1) { if (stdout[index] !== '{' && stdout[index] !== '[') continue; try { return JSON.parse(stdout.slice(index)) } catch { /* try the next JSON boundary */ } } throw new Error('dida did not return JSON') }
function object(value: unknown, label: string): Readonly<Record<string, unknown>> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Readonly<Record<string, unknown>> }
function field(value: Readonly<Record<string, unknown>>, ...keys: readonly string[]): unknown { for (const key of keys) if (value[key] !== undefined) return value[key]; return undefined }
function required(value: unknown, label: string, max: number): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`); if (value.length > max) throw new Error(`${label} exceeds ${max} characters`); return value }
function number(value: unknown, label: string): number { const result = Number(value ?? 0); if (!Number.isFinite(result)) throw new Error(`${label} must be numeric`); return result }
function integer(value: unknown, label: string): number { const result = number(value, label); if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be a positive integer`); return result }
function timestamp(value: unknown, label: string): string { const result = required(value, label, 100); if (Number.isNaN(new Date(result).getTime())) throw new Error(`${label} must be a timestamp`); return result }

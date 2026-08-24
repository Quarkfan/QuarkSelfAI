import type { Context } from '@deepseek-ai/cordis'
import { completedCleanupWorkflow, overdueWorkflow } from './workflows.js'
import type { DidaMaintenanceConfig } from './types.js'
import type {} from '../workflow/runtime.js'

export const name = 'quark-dida-maintenance'
export const inject = ['quarkWorkflows']

export async function apply(ctx: Context, config: DidaMaintenanceConfig): Promise<void> {
  const overdue = overdueWorkflow(config)
  const cleanup = completedCleanupWorkflow(config)
  const disposeOverdue = ctx.quarkWorkflows.register(overdue)
  const disposeCleanup = ctx.quarkWorkflows.register(cleanup)
  ctx.effect(() => () => { disposeCleanup(); disposeOverdue() }, 'quark dida maintenance definitions')
  if (config.enabled !== true) return
  await ctx.quarkWorkflows.ensure(`dida-overdue:${config.projectId}`, overdue.kind, {})
  await ctx.quarkWorkflows.ensure(`dida-cleanup:${config.projectId}`, cleanup.kind, {})
}

export * from './types.js'
export * from './workflows.js'
export { TASK_EFFECTS } from '../task-system/effects.js'

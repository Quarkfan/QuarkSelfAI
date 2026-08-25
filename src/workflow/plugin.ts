import type { Context } from '@deepseek-ai/cordis'
import { DurableWorkflowRuntime, type WorkflowRuntimeConfig } from './runtime.js'

export const name = 'quark-durable-workflows'
export const inject = ['quarkWorkflowState']

export function apply(ctx: Context, config: WorkflowRuntimeConfig): void {
  ctx.plugin(DurableWorkflowRuntime, config)
}

export * from './runtime.js'

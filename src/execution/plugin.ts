import type { Context } from '@deepseek-ai/cordis'
import { ExecutorRouterService, type ExecutorRouterConfig } from './router.js'

export const name = 'quark-executor-router'
export const inject = ['subagents']

export function apply(ctx: Context, config: ExecutorRouterConfig): void {
  ctx.plugin(ExecutorRouterService, config)
}

export * from './router.js'

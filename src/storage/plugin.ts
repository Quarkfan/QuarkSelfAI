import type { Context } from '@deepseek-ai/cordis'
import { DurableStateService, type DurableStateConfig } from './service.js'

export const name = 'quark-durable-state'

export function apply(ctx: Context, config: DurableStateConfig): void {
  ctx.plugin(DurableStateService, config)
}

export * from './service.js'

import type { Context } from '@deepseek-ai/cordis'
import { LarkCliService, type LarkCliConfig } from './lark/service.js'

export const name = 'quark-self-ai'

/** Mount only the stable Lark capability provider. Event consumption remains an explicit caller decision. */
export function apply(ctx: Context, config: LarkCliConfig = {}): void {
  ctx.plugin(LarkCliService, config)
}

export type * from './domain/contracts.js'
export * from './lark/capabilities.js'
export * from './lark/normalize.js'
export * from './lark/runner.js'
export * from './lark/service.js'
export * from './lark/stream.js'

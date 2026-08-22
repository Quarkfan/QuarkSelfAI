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
export * from './storage/postgres.js'
export * from './storage/sqlite.js'
export * from './storage/factory.js'
export * from './storage/types.js'
export * from './config/runtime.js'
export * from './config/feature-parity.js'
export * from './web/server.js'
export * from './policy/types.js'
export * from './policy/engine.js'
export * from './policy/authoring.js'
export * from './policy/samples.js'
export * from './runtime/compat.js'
export * from './migration/state-snapshot.js'
export * from './migration/legacy-state-audit.js'
export * from './deploy/launchd.js'

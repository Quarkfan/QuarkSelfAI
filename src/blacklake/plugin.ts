import type { Context } from '@deepseek-ai/cordis'
import { BlacklakeReferenceService, type BlacklakeReferenceConfig } from './references.js'

export const name = 'quark-blacklake-references'

export function apply(ctx: Context, config: BlacklakeReferenceConfig): void {
  ctx.plugin(BlacklakeReferenceService, config)
}

export * from './references.js'

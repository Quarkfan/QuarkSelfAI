import type { Context } from '@deepseek-ai/cordis'
import type { NormalizedChannelEvent } from '../domain/contracts.js'
import type {} from '../storage/service-contract.js'
import type {} from './service.js'

export const name = 'quark-feishu-ingress'
export const inject = ['larkCli', 'quarkEventAppendState']

export interface FeishuIngressConfig {
  /** Starts the single server-side consumer. Keep false until the maintenance-window cutover. */
  readonly startConsumer?: boolean
}

/**
 * DSH-native channel ingress. It journals raw normalized events only; workflow
 * decisions and external projections belong to separate feature plugins.
 */
export async function apply(ctx: Context, config: FeishuIngressConfig = {}): Promise<void> {
  ctx.on('feishu/event', async (event: NormalizedChannelEvent) => {
    await ctx.quarkEventAppendState.appendEvent(event)
  })
  if (config.startConsumer !== true) return
  await ctx.larkCli.start()
  ctx.effect(() => async () => { await ctx.larkCli.stop() }, 'quark feishu ingress consumer')
}

import { Context, Service } from '@deepseek-ai/cordis'
import { WorkIntegrationRegistryV1 } from './registry.js'

declare module '@deepseek-ai/cordis' {
  interface Context { quarkWorkIntegrations: WorkIntegrationRegistryService }
}

export class WorkIntegrationRegistryService extends Service {
  static readonly inject = []
  readonly registry = new WorkIntegrationRegistryV1()

  constructor(ctx: Context) {
    super(ctx, 'quarkWorkIntegrations')
  }
}

export const name = 'quark-work-integration-registry'
export function apply(ctx: Context): void { ctx.plugin(WorkIntegrationRegistryService) }

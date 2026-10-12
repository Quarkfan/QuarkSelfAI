import { Context, Service } from '@deepseek-ai/cordis'
import type { NormalizedChannelEvent } from '../domain/contracts.js'
import { LarkCapabilityDiscovery, type CompatibilityReport } from './capabilities.js'
import { ProcessCommandRunner, type CommandRunner } from './runner.js'
import { LarkEventStream } from './stream.js'
import type { LarkIdentity } from './types.js'

export interface LarkCliConfig {
  readonly executable?: string
  readonly identity?: LarkIdentity
  readonly requiredEventKeys?: readonly string[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    larkCli: LarkCliService
  }
  interface Events {
    'feishu/event'(event: NormalizedChannelEvent): void | Promise<void>
  }
}

export class LarkCliService extends Service {
  private readonly executable: string
  private readonly identity: LarkIdentity
  private readonly requiredEventKeys: readonly string[]
  private readonly discovery: LarkCapabilityDiscovery
  private readonly streams = new Map<string, LarkEventStream>()
  private readonly failures = new Map<string, string>()

  constructor(ctx: Context, config: LarkCliConfig = {}, runner: CommandRunner = new ProcessCommandRunner()) {
    super(ctx, 'larkCli')
    this.executable = config.executable ?? 'lark-cli'
    this.identity = config.identity ?? 'bot'
    this.requiredEventKeys = config.requiredEventKeys ?? ['im.message.receive_v1', 'card.action.trigger']
    this.discovery = new LarkCapabilityDiscovery(runner, this.executable)
    ctx.effect(() => async () => { await this.stop() }, 'feishu-lark-cli streams')
  }

  inspect(signal?: AbortSignal): Promise<CompatibilityReport> {
    return this.discovery.inspect(this.requiredEventKeys, signal)
  }

  streamHealth(): Readonly<Record<string, { state: ReturnType<LarkEventStream['status']>; failure?: string }>> {
    return Object.fromEntries([...this.streams].map(([key, stream]) => [key, {
      state: stream.status(),
      ...(this.failures.has(key) ? { failure: this.failures.get(key)! } : {}),
    }]))
  }

  async start(signal?: AbortSignal): Promise<CompatibilityReport> {
    if (this.streams.size > 0) throw new Error('lark-cli event streams are already started')
    const report = await this.inspect(signal)
    if (!report.compatible) {
      throw new Error(`lark-cli is missing required events: ${report.missingEventKeys.join(', ')}`)
    }
    try {
      for (const eventKey of this.requiredEventKeys) {
        const capability = report.capabilities[eventKey]
        if (!capability?.authTypes.includes(this.identity)) {
          throw new Error(`event ${eventKey} does not support --as ${this.identity}`)
        }
        const stream = new LarkEventStream()
        this.streams.set(eventKey, stream)
        await stream.start(
          { executable: this.executable, identity: this.identity, eventKey, onFailure: failure => {
            this.failures.set(eventKey, failure.message)
            this.ctx.logger('quark-lark-cli').error(failure.message)
          } },
          async event => { await this.ctx.parallel('feishu/event', event) },
          signal,
        )
      }
    } catch (error) {
      try { await this.stop() }
      catch { throw new Error('lark-cli startup failed and a consumer may still be alive', { cause: error }) }
      throw error
    }
    return report
  }

  async stop(): Promise<void> {
    const entries = [...this.streams]
    const results = await Promise.allSettled(entries.map(([, stream]) => stream.stop()))
    for (let index = 0; index < entries.length; index += 1) {
      if (results[index]?.status === 'fulfilled') {
        this.streams.delete(entries[index]![0])
        this.failures.delete(entries[index]![0])
      }
    }
    if (results.some(result => result.status === 'rejected')) throw new Error('lark-cli consumer stop is incomplete; ownership is uncertain')
  }
}

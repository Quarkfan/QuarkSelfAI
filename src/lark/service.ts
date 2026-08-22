import { Context, Service } from '@deepseek-ai/cordis'
import type { AssistantIdentity, NormalizedChannelEvent } from '../domain/contracts.js'
import { LarkCapabilityDiscovery, type CompatibilityReport } from './capabilities.js'
import { ProcessCommandRunner, type CommandRunner } from './runner.js'
import { LarkEventStream } from './stream.js'

export interface LarkCliConfig {
  readonly executable?: string
  readonly identity?: AssistantIdentity
  readonly requiredEventKeys?: readonly string[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    larkCli: LarkCliService
  }
  interface Events {
    'feishu/event'(event: NormalizedChannelEvent): void
  }
}

export class LarkCliService extends Service {
  private readonly executable: string
  private readonly identity: AssistantIdentity
  private readonly requiredEventKeys: readonly string[]
  private readonly discovery: LarkCapabilityDiscovery
  private readonly streams = new Map<string, LarkEventStream>()

  constructor(ctx: Context, config: LarkCliConfig = {}, runner: CommandRunner = new ProcessCommandRunner()) {
    super(ctx, 'larkCli')
    this.executable = config.executable ?? 'lark-cli'
    this.identity = config.identity ?? 'bot'
    this.requiredEventKeys = config.requiredEventKeys ?? ['im.message.receive_v1', 'card.action.trigger']
    this.discovery = new LarkCapabilityDiscovery(runner, this.executable)
    ctx.effect(() => async () => {
      await Promise.all([...this.streams.values()].map((stream) => stream.stop()))
    }, 'feishu-lark-cli streams')
  }

  inspect(signal?: AbortSignal): Promise<CompatibilityReport> {
    return this.discovery.inspect(this.requiredEventKeys, signal)
  }

  async start(signal?: AbortSignal): Promise<CompatibilityReport> {
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
        await stream.start({ executable: this.executable, identity: this.identity, eventKey }, (event) => {
          this.ctx.emit('feishu/event', event)
        }, signal)
        this.streams.set(eventKey, stream)
      }
    } catch (error) {
      await Promise.all([...this.streams.values()].map((stream) => stream.stop()))
      this.streams.clear()
      throw error
    }
    return report
  }
}

export default LarkCliService

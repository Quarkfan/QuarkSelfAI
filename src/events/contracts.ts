import type { NormalizedChannelEvent } from '../domain/contracts.js'

export interface DurableEventConsumer {
  readonly name: string
  readonly eventKeys: readonly string[]
  handle(event: NormalizedChannelEvent): Promise<void>
}

export interface DurableEventRegistryPort {
  register(consumer: DurableEventConsumer): () => void
  wake(at?: string): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { quarkEvents: DurableEventRegistryPort }
}

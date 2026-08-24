import { LifecycleSupervisor, type ComponentFailure, type ManagedComponent } from '../platform/lifecycle.js'

export interface AssistantApplication {
  start(): Promise<void>
  stop(): Promise<void>
  waitForFailure(): Promise<ComponentFailure>
  snapshot(): ReturnType<LifecycleSupervisor['snapshot']>
}

/** Stable application host. Concrete channels, migrations and surfaces are supplied by a composition module. */
export function createAssistantApplicationHost(components: readonly ManagedComponent[]): AssistantApplication {
  const supervisor = new LifecycleSupervisor(components)
  return {
    start: async () => { await supervisor.start() },
    stop: async () => { await supervisor.stop() },
    waitForFailure: async () => await supervisor.waitForFailure(),
    snapshot: () => supervisor.snapshot(),
  }
}

export type ComponentState = 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed'

export interface ManagedComponent {
  readonly id: string
  /** Open provider-owned category; the lifecycle host never branches on product or migration types. */
  readonly kind: string
  readonly critical?: boolean
  start(): Promise<void>
  stop(): Promise<void>
  waitForFailure?(): Promise<Error>
}

export interface ComponentStatus {
  readonly id: string
  readonly kind: ManagedComponent['kind']
  readonly state: ComponentState
  readonly startedAt?: string
  readonly stoppedAt?: string
  readonly lastError?: string
}

export interface ComponentFailure {
  readonly componentId: string
  readonly error: Error
}

/**
 * Owns process-level component order and rollback. Business features must use
 * DSH/Cordis plugin lifecycles instead of registering themselves here.
 */
export class LifecycleSupervisor {
  private readonly statuses = new Map<string, ComponentStatus>()
  private readonly started: ManagedComponent[] = []
  private state: 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed' = 'idle'
  private failure: Promise<ComponentFailure>
  private resolveFailure!: (failure: ComponentFailure) => void
  private failureResolved = false

  constructor(private readonly components: readonly ManagedComponent[]) {
    const ids = new Set<string>()
    for (const component of components) {
      if (!component.id.trim()) throw new Error('managed component id cannot be empty')
      if (!component.kind.trim()) throw new Error(`managed component ${component.id} kind cannot be empty`)
      if (ids.has(component.id)) throw new Error(`duplicate managed component id: ${component.id}`)
      ids.add(component.id)
      this.statuses.set(component.id, { id: component.id, kind: component.kind, state: 'idle' })
    }
    this.failure = new Promise(resolve => { this.resolveFailure = resolve })
  }

  snapshot(): readonly ComponentStatus[] {
    return this.components.map(component => ({ ...this.requireStatus(component.id) }))
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') throw new Error(`lifecycle cannot start from ${this.state}`)
    this.state = 'starting'
    let starting: ManagedComponent | undefined
    try {
      for (const component of this.components) {
        starting = component
        this.setStatus(component, { state: 'starting' })
        // A component may allocate resources before start() rejects. Put the
        // attempt on the rollback stack first so partial starts are stoppable.
        this.started.push(component)
        await component.start()
        this.setStatus(component, { state: 'ready', startedAt: new Date().toISOString() })
        if (component.critical !== false && component.waitForFailure) {
          void component.waitForFailure().then(
            error => this.reportFailure(component, error),
            error => this.reportFailure(component, normalizeError(error)),
          )
        }
      }
      this.state = 'ready'
    } catch (error) {
      const startError = normalizeError(error)
      this.state = 'failed'
      let rollbackError: Error | undefined
      try {
        await this.stopStarted()
      } catch (rollbackFailure) {
        rollbackError = normalizeError(rollbackFailure)
      }
      if (starting) this.setStatus(starting, { state: 'failed', lastError: startError.message })
      if (rollbackError) {
        throw new AggregateError(
          [startError, rollbackError],
          `component ${starting?.id ?? 'unknown'} failed to start and rollback failed: ${startError.message}`,
        )
      }
      throw error
    }
  }

  async waitForFailure(): Promise<ComponentFailure> {
    return await this.failure
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'idle') {
      this.state = 'stopped'
      return
    }
    if (this.state === 'stopping') return
    this.state = 'stopping'
    await this.stopStarted()
    this.state = 'stopped'
  }

  private reportFailure(component: ManagedComponent, error: Error): void {
    if (this.state === 'stopping' || this.state === 'stopped' || this.failureResolved) return
    this.state = 'failed'
    this.setStatus(component, { state: 'failed', lastError: error.message })
    this.failureResolved = true
    this.resolveFailure({ componentId: component.id, error })
  }

  private async stopStarted(): Promise<void> {
    const errors: Error[] = []
    for (const component of this.started.splice(0).reverse()) {
      const current = this.requireStatus(component.id)
      this.setStatus(component, { state: 'stopping' })
      try {
        await component.stop()
        this.setStatus(component, {
          state: 'stopped',
          ...(current.startedAt ? { startedAt: current.startedAt } : {}),
          stoppedAt: new Date().toISOString(),
        })
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error))
        errors.push(normalized)
        this.setStatus(component, { state: 'failed', lastError: normalized.message })
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'one or more managed components failed to stop')
  }

  private requireStatus(id: string): ComponentStatus {
    const status = this.statuses.get(id)
    if (!status) throw new Error(`unknown managed component: ${id}`)
    return status
  }

  private setStatus(component: ManagedComponent, change: Omit<ComponentStatus, 'id' | 'kind'>): void {
    this.statuses.set(component.id, { id: component.id, kind: component.kind, ...change })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

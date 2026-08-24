import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ActionClaimRelease, ActionStorePort, ClaimedAction } from '../storage/types.js'
import type { RoutedExecutorRequest, RoutedExecutorResult } from './router.js'
import { isInfrastructureFailure } from './router.js'

export interface DurableExecutorRoute {
  execute(request: RoutedExecutorRequest, signal: AbortSignal): Promise<RoutedExecutorResult>
}

export type DurableExecutorStore = Pick<ActionStorePort, 'claimNextAction' | 'settleAction'> & {
  releaseActionClaim(input: ActionClaimRelease): Promise<void>
}

export interface DurableExecutorWorkerConfig {
  readonly workerId: string
  readonly workspace: string
  readonly leaseMs?: number
  readonly retryDelayMs?: number
  readonly maxAttempts?: number
}

export interface DurableActionAgentLease {
  readonly parent: Agent
  readonly sessionId: string
  dispose(): Promise<void>
}

export interface DurableActionAgentHost {
  acquire(actionId: string, workspace: string, signal: AbortSignal): Promise<DurableActionAgentLease>
}

export interface DurableWorkerRun {
  readonly status: 'idle' | 'completed' | 'needs-input' | 'failed' | 'deferred'
  readonly actionId?: string
  readonly attempt?: number
  readonly error?: string
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 4_096)
}

function retryableResult(result: RoutedExecutorResult): boolean {
  if (result.status !== 'failed' || result.attempts.length === 0) return false
  return result.attempts.every((attempt) => attempt.status === 'failed' && isInfrastructureFailure(attempt.failureReason ?? ''))
}

export class DurableExecutorWorker {
  private readonly leaseMs: number
  private readonly retryDelayMs: number
  private readonly maxAttempts: number

  constructor(
    private readonly store: DurableExecutorStore,
    private readonly router: DurableExecutorRoute,
    private readonly agents: DurableActionAgentHost,
    private readonly config: DurableExecutorWorkerConfig,
  ) {
    this.leaseMs = config.leaseMs ?? 2 * 60 * 60 * 1_000
    this.retryDelayMs = config.retryDelayMs ?? 2 * 60 * 1_000
    this.maxAttempts = config.maxAttempts ?? 5
    if (!config.workerId.trim()) throw new Error('durable executor workerId is required')
    if (!config.workspace.trim()) throw new Error('durable executor workspace is required')
    if (!Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1_000) throw new Error('leaseMs must be an integer of at least 1000')
    if (!Number.isSafeInteger(this.retryDelayMs) || this.retryDelayMs < 0) throw new Error('retryDelayMs must be a non-negative integer')
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1) throw new Error('maxAttempts must be a positive integer')
  }

  async runOnce(signal: AbortSignal, now = new Date()): Promise<DurableWorkerRun> {
    const claim = await this.store.claimNextAction(
      this.config.workerId,
      this.config.workspace,
      now.toISOString(),
      new Date(now.getTime() + this.leaseMs).toISOString(),
    )
    if (!claim) return { status: 'idle' }
    let lease: DurableActionAgentLease | undefined
    try {
      lease = await this.agents.acquire(claim.actionId, this.config.workspace, signal)
      const result = await this.router.execute(this.routeRequest(claim, lease.parent), signal)
      if (retryableResult(result) && claim.attempt < this.maxAttempts) {
        await this.defer(claim, result.summary, now)
        return { status: 'deferred', actionId: claim.actionId, attempt: claim.attempt, error: result.summary }
      }
      await this.store.settleAction(claim.actionId, this.config.workerId, result)
      return { status: result.status, actionId: claim.actionId, attempt: claim.attempt }
    } catch (error) {
      const message = errorText(error)
      const retry = isInfrastructureFailure(error) && claim.attempt < this.maxAttempts
      await this.store.releaseActionClaim({
        actionId: claim.actionId,
        workerId: this.config.workerId,
        disposition: retry ? 'retry' : 'failed',
        error: message,
        ...(retry ? { availableAt: this.nextRetry(now, claim.attempt) } : {}),
      })
      return {
        status: retry ? 'deferred' : 'failed',
        actionId: claim.actionId,
        attempt: claim.attempt,
        error: message,
      }
    } finally {
      await lease?.dispose()
    }
  }

  private routeRequest(claim: ClaimedAction, parent: Agent): RoutedExecutorRequest {
    return {
      ...claim.request,
      parent,
      approvalGranted: claim.approvalGranted,
      ...(claim.requestedExecutor ? { requestedExecutor: claim.requestedExecutor } : {}),
    }
  }

  private async defer(claim: ClaimedAction, error: string, now: Date): Promise<void> {
    await this.store.releaseActionClaim({
      actionId: claim.actionId,
      workerId: this.config.workerId,
      disposition: 'retry',
      error,
      availableAt: this.nextRetry(now, claim.attempt),
    })
  }

  private nextRetry(now: Date, attempt: number): string {
    const multiplier = Math.min(2 ** Math.max(0, attempt - 1), 32)
    return new Date(now.getTime() + this.retryDelayMs * multiplier).toISOString()
  }
}

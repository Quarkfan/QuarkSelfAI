import { Context, Service } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import {
  DurableExecutorWorker,
  type DurableActionAgentHost, type DurableActionAgentLease, type DurableWorkerRun,
} from './worker.js'
import type {} from '../storage/service-contract.js'
import type {} from './router.js'
import { DEFAULT_DURABLE_RECOVERY_INTERVAL_MS, DurableWakeScheduler } from '../runtime/wake-scheduler.js'

declare module '@deepseek-ai/cordis' {
  interface Context { quarkActionWorker: ActionWorkerService }
}

/**
 * Agent-bound execution is deliberately separate from the durable ledger.
 * External intake cannot borrow an arbitrary live conversation as its parent;
 * this provider derives one exact DSH parent session from the durable action id.
 */
export class ActionWorkerService extends Service {
  static inject = ['agents', 'quarkActionWorkerState', 'quarkExecutors']
  private readonly workers: readonly DurableExecutorWorker[]
  private running = false
  private readonly controller = new AbortController()
  private readonly scheduler: DurableWakeScheduler<readonly DurableWorkerRun[]>

  constructor(ctx: Context, config: ActionWorkerConfig) {
    super(ctx, 'quarkActionWorker')
    validateConfig(config)
    const host = new CordisActionAgentHost(ctx.agents, config)
    this.workers = config.workspaces.map(workspace => new DurableExecutorWorker(
      ctx.quarkActionWorkerState,
      ctx.quarkExecutors,
      host,
      {
        workerId: `${config.workerId}:${createHash('sha256').update(workspace).digest('hex').slice(0, 8)}`,
        workspace,
        ...(config.leaseMs === undefined ? {} : { leaseMs: config.leaseMs }),
        ...(config.retryDelayMs === undefined ? {} : { retryDelayMs: config.retryDelayMs }),
        ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
      },
    ))
    this.scheduler = new DurableWakeScheduler({
      enabled: config.enabled === true,
      recoveryIntervalMs: config.pollIntervalMs ?? DEFAULT_ACTION_RECOVERY_POLL_INTERVAL_MS,
      run: () => this.runOnce(),
      continueAfter: results => results.some(result => result.status !== 'idle'),
      onError: error => ctx.logger('quark-action-worker').error(error),
    })
    if (config.enabled === true) {
      ctx.on('quark/action-wake', at => this.scheduler.wake(at))
      this.scheduler.wake()
    }
    ctx.effect(() => () => { this.scheduler.dispose(); this.controller.abort() }, 'quark durable action wake scheduler')
  }

  async runOnce(now = new Date()): Promise<readonly DurableWorkerRun[]> {
    if (this.running) return []
    this.running = true
    try {
      return await Promise.all(this.workers.map(worker => worker.runOnce(this.controller.signal, now)))
    } finally { this.running = false }
  }
}

export interface ActionWorkerConfig {
  readonly enabled?: boolean
  readonly workerId: string
  readonly workspaces: readonly string[]
  readonly pollIntervalMs?: number
  readonly leaseMs?: number
  readonly retryDelayMs?: number
  readonly maxAttempts?: number
  readonly provider?: string
  readonly model?: string
}

class CordisActionAgentHost implements DurableActionAgentHost {
  constructor(private readonly agents: Context['agents'], private readonly config: ActionWorkerConfig) {}

  async acquire(actionId: string, workspace: string, signal: AbortSignal): Promise<DurableActionAgentLease> {
    const id = SessionId(deterministicUuid(`quark-action:${actionId}`))
    const live = this.agents.get(id)
    if (live?.status === 'running') throw new Error(`action session transport is busy: ${id}`)
    let handle: AgentHandle | undefined
    let parent: Agent
    if (live) parent = live
    else {
      handle = await this.resume(id, signal)
      if (handle) parent = handle.agent
      else {
        handle = await this.agents.create({
          sessionId: id,
          meta: { cwd: workspace },
          agentOptions: {
            ...(this.config.provider ? { provider: this.config.provider } : {}),
            ...(this.config.model ? { model: this.config.model } : {}),
          },
          signal,
        })
        parent = handle.agent
      }
    }
    if (parent.session.header.cwd !== workspace) {
      await handle?.dispose()
      throw new Error(`action session ${id} belongs to a different workspace`)
    }
    return { parent, sessionId: String(id), dispose: async () => { await handle?.dispose() } }
  }

  private async resume(id: SessionId, signal: AbortSignal): Promise<AgentHandle | undefined> {
    try { return await this.agents.resume({ resumeSessionId: id, signal }) }
    catch (error) {
      if (/not found|session-not-found|unknown session/i.test(error instanceof Error ? error.message : String(error))) return undefined
      throw error
    }
  }
}

export const name = 'quark-agent-action-worker'
export const inject = ['agents', 'quarkActionWorkerState', 'quarkExecutors']
export const DEFAULT_ACTION_RECOVERY_POLL_INTERVAL_MS = DEFAULT_DURABLE_RECOVERY_INTERVAL_MS
export function apply(ctx: Context, config: ActionWorkerConfig): void {
  ctx.plugin(ActionWorkerService, config)
}

function validateConfig(config: ActionWorkerConfig): void {
  if (!config.workerId?.trim()) throw new Error('action worker workerId is required')
  if (!Array.isArray(config.workspaces) || config.workspaces.length === 0 || config.workspaces.some(workspace => typeof workspace !== 'string' || !workspace.trim())) {
    throw new Error('action worker requires at least one workspace')
  }
  if (new Set(config.workspaces).size !== config.workspaces.length) throw new Error('action worker workspaces must be unique')
  const interval = config.pollIntervalMs ?? DEFAULT_ACTION_RECOVERY_POLL_INTERVAL_MS
  if (!Number.isSafeInteger(interval) || interval < 1_000) throw new Error('action worker pollIntervalMs must be at least 1000')
}

function deterministicUuid(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

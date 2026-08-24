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

declare module '@deepseek-ai/cordis' {
  interface Context { quarkActionWorker: ActionWorkerService }
}

/**
 * Agent-bound execution is deliberately separate from the durable ledger.
 * External intake cannot borrow an arbitrary live conversation as its parent;
 * this provider derives one exact DSH parent session from the durable action id.
 */
export class ActionWorkerService extends Service {
  private readonly workers: readonly DurableExecutorWorker[]
  private running = false
  private readonly controller = new AbortController()

  constructor(ctx: Context, config: ActionWorkerConfig) {
    super(ctx, 'quarkActionWorker')
    validateConfig(config)
    const host = new CordisActionAgentHost(ctx, config)
    this.workers = config.workspaces.map(workspace => new DurableExecutorWorker(
      ctx.quarkState,
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
    if (config.enabled === true) {
      const timer = setInterval(() => void this.runOnce().catch(error => ctx.logger('quark-action-worker').error(error)), config.pollIntervalMs ?? 30_000)
      timer.unref()
      ctx.effect(() => () => { clearInterval(timer); this.controller.abort() }, 'quark durable action worker timer')
    }
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
  constructor(private readonly ctx: Context, private readonly config: ActionWorkerConfig) {}

  async acquire(actionId: string, workspace: string, signal: AbortSignal): Promise<DurableActionAgentLease> {
    const id = SessionId(deterministicUuid(`quark-action:${actionId}`))
    const live = this.ctx.agents.get(id)
    if (live?.status === 'running') throw new Error(`action session transport is busy: ${id}`)
    let handle: AgentHandle | undefined
    let parent: Agent
    if (live) parent = live
    else {
      handle = await this.resume(id, signal)
      if (handle) parent = handle.agent
      else {
        handle = await this.ctx.agents.create({
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
    try { return await this.ctx.agents.resume({ resumeSessionId: id, signal }) }
    catch (error) {
      if (/not found|session-not-found|unknown session/i.test(error instanceof Error ? error.message : String(error))) return undefined
      throw error
    }
  }
}

export const name = 'quark-agent-action-worker'
export const inject = ['agents', 'quarkState', 'quarkExecutors']
export function apply(ctx: Context, config: ActionWorkerConfig): void {
  ctx.plugin(ActionWorkerService, config)
}

function validateConfig(config: ActionWorkerConfig): void {
  if (!config.workerId?.trim()) throw new Error('action worker workerId is required')
  if (!Array.isArray(config.workspaces) || config.workspaces.length === 0 || config.workspaces.some(workspace => typeof workspace !== 'string' || !workspace.trim())) {
    throw new Error('action worker requires at least one workspace')
  }
  if (new Set(config.workspaces).size !== config.workspaces.length) throw new Error('action worker workspaces must be unique')
  const interval = config.pollIntervalMs ?? 30_000
  if (!Number.isSafeInteger(interval) || interval < 1_000) throw new Error('action worker pollIntervalMs must be at least 1000')
}

function deterministicUuid(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

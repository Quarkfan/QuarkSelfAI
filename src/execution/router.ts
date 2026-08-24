import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { ExecutorId, ExecutorRequest, ExecutorResult } from '../domain/contracts.js'
import { WorkspacePolicy } from './workspace-policy.js'

const INFRASTRUCTURE_FAILURE = /(timeout|timed out|transport|network|connection|socket|websocket|dns|rate.?limit|quota|process-exit|spawn|enoent|unauthorized|authentication|429|502|503|504)/i

export type RoutedExecutor = ExecutorId

export interface RoutedExecutorRequest extends ExecutorRequest {
  readonly parent: Agent
  readonly requestedExecutor?: RoutedExecutor
  readonly approvalGranted: boolean
}

export interface ExecutorAttempt {
  readonly executor: RoutedExecutor
  readonly provider: string
  readonly status: 'completed' | 'failed'
  readonly failureStage?: 'start' | 'run'
  readonly failureReason?: string
}

export interface RoutedExecutorResult extends ExecutorResult {
  readonly attempts: readonly ExecutorAttempt[]
  readonly output: readonly ContentBlock[]
}

export interface SubagentDispatcher {
  start(provider: string, request: {
    prompt: ContentBlock[]
    parent: Agent
    signal: AbortSignal
    label?: string
  }): Promise<SubagentRun>
}

export interface ExecutorRouterConfig {
  readonly workspaceRoots: readonly string[]
  readonly defaultExecutor: RoutedExecutor
  readonly providers: Readonly<Record<RoutedExecutor, ExecutorProviderNames>>
  readonly routes: Readonly<Record<RoutedExecutor, readonly RoutedExecutor[]>>
}

export interface ExecutorProviderNames {
  readonly readOnly: string
  readonly write: string
}

function summary(blocks: readonly ContentBlock[], fallback: string): string {
  const text = blocks.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text).join('\n').trim()
  return text || fallback
}

function diagnostic(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 4_096)
}

export function isInfrastructureFailure(error: unknown): boolean {
  return INFRASTRUCTURE_FAILURE.test(diagnostic(error))
}

export class SequentialExecutorRouter {
  private readonly active = new Set<string>()

  constructor(
    private readonly dispatcher: SubagentDispatcher,
    private readonly policy: WorkspacePolicy,
    private readonly providers: Readonly<Record<RoutedExecutor, ExecutorProviderNames>>,
    private readonly routes: Readonly<Record<RoutedExecutor, readonly RoutedExecutor[]>>,
    private readonly defaultExecutor: RoutedExecutor,
  ) { validateRouting(providers, routes, defaultExecutor) }

  async execute(request: RoutedExecutorRequest, signal: AbortSignal): Promise<RoutedExecutorResult> {
    if (this.active.has(request.actionId)) throw new Error(`action ${request.actionId} already has an active executor`)
    this.active.add(request.actionId)
    try {
      if (request.mode !== 'read-only' && !request.approvalGranted) {
        throw new Error(`${request.mode} execution requires a durable owner approval`)
      }
      const workspace = await this.policy.authorizeExisting(request.workspace)
      const parentWorkspace = request.parent.session.header.cwd
      if (!parentWorkspace || await this.policy.authorizeExisting(parentWorkspace) !== workspace) {
        throw new Error('executor request workspace must match the parent DSH session workspace')
      }
      const requested = request.requestedExecutor ?? this.defaultExecutor
      const route = this.routes[requested] ?? [requested]
      if (!this.providers[requested]) throw new Error(`executor ${requested} is not registered`)
      const attempts: ExecutorAttempt[] = []
      for (let index = 0; index < route.length; index += 1) {
        const executor = route[index]!
        const names = this.providers[executor]
        if (!names) throw new Error(`executor route ${requested} references unregistered executor ${executor}`)
        const provider = request.mode === 'read-only'
          ? names.readOnly
          : names.write
        let run: SubagentRun | undefined
        try {
          run = await this.dispatcher.start(provider, {
            prompt: [{ type: 'text', text: request.prompt }],
            parent: request.parent,
            signal,
            label: request.title,
          })
          const result = await run.result
          if (result.stopReason === 'completed') {
            attempts.push({ executor, provider, status: 'completed' })
            return {
              actionId: request.actionId,
              executor,
              status: 'completed',
              summary: summary(result.output, 'executor completed without a text summary'),
              sessionId: String(run.id),
              attempts,
              output: result.output,
            }
          }
          const reason = result.diagnostic ?? result.stopReason
          attempts.push({ executor, provider, status: 'failed', failureStage: 'run', failureReason: reason })
          if (index === route.length - 1 || !isInfrastructureFailure(reason)) {
            return this.failed(request.actionId, executor, attempts, result)
          }
        } catch (error) {
          const reason = diagnostic(error)
          attempts.push({ executor, provider, status: 'failed', failureStage: run ? 'run' : 'start', failureReason: reason })
          if (index === route.length - 1 || !isInfrastructureFailure(reason)) {
            return this.failed(request.actionId, executor, attempts)
          }
        } finally {
          await run?.dispose()
        }
      }
      return this.failed(request.actionId, attempts.at(-1)?.executor ?? requested, attempts)
    } finally {
      this.active.delete(request.actionId)
    }
  }

  private failed(actionId: string, executor: RoutedExecutor, attempts: readonly ExecutorAttempt[], result?: SubagentResult): RoutedExecutorResult {
    const output = result?.output ?? []
    return {
      actionId,
      executor,
      status: result?.stopReason === 'refusal' ? 'needs-input' : 'failed',
      summary: summary(output, attempts.at(-1)?.failureReason ?? 'executor failed'),
      attempts: [...attempts],
      output,
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    quarkExecutors: ExecutorRouterService
  }
}

export class ExecutorRouterService extends Service {
  private readonly ready: Promise<SequentialExecutorRouter>

  constructor(ctx: Context, config: ExecutorRouterConfig) {
    super(ctx, 'quarkExecutors')
    this.ready = WorkspacePolicy.create(config.workspaceRoots).then((policy) => new SequentialExecutorRouter(
      ctx.subagents,
      policy,
      config.providers,
      config.routes,
      config.defaultExecutor,
    ))
  }

  async execute(request: RoutedExecutorRequest, signal: AbortSignal): Promise<RoutedExecutorResult> {
    return await (await this.ready).execute(request, signal)
  }
}

function validateRouting(
  providers: Readonly<Record<string, ExecutorProviderNames>>,
  routes: Readonly<Record<string, readonly string[]>>,
  defaultExecutor: string,
): void {
  if (!defaultExecutor.trim() || !providers[defaultExecutor]) throw new Error('executor default must name a registered provider')
  for (const [id, names] of Object.entries(providers)) {
    if (!id.trim() || !names.readOnly?.trim() || !names.write?.trim()) throw new Error(`executor ${id || '<empty>'} requires readOnly and write providers`)
  }
  for (const [id, route] of Object.entries(routes)) {
    if (!providers[id]) throw new Error(`executor route ${id} has no registered provider`)
    if (route.length === 0 || route[0] !== id || new Set(route).size !== route.length) throw new Error(`executor route ${id} must start with itself and contain unique entries`)
    for (const target of route) if (!providers[target]) throw new Error(`executor route ${id} references unregistered executor ${target}`)
  }
}

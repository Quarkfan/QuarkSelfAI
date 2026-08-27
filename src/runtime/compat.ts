import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkspacePolicy } from '../execution/workspace-policy.js'
import { terminateChildGracefully } from './child-process.js'
import type {
  RuntimeDiagnostics, RuntimeSnapshot, RuntimeStatusProvider,
} from '../platform/operations.js'
import type { ManagedComponent } from '../platform/lifecycle.js'

export type {
  MonitorDiagnostic, RuntimeDiagnostics, RuntimeSnapshot, RuntimeStatusProvider,
} from '../platform/operations.js'
export { ControlOnlyRuntime } from '../platform/defaults.js'

const compatRoot = fileURLToPath(new URL('../../packages/bridge-compat/', import.meta.url))
const compatEntry = fileURLToPath(new URL('../../packages/bridge-compat/src/index.js', import.meta.url))

export class CompatReadinessObserver {
  private tail = ''

  constructor(private readonly requiredEventKeys: readonly string[] = [
    'im.message.receive_v1',
    'card.action.trigger',
  ]) {}

  observe(snapshot: RuntimeSnapshot, text: string, pid?: number): RuntimeSnapshot {
    this.tail = `${this.tail}${text}`.slice(-4_096)
    const previous = new Map(snapshot.capabilities.map(capability => [capability.id, capability.state]))
    const readyEventKeys = this.requiredEventKeys.filter((eventKey) => (
      previous.get(eventCapabilityId(eventKey)) === 'ready'
      || this.tail.includes(`[event] ready event_key=${eventKey}`)
    ))
    const capabilities = this.requiredEventKeys.map((eventKey) => ({
      id: eventCapabilityId(eventKey),
      required: true,
      state: readyEventKeys.includes(eventKey) ? 'ready' as const : 'starting' as const,
      detail: eventKey,
    }))
    return {
      ...snapshot,
      state: readyEventKeys.length === this.requiredEventKeys.length ? 'ready' : snapshot.state,
      capabilities,
      ...(pid ? { pid } : {}),
    }
  }
}

function eventCapabilityId(eventKey: string): string {
  return `channel-event:${eventKey}`
}

export class CompatRuntime implements RuntimeStatusProvider {
  private child: ChildProcessWithoutNullStreams | undefined
  private readiness = new CompatReadinessObserver()
  private readonly failurePromise: Promise<Error>
  private resolveFailure!: (error: Error) => void
  private current: RuntimeSnapshot = {
    mode: 'compat',
    operationalMode: 'accepted-risk-cutover',
    state: 'stopped',
    capabilities: [],
  }

  constructor(
    private readonly configPath: string,
    private readonly processOptions: {
      readonly entry?: string
      readonly cwd?: string
      readonly executable?: string
      readonly workspaceRoots?: readonly string[]
    } = {},
  ) {
    this.failurePromise = new Promise((resolve) => { this.resolveFailure = resolve })
  }

  snapshot(): RuntimeSnapshot {
    return { ...this.current }
  }

  async diagnostics(): Promise<RuntimeDiagnostics> {
    const document = JSON.parse(await readFile(this.configPath, 'utf8')) as Record<string, unknown>
    const varDir = typeof document.varDir === 'string' ? document.varDir : join(this.processOptions.cwd ?? compatRoot, 'var')
    const state = JSON.parse(await readFile(join(varDir, 'state.json'), 'utf8')) as Record<string, unknown>
    const arrayCount = (key: string): number => Array.isArray(state[key]) ? state[key].length : 0
    const value = (key: string): string | null => typeof state[key] === 'string' ? state[key] : null
    const failure = (key: string): string | null => {
      const current = state[key]
      if (typeof current === 'string') return current
      if (current && typeof current === 'object') {
        const record = current as Record<string, unknown>
        return typeof record.message === 'string' ? record.message
          : typeof record.lastError === 'string' ? record.lastError
            : typeof record.error === 'string' ? record.error : null
      }
      return null
    }
    const number = (key: string): number | undefined => typeof document[key] === 'number' ? document[key] : undefined
    const stateObjectNumber = (key: string, field: string): number => {
      const current = state[key]
      if (!current || typeof current !== 'object') return 0
      const value = (current as Record<string, unknown>)[field]
      return typeof value === 'number' ? value : 0
    }
    const sourceFailures = (key: string): string | null => {
      const current = state[key]
      if (!Array.isArray(current) || current.length === 0) return null
      return current.map((item) => {
        if (!item || typeof item !== 'object') return '未知来源异常'
        const record = item as Record<string, unknown>
        return `${String(record.source ?? 'unknown')}: ${String(record.error ?? '读取失败')}`
      }).join('; ')
    }
    const learning = state.collaborationLearning && typeof state.collaborationLearning === 'object'
      ? state.collaborationLearning as Record<string, unknown> : {}
    return {
      monitors: [
        { id: 'focus', name: '飞书重点消息', enabled: document.mentionMonitorEnabled !== false, intervalMs: number('mentionPollIntervalMs'), lastRunAt: value('mentionLastPollAt'), nextRunAt: value('mentionNextPollAt'), failure: failure('mentionHealthFailure') ?? failure('mentionProcessingFailure'), pending: arrayCount('mentionPending') },
        { id: 'flags', name: '标记会话同步', enabled: document.monitorFlaggedConversations !== false, intervalMs: number('flaggedConversationSyncIntervalMs'), lastRunAt: value('flaggedConversationLastSyncAt'), failure: failure('flaggedConversationHealthFailure'), pending: arrayCount('flaggedConversationChatIds') },
        { id: 'attention-signals', name: '飞书注意力画像', enabled: document.conversationAttentionEnabled !== false, intervalMs: number('conversationAttentionSyncIntervalMs'), lastRunAt: value('conversationAttentionLastSyncAt'), failure: failure('conversationAttentionHealthFailure') ?? sourceFailures('conversationAttentionSourceErrors'), pending: stateObjectNumber('conversationAttentionInventory', 'watched') },
        { id: 'delegated-groups', name: '任永强交接群', enabled: document.groupMembershipMonitorEnabled !== false, intervalMs: number('groupMembershipSyncIntervalMs'), lastRunAt: value('groupMembershipLastSyncAt'), failure: failure('groupMembershipHealthFailure'), pending: arrayCount('delegatedGroupChatIds') },
        { id: 'owner-engagement', name: '本人参与与表情信号', enabled: document.ownerEngagementEnabled !== false, intervalMs: number('ownerEngagementPollIntervalMs'), lastRunAt: value('ownerEngagementLastPollAt'), failure: failure('ownerEngagementHealthFailure'), pending: arrayCount('ownerEngagedConversations') + arrayCount('reactionPendingEvents') },
        { id: 'cards', name: '交互卡片回调', enabled: true, intervalMs: undefined, failure: failure('cardActionHealthFailure'), pending: arrayCount('mentionResearchConfirmations') + arrayCount('followupOutreachRequests') },
        { id: 'overdue', name: '滴答超期待办', enabled: document.overdueMonitorEnabled !== false, intervalMs: number('overduePollIntervalMs'), failure: failure('overdueHealthFailure'), pending: state.overdueNotified && typeof state.overdueNotified === 'object' ? Object.keys(state.overdueNotified).length : 0 },
        { id: 'followup', name: '自动化跟进', enabled: document.followupMonitorEnabled !== false, intervalMs: number('followupPollIntervalMs'), lastRunAt: value('followupLastCheckedAt'), failure: failure('followupHealthFailure'), pending: arrayCount('followupOutreachRequests') },
        { id: 'xiaowei', name: '智造湖小维', enabled: document.xiaoweiMonitorEnabled !== false, intervalMs: number('xiaoweiPollIntervalMs'), lastRunAt: value('xiaoweiLastPollAt'), failure: failure('xiaoweiHealthFailure'), pending: arrayCount('xiaoweiResearchRequests') },
        { id: 'task-cleanup', name: '已完成待办清理', enabled: document.didaCompletedCleanupEnabled === true, intervalMs: number('didaCompletedCleanupIntervalMs'), lastRunAt: value('didaCompletedCleanupLastAt'), failure: failure('didaCompletedCleanupHealthFailure') },
        { id: 'session-cleanup', name: '调研会话清理', enabled: document.sessionCleanupEnabled !== false, intervalMs: number('sessionCleanupIntervalMs'), pending: arrayCount('mentionResearchSessions') },
        { id: 'collaboration-learning', name: '协作模式学习', enabled: document.collaborationLearningEnabled !== false, intervalMs: number('collaborationLearningIntervalMs'), lastRunAt: typeof learning.lastEvaluatedAt === 'string' ? learning.lastEvaluatedAt : null, pending: Array.isArray(learning.candidates) ? learning.candidates.filter((item) => item && typeof item === 'object' && (item as Record<string, unknown>).status === 'proposed').length : 0 },
        { id: 'notification-digest', name: '协作事项汇总', enabled: true, intervalMs: number('notificationDigestPollIntervalMs'), lastRunAt: value('notificationDigestLastSentAt'), failure: failure('notificationDigestFailure'), pending: arrayCount('notificationDigestPending') },
      ],
      queues: {
        commands: arrayCount('queue'),
        focus: arrayCount('mentionPending'),
        research: arrayCount('mentionResearchSessions'),
        approvals: arrayCount('mentionResearchConfirmations') + arrayCount('followupOutreachRequests'),
        xiaowei: arrayCount('xiaoweiResearchRequests'),
      },
      retention: {
        didaCompletedCleanupEnabled: document.didaCompletedCleanupEnabled === true,
        didaCompletedRetentionDays: number('didaCompletedRetentionDays') ?? 30,
        sessionDeleteAfterDays: number('sessionDeleteAfterDays') ?? 7,
      },
    }
  }

  async updateMonitor(id: string, input: { enabled?: boolean; intervalMs?: number }): Promise<void> {
    const mapping: Record<string, { enabled?: string; interval?: string }> = {
      focus: { enabled: 'mentionMonitorEnabled', interval: 'mentionPollIntervalMs' },
      flags: { enabled: 'monitorFlaggedConversations', interval: 'flaggedConversationSyncIntervalMs' },
      'attention-signals': { enabled: 'conversationAttentionEnabled', interval: 'conversationAttentionSyncIntervalMs' },
      'delegated-groups': { enabled: 'groupMembershipMonitorEnabled', interval: 'groupMembershipSyncIntervalMs' },
      'owner-engagement': { enabled: 'ownerEngagementEnabled', interval: 'ownerEngagementPollIntervalMs' },
      overdue: { enabled: 'overdueMonitorEnabled', interval: 'overduePollIntervalMs' },
      followup: { enabled: 'followupMonitorEnabled', interval: 'followupPollIntervalMs' },
      xiaowei: { enabled: 'xiaoweiMonitorEnabled', interval: 'xiaoweiPollIntervalMs' },
      'task-cleanup': { enabled: 'didaCompletedCleanupEnabled', interval: 'didaCompletedCleanupIntervalMs' },
      'session-cleanup': { enabled: 'sessionCleanupEnabled', interval: 'sessionCleanupIntervalMs' },
      'collaboration-learning': { enabled: 'collaborationLearningEnabled', interval: 'collaborationLearningIntervalMs' },
      'notification-digest': { interval: 'notificationDigestPollIntervalMs' },
    }
    const target = mapping[id]
    if (!target) throw new Error(`monitor ${id} is read-only or unknown`)
    if (input.intervalMs !== undefined && (!Number.isSafeInteger(input.intervalMs) || input.intervalMs < 15_000 || input.intervalMs > 86_400_000)) {
      throw new Error('intervalMs must be an integer from 15000 to 86400000')
    }
    const document = JSON.parse(await readFile(this.configPath, 'utf8')) as Record<string, unknown>
    if (input.enabled !== undefined && target.enabled) document[target.enabled] = input.enabled
    if (input.intervalMs !== undefined && target.interval) document[target.interval] = input.intervalMs
    const temporary = `${this.configPath}.tmp`
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.configPath)
  }

  async start(): Promise<void> {
    if (this.child) throw new Error('compat runtime is already started')
    await this.validateWorkspaceBoundary()
    const config = JSON.parse(await readFile(this.configPath, 'utf8')) as Record<string, unknown>
    const requiredEventKeys = ['im.message.receive_v1', 'card.action.trigger']
    if (config.membershipRealtimeEnabled === true) requiredEventKeys.push('im.chat.member.user.added_v1')
    if (config.reactionRealtimeEnabled === true) {
      requiredEventKeys.push('im.message.reaction.created_v1', 'im.message.reaction.deleted_v1')
    }
    this.readiness = new CompatReadinessObserver(requiredEventKeys)
    this.current = {
      mode: 'compat',
      operationalMode: 'accepted-risk-cutover',
      state: 'starting',
      capabilities: requiredEventKeys.map((eventKey) => ({
        id: eventCapabilityId(eventKey), required: true, state: 'starting', detail: eventKey,
      })),
      startedAt: new Date().toISOString(),
    }
    const child = spawn(this.processOptions.executable ?? process.execPath, [this.processOptions.entry ?? compatEntry], {
      cwd: this.processOptions.cwd ?? compatRoot,
      env: {
        ...process.env,
        CODEX_LARK_CONFIG: this.configPath,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    const observe = (chunk: Buffer, target: NodeJS.WriteStream): void => {
      const text = chunk.toString('utf8')
      target.write(text)
      this.current = this.readiness.observe(this.current, text, child.pid)
    }
    child.stdout.on('data', (chunk: Buffer) => observe(chunk, process.stdout))
    child.stderr.on('data', (chunk: Buffer) => observe(chunk, process.stderr))
    child.once('error', (error) => {
      this.current = { ...this.current, state: 'failed', lastError: error.message }
      this.resolveFailure(error)
    })
    child.once('exit', (code, signal) => {
      const expected = this.child === undefined
      this.child = undefined
      const { lastError: _lastError, ...snapshotWithoutError } = this.current
      this.current = expected
        ? { ...snapshotWithoutError, state: 'stopped' }
        : {
            ...snapshotWithoutError,
            state: 'failed',
            lastError: `compat runtime exited code=${String(code)} signal=${String(signal)}`,
          }
      if (!expected) this.resolveFailure(new Error(this.current.lastError ?? 'compat runtime exited unexpectedly'))
    })
    await once(child, 'spawn')
    this.current = { ...this.current, ...(child.pid ? { pid: child.pid } : {}) }
  }

  async waitUntilReady(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.current.state === 'ready') return
      if (this.current.state === 'failed') throw new Error(this.current.lastError ?? 'compat runtime failed')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    this.current = { ...this.current, state: 'degraded', lastError: 'compat runtime readiness timed out' }
    throw new Error('compat runtime did not make every configured Feishu consumer ready')
  }

  async waitForFailure(): Promise<Error> {
    return await this.failurePromise
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null) return
    this.child = undefined
    if (!await terminateChildGracefully(child, 15_000)) {
      this.child = child
      this.current = { ...this.current, state: 'degraded', lastError: 'compat runtime did not stop gracefully; SIGKILL was intentionally not used' }
      throw new Error(this.current.lastError)
    }
    this.current = {
      mode: 'compat', operationalMode: 'accepted-risk-cutover',
      state: 'stopped', capabilities: [],
    }
  }

  private async validateWorkspaceBoundary(): Promise<void> {
    const roots = this.processOptions.workspaceRoots
    if (!roots) return
    const policy = await WorkspacePolicy.create(roots)
    const document = JSON.parse(await readFile(this.configPath, 'utf8')) as { workspaceRoot?: unknown }
    if (typeof document.workspaceRoot !== 'string' || !document.workspaceRoot.trim()) {
      throw new Error('compatibility config must define workspaceRoot')
    }
    await policy.authorizeExisting(document.workspaceRoot)
  }
}

/** Migration-only lifecycle contribution; the application skeleton never imports it. */
export function compatRuntimeComponent(runtime: CompatRuntime): ManagedComponent {
  return {
    id: 'bridge-compat',
    kind: 'migration',
    start: async () => {
      await runtime.start()
      await runtime.waitUntilReady()
      process.stdout.write('QuarkSelfAI compatibility runtime ready\n')
    },
    stop: async () => { await runtime.stop() },
    waitForFailure: async () => await runtime.waitForFailure(),
  }
}

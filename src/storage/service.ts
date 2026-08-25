import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import { eventRecordId, type NormalizedChannelEvent } from '../domain/contracts.js'
import { PgAssistantStore, createPgPool } from './postgres.js'
import { createSqliteStore } from './sqlite.js'
import type {
  AssistantStore,
  ActionClaimRelease,
  AdvanceWorkflowInput,
  ClaimedAction,
  ClaimedChannelEvent,
  ClaimedWorkflowEffect,
  CreateWorkflowInput,
  DurableActionInput,
  DurableSignal,
  DurableSignalInput,
  EventClaimRelease,
  PolicyDraftInput,
  StoredEvent,
  WorkflowInstance,
} from './types.js'
import type { PolicySample } from '../policy/types.js'
import type { ExecutorResult } from '../domain/contracts.js'
import type { DurableStatePort } from './service-contract.js'

const sqliteMigrations = fileURLToPath(new URL('../../migrations/sqlite/', import.meta.url))
const postgresMigrations = fileURLToPath(new URL('../../migrations/', import.meta.url))

export interface DurableStateConfig {
  readonly storageKind?: 'sqlite' | 'postgres'
  readonly sqlitePath?: string
  readonly databaseUrl?: string
}

async function createStateStore(config: DurableStateConfig): Promise<AssistantStore> {
  if (config.storageKind === 'postgres') {
    if (!config.databaseUrl?.trim()) throw new Error('durable state databaseUrl is required for PostgreSQL')
    const store = new PgAssistantStore(createPgPool({ connectionString: config.databaseUrl }), postgresMigrations)
    await store.migrate()
    return store
  }
  if (!config.sqlitePath?.trim() || !isAbsolute(config.sqlitePath)) {
    throw new Error('durable state sqlitePath must be an absolute path')
  }
  const store = await createSqliteStore(resolve(config.sqlitePath), sqliteMigrations)
  await store.migrate()
  return store
}

/** The single DSH-owned database connection provider behind the durable-state contract. */
export class DurableStateService extends Service implements DurableStatePort {
  private readonly ready: Promise<AssistantStore>

  constructor(ctx: Context, config: DurableStateConfig) {
    super(ctx, 'quarkState')
    this.ready = createStateStore(config)
    ctx.effect(() => async () => { await (await this.ready.catch(() => undefined))?.close() }, 'quark durable state store')
  }

  async appendEvent(event: NormalizedChannelEvent): Promise<StoredEvent> {
    const result = await (await this.ready).appendEvent(eventRecordId(event), event)
    if (result.inserted) {
      this.emitWake('quark/event-wake')
    }
    return result
  }

  async claimNextEvent(consumerName: string, eventKeys: readonly string[], workerId: string, now: string, leaseExpiresAt: string): Promise<ClaimedChannelEvent | undefined> {
    return await (await this.ready).claimNextEvent(consumerName, eventKeys, workerId, now, leaseExpiresAt)
  }

  async settleEvent(consumerName: string, eventId: string, workerId: string, deliveredAt: string): Promise<void> {
    await (await this.ready).settleEvent(consumerName, eventId, workerId, deliveredAt)
  }

  async releaseEvent(input: EventClaimRelease): Promise<void> {
    await (await this.ready).releaseEvent(input)
    if (!input.terminal) this.emitWake('quark/event-wake', input.availableAt)
  }

  async updateCheckpoint(consumerName: string, eventKey: string, cursor: Readonly<Record<string, unknown>>): Promise<void> {
    await (await this.ready).updateCheckpoint(consumerName, eventKey, cursor)
  }

  async appendSignal(input: DurableSignalInput): Promise<{ readonly inserted: boolean }> {
    return await (await this.ready).appendSignal(input)
  }

  async recentSignals(kind: string, limit: number): Promise<readonly DurableSignal[]> {
    return await (await this.ready).recentSignals(kind, limit)
  }

  async readFeatureCheckpoint(namespace: string, key: string): Promise<Readonly<Record<string, unknown>> | undefined> {
    return await (await this.ready).readFeatureCheckpoint(namespace, key)
  }

  async writeFeatureCheckpoint(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<void> {
    await (await this.ready).writeFeatureCheckpoint(namespace, key, value)
  }

  async recentPolicySamples(limit: number): Promise<readonly PolicySample[]> {
    return await (await this.ready).recentPolicySamples(limit)
  }

  async savePolicyDraft(input: PolicyDraftInput): Promise<number> {
    return await (await this.ready).savePolicyDraft(input)
  }

  async activatePolicy(id: string, revision: number, approvedAt: string): Promise<void> {
    await (await this.ready).activatePolicy(id, revision, approvedAt)
  }

  async enqueueAction(input: DurableActionInput): Promise<{ readonly inserted: boolean }> {
    const result = await (await this.ready).enqueueAction(input)
    if (result.inserted && !input.approval) this.emitWake('quark/action-wake')
    return result
  }

  async decideApproval(approvalId: string, decision: 'approved' | 'rejected', metadata: Readonly<Record<string, unknown>>, decidedAt: string): Promise<void> {
    await (await this.ready).decideApproval(approvalId, decision, metadata, decidedAt)
    if (decision === 'approved') this.emitWake('quark/action-wake')
  }

  async claimNextAction(workerId: string, workspace: string, now: string, leaseExpiresAt: string): Promise<ClaimedAction | undefined> {
    return await (await this.ready).claimNextAction(workerId, workspace, now, leaseExpiresAt)
  }

  async settleAction(actionId: string, workerId: string, result: ExecutorResult): Promise<void> {
    await (await this.ready).settleAction(actionId, workerId, result)
  }

  async releaseActionClaim(input: ActionClaimRelease): Promise<void> {
    await (await this.ready).releaseActionClaim(input)
    if (input.disposition === 'retry') this.emitWake('quark/action-wake', input.availableAt)
  }

  async createWorkflow(input: CreateWorkflowInput): Promise<{ readonly inserted: boolean; readonly instance: WorkflowInstance }> {
    const result = await (await this.ready).createWorkflow(input)
    if (result.inserted) this.signalWorkflowWake(result.instance, input.effects)
    return result
  }

  async workflow(id: string): Promise<WorkflowInstance | undefined> {
    return await (await this.ready).workflow(id)
  }

  async dueWorkflows(now: string, limit: number): Promise<readonly WorkflowInstance[]> {
    return await (await this.ready).dueWorkflows(now, limit)
  }

  async advanceWorkflow(input: AdvanceWorkflowInput): Promise<{ readonly advanced: boolean; readonly instance: WorkflowInstance }> {
    const result = await (await this.ready).advanceWorkflow(input)
    if (result.advanced) this.signalWorkflowWake(result.instance, input.effects)
    return result
  }

  async claimNextWorkflowEffect(workerId: string, now: string, leaseExpiresAt: string): Promise<ClaimedWorkflowEffect | undefined> {
    return await (await this.ready).claimNextWorkflowEffect(workerId, now, leaseExpiresAt)
  }

  async settleWorkflowEffect(effectId: string, workerId: string, deliveredAt: string): Promise<void> {
    await (await this.ready).settleWorkflowEffect(effectId, workerId, deliveredAt)
  }

  async releaseWorkflowEffect(effectId: string, workerId: string, error: string, availableAt: string, terminal: boolean): Promise<void> {
    await (await this.ready).releaseWorkflowEffect(effectId, workerId, error, availableAt, terminal)
    if (!terminal) this.emitWake('quark/workflow-wake', availableAt)
  }

  private signalWorkflowWake(instance: WorkflowInstance, effects?: readonly { readonly availableAt?: string }[]): void {
    const now = new Date().toISOString()
    const candidates = [
      ...(instance.wakeAt ? [instance.wakeAt] : []),
      ...(effects ?? []).map(effect => effect.availableAt ?? now),
    ]
    const earliest = candidates.reduce<string | undefined>((current, candidate) => (
      current === undefined || new Date(candidate).getTime() < new Date(current).getTime() ? candidate : current
    ), undefined)
    if (earliest) this.emitWake('quark/workflow-wake', earliest)
  }

  private emitWake(event: 'quark/event-wake' | 'quark/workflow-wake' | 'quark/action-wake', at?: string): void {
    void this.ctx.parallel(event, at).catch(error => this.ctx.logger('quark-state').error(error))
  }
}

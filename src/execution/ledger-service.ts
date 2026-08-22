import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { PgAssistantStore, createPgPool } from '../storage/postgres.js'
import { createSqliteStore } from '../storage/sqlite.js'
import type { AssistantStore, DurableActionInput } from '../storage/types.js'
import { DurableExecutorWorker, type DurableWorkerRun } from './worker.js'

const sqliteMigrations = fileURLToPath(new URL('../../migrations/sqlite/', import.meta.url))
const postgresMigrations = fileURLToPath(new URL('../../migrations/', import.meta.url))

export interface ActionLedgerConfig {
  readonly storageKind?: 'sqlite' | 'postgres'
  readonly sqlitePath?: string
  readonly databaseUrl?: string
  readonly workerId: string
  readonly leaseMs?: number
  readonly retryDelayMs?: number
  readonly maxAttempts?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    quarkActionLedger: ActionLedgerService
  }
}

async function createLedgerStore(config: ActionLedgerConfig): Promise<AssistantStore> {
  if (config.storageKind === 'postgres') {
    if (!config.databaseUrl?.trim()) throw new Error('action ledger databaseUrl is required for PostgreSQL')
    const store = new PgAssistantStore(createPgPool({ connectionString: config.databaseUrl }), postgresMigrations)
    await store.migrate()
    return store
  }
  if (!config.sqlitePath?.trim() || !isAbsolute(config.sqlitePath)) {
    throw new Error('action ledger sqlitePath must be an absolute path')
  }
  const store = await createSqliteStore(resolve(config.sqlitePath), sqliteMigrations)
  await store.migrate()
  return store
}

export class ActionLedgerService extends Service {
  private readonly ready: Promise<{ store: AssistantStore; worker: DurableExecutorWorker }>

  constructor(ctx: Context, config: ActionLedgerConfig) {
    super(ctx, 'quarkActionLedger')
    if (!config.workerId?.trim()) throw new Error('action ledger workerId is required')
    this.ready = createLedgerStore(config).then((store) => ({
      store,
      worker: new DurableExecutorWorker(store, ctx.quarkExecutors, {
        workerId: config.workerId,
        ...(config.leaseMs === undefined ? {} : { leaseMs: config.leaseMs }),
        ...(config.retryDelayMs === undefined ? {} : { retryDelayMs: config.retryDelayMs }),
        ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
      }),
    }))
    ctx.effect(() => async () => {
      const value = await this.ready.catch(() => undefined)
      await value?.store.close()
    }, 'quark action ledger store')
  }

  async enqueue(input: DurableActionInput): Promise<{ readonly inserted: boolean }> {
    return await (await this.ready).store.enqueueAction(input)
  }

  async decideApproval(approvalId: string, decision: 'approved' | 'rejected', metadata: Readonly<Record<string, unknown>>, decidedAt = new Date().toISOString()): Promise<void> {
    await (await this.ready).store.decideApproval(approvalId, decision, metadata, decidedAt)
  }

  async runOnce(parent: Agent, signal: AbortSignal): Promise<DurableWorkerRun> {
    return await (await this.ready).worker.runOnce(parent, signal)
  }
}

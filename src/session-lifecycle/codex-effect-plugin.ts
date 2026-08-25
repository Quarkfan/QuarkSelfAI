import type { Context } from '@deepseek-ai/cordis'
import { execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { requireAuthorizationEvidence } from '../domain/authorization.js'
import type { ClaimedWorkflowEffect } from '../storage/types.js'
import type {} from '../workflow/contracts.js'
import { SESSION_EFFECTS } from './types.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_MS = 86_400_000

export interface CodexSessionEffectConfig {
  readonly executable?: string
  readonly appServerSocket?: string
  readonly activityTimeoutMs?: number
  readonly stateDatabase: string
  readonly workspace: string
}

export interface CodexSessionSnapshot {
  readonly exists: boolean
  readonly archived: boolean
  readonly archivedAt?: string
}

export interface CodexSessionReader { inspect(sessionId: string): CodexSessionSnapshot }
export interface CodexSessionActivityProbe { running(sessionId: string): boolean | 'unknown' | Promise<boolean | 'unknown'> }
export interface CodexSessionCommandRunner {
  run(executable: string, args: readonly string[], cwd: string): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>
}

class SqliteCodexSessionReader implements CodexSessionReader {
  private readonly database: DatabaseSync
  constructor(path: string) { this.database = new DatabaseSync(resolve(path), { readOnly: true }) }
  inspect(sessionId: string): CodexSessionSnapshot {
    const row = this.database.prepare('SELECT archived, archived_at FROM threads WHERE id = ? LIMIT 1').get(sessionId) as
      { archived: number; archived_at: number | null } | undefined
    if (!row) return { exists: false, archived: false }
    return {
      exists: true, archived: row.archived === 1,
      ...(row.archived_at === null ? {} : { archivedAt: epoch(row.archived_at) }),
    }
  }
  close(): void { this.database.close() }
}

class ProcessCodexSessionRunner implements CodexSessionCommandRunner {
  async run(executable: string, args: readonly string[], cwd: string) {
    return await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolvePromise, reject) => {
      const child = execFile(executable, [...args], { cwd, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') { reject(error); return }
        resolvePromise({ exitCode: typeof error?.code === 'number' ? error.code : 0, stdout, stderr })
      })
      child.once('error', reject)
    })
  }
}

/**
 * Reads activity from the public Codex app-server protocol. Only an explicit
 * `idle` response is safe enough to authorize lifecycle mutations. A thread
 * absent from this app-server process is `notLoaded`, not necessarily idle.
 */
export class CodexAppServerActivityProbe implements CodexSessionActivityProbe {
  constructor(
    private readonly socket: string,
    private readonly executable = 'codex',
    private readonly timeoutMs = 5_000,
  ) {
    if (!socket.trim()) throw new Error('Codex app-server socket is required')
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
      throw new Error('Codex activity timeout must be between 100 and 30000 milliseconds')
    }
  }

  async running(sessionId: string): Promise<boolean | 'unknown'> {
    return await new Promise(resolvePromise => {
      const child = spawn(this.executable, ['app-server', 'proxy', '--sock', resolve(this.socket)], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const lines = createInterface({ input: child.stdout })
      let settled = false
      const finish = (result: boolean | 'unknown') => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        lines.close()
        child.kill()
        resolvePromise(result)
      }
      const send = (message: Readonly<Record<string, unknown>>) => {
        try {
          if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(message)}\n`)
        } catch { finish('unknown') }
      }
      const timer = setTimeout(() => finish('unknown'), this.timeoutMs)
      child.once('error', () => finish('unknown'))
      child.once('exit', () => finish('unknown'))
      child.stdin.once('error', () => finish('unknown'))
      lines.on('line', line => {
        let message: unknown
        try { message = JSON.parse(line) } catch { return }
        if (!isRecord(message)) return
        if (message.id === 1 && isRecord(message.result)) {
          send({ method: 'initialized' })
          send({ id: 2, method: 'thread/read', params: { threadId: sessionId, includeTurns: false } })
          return
        }
        if (message.id !== 2 || !isRecord(message.result)) return
        finish(codexThreadActivity(message.result))
      })
      send({
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'quarkselfai-session-lifecycle', version: '1.0.0' }, capabilities: {} },
      })
    })
  }
}

export class CodexSessionEffectAdapter {
  constructor(
    private readonly config: CodexSessionEffectConfig,
    private readonly reader: CodexSessionReader = new SqliteCodexSessionReader(config.stateDatabase),
    private readonly runner: CodexSessionCommandRunner = new ProcessCodexSessionRunner(),
    private readonly activity: CodexSessionActivityProbe = config.appServerSocket
      ? new CodexAppServerActivityProbe(config.appServerSocket, config.executable, config.activityTimeoutMs)
      : { running: () => 'unknown' },
  ) {
    if (!config.stateDatabase?.trim()) throw new Error('Codex session stateDatabase is required')
    if (!config.workspace?.trim()) throw new Error('Codex session workspace is required')
  }

  async execute(effect: ClaimedWorkflowEffect): Promise<Readonly<Record<string, unknown>>> {
    const sessionId = uuid(effect.payload.sessionId)
    if (effect.kind === SESSION_EFFECTS.inspect) {
      const state = this.reader.inspect(sessionId)
      return { ...state, running: await this.activity.running(sessionId) }
    }
    const effectiveAt = timestamp(effect.payload.effectiveAt, 'session effectiveAt')
    const authorization = requireAuthorizationEvidence(
      effect.payload.authorization, 'codex.auto-research-session-lifecycle', effectiveAt,
    )
    if (effect.payload.managedBy !== 'quarkselfai-auto-research') throw new Error('session is not owned by QuarkSelfAI auto research')
    if (await this.activity.running(sessionId) !== false) throw new Error('Codex session activity is not confirmed idle')
    if (effect.kind === SESSION_EFFECTS.archiveIfNeeded) return await this.archive(sessionId, effectiveAt, authorization.id)
    if (effect.kind === SESSION_EFFECTS.deleteIfArchived) return await this.delete(effect, sessionId, effectiveAt, authorization.id)
    throw new Error(`unsupported Codex session effect ${effect.kind}`)
  }

  close(): void { if (this.reader instanceof SqliteCodexSessionReader) this.reader.close() }

  private async archive(sessionId: string, effectiveAt: string, authorizationId: string) {
    const before = this.reader.inspect(sessionId)
    if (!before.exists) throw new Error(`Codex session ${sessionId} does not exist`)
    if (before.archived) return { archivedAt: before.archivedAt ?? effectiveAt, alreadyArchived: true, authorizationId }
    const output = await this.command(['archive', sessionId])
    const after = this.reader.inspect(sessionId)
    if (!after.exists || !after.archived) throw new Error(`Codex archive was not confirmed: ${detail(output)}`)
    return { archivedAt: after.archivedAt ?? effectiveAt, alreadyArchived: false, authorizationId }
  }

  private async delete(effect: ClaimedWorkflowEffect, sessionId: string, effectiveAt: string, authorizationId: string) {
    const archivedAt = timestamp(effect.payload.archivedAt, 'session archivedAt')
    const raw = object(effect.payload.authorization, 'session authorization')
    const minimumArchivedDays = integer(raw.minimumArchivedDays, 'authorization minimumArchivedDays')
    if (new Date(effectiveAt).getTime() - new Date(archivedAt).getTime() < minimumArchivedDays * DAY_MS) {
      throw new Error('session has not reached the authorized archive retention period')
    }
    const before = this.reader.inspect(sessionId)
    if (!before.exists) return { outcome: 'missing', authorizationId }
    if (!before.archived) return { outcome: 'not-archived', authorizationId }
    const output = await this.command(['delete', '--force', sessionId])
    if (!this.reader.inspect(sessionId).exists) return { outcome: 'deleted', authorizationId }
    throw new Error(`Codex deletion was not confirmed: ${detail(output)}`)
  }

  private async command(args: readonly string[]) {
    const output = await this.runner.run(this.config.executable ?? 'codex', args, resolve(this.config.workspace))
    if (output.exitCode !== 0) throw new Error(`codex exited ${output.exitCode}: ${detail(output)}`)
    return output
  }
}

export const name = 'quark-codex-session-effects'
export const inject = ['quarkWorkflows']
export function apply(ctx: Context, config: CodexSessionEffectConfig): void {
  const adapter = new CodexSessionEffectAdapter(config)
  const disposers = [SESSION_EFFECTS.inspect, SESSION_EFFECTS.archiveIfNeeded, SESSION_EFFECTS.deleteIfArchived]
    .map(kind => ctx.quarkWorkflows.registerEffect(kind, { execute: effect => adapter.execute(effect) }))
  ctx.effect(() => () => { for (const dispose of disposers.reverse()) dispose(); adapter.close() }, 'quark Codex session effects')
}

function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw new Error('sessionId must be an exact UUID'); return value }
function object(value: unknown, label: string): Readonly<Record<string, unknown>> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Readonly<Record<string, unknown>> }
function timestamp(value: unknown, label: string): string { if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) throw new Error(`${label} must be a timestamp`); return value }
function integer(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} must be a positive integer`); return Number(value) }
function detail(output: { readonly stdout: string; readonly stderr: string }): string { return (output.stderr || output.stdout || 'no output').trim().slice(-1_500) }
function epoch(value: number): string { return new Date(value > 10_000_000_000 ? value : value * 1_000).toISOString() }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
export function codexThreadActivity(result: unknown): boolean | 'unknown' {
  if (!isRecord(result)) return 'unknown'
  const thread = result.thread
  const status = isRecord(thread) ? thread.status : undefined
  const type = isRecord(status) ? status.type : undefined
  return type === 'active' ? true : type === 'idle' ? false : 'unknown'
}

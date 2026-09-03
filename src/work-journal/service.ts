import type { ManagedComponent } from '../platform/lifecycle.js'
import type { FeatureCheckpointStorePort, SignalStorePort } from '../storage/types.js'
import { DurableWakeScheduler } from '../runtime/wake-scheduler.js'
import { dailyWorkJournalRecord, WORK_JOURNAL_SIGNAL_KIND, workJournalSignal, type WorkJournalCompiler, type WorkJournalEvidenceProvider } from './contract.js'
import type { WorkJournalConfig } from './config.js'

const DAY_MS = 86_400_000
const checkpointNamespace = 'work-journal'
const checkpointKey = 'daily-close'

interface WorkJournalCheckpoint extends Record<string, unknown> {
  readonly lastClosedDay?: string
  readonly lastAttemptAt?: string
  readonly failure?: { readonly at: string; readonly lastAt: string; readonly attempts: number; readonly error: string; readonly nextAttemptAt: string }
}

function localParts(now: Date): Readonly<Record<string, string>> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]))
}

function localDay(now: Date): string {
  const value = localParts(now)
  return `${value.year}-${value.month}-${value.day}`
}

function shiftDay(day: string, amount: number): string {
  return new Date(new Date(`${day}T12:00:00Z`).getTime() + amount * DAY_MS).toISOString().slice(0, 10)
}

export function targetWorkJournalDay(checkpoint: WorkJournalCheckpoint, now: Date, closeHour: number): string | undefined {
  if (Number(localParts(now).hour) < closeHour) return undefined
  const latestClosed = shiftDay(localDay(now), -1)
  if (!checkpoint.lastClosedDay) return latestClosed
  const next = shiftDay(checkpoint.lastClosedDay, 1)
  return next <= latestClosed ? next : undefined
}

export class WorkJournalService {
  private controller: AbortController | undefined
  private readonly scheduler: DurableWakeScheduler<void>

  constructor(
    private readonly config: WorkJournalConfig,
    private readonly store: SignalStorePort & FeatureCheckpointStorePort,
    private readonly evidence: WorkJournalEvidenceProvider,
    private readonly compiler: WorkJournalCompiler,
    private readonly logger: Pick<Console, 'error'> = console,
  ) {
    this.scheduler = new DurableWakeScheduler({
      enabled: config.enabled,
      recoveryIntervalMs: config.pollIntervalMs,
      run: async () => await this.poll(),
      continueAfter: () => false,
      onError: error => this.logger.error('work journal scheduler failed', error),
    })
  }

  component(): ManagedComponent {
    return {
      id: 'work-journal', kind: 'feature',
      start: async () => { this.scheduler.wake() },
      stop: async () => {
        this.scheduler.dispose()
        this.controller?.abort()
      },
    }
  }

  async poll(now = new Date()): Promise<void> {
    const checkpoint = (await this.store.readFeatureCheckpoint(checkpointNamespace, checkpointKey) ?? {}) as WorkJournalCheckpoint
    if (checkpoint.failure?.nextAttemptAt && checkpoint.failure.nextAttemptAt > now.toISOString()) return
    const day = targetWorkJournalDay(checkpoint, now, this.config.closeHour)
    if (!day) return
    const alreadyStored = (await this.store.recentSignals(WORK_JOURNAL_SIGNAL_KIND, 3_660))
      .some(signal => signal.data.day === day)
    if (alreadyStored) {
      await this.store.writeFeatureCheckpoint(checkpointNamespace, checkpointKey, {
        lastClosedDay: day, lastAttemptAt: now.toISOString(), failure: null,
      })
      return
    }
    const attempted = { ...checkpoint, lastAttemptAt: now.toISOString() }
    await this.store.writeFeatureCheckpoint(checkpointNamespace, checkpointKey, attempted)
    this.controller = new AbortController()
    try {
      const evidence = await this.evidence.load(day, this.controller.signal)
      const record = dailyWorkJournalRecord(await this.compiler.compile(day, evidence, this.controller.signal))
      if (record.day !== day) throw new Error(`compiled work journal day ${record.day} does not match ${day}`)
      await this.store.appendSignal(workJournalSignal(record))
      await this.store.writeFeatureCheckpoint(checkpointNamespace, checkpointKey, {
        lastClosedDay: day, lastAttemptAt: now.toISOString(), failure: null,
      })
    } catch (error) {
      if (this.controller.signal.aborted) return
      const previous = checkpoint.failure
      const attempts = (previous?.attempts ?? 0) + 1
      await this.store.writeFeatureCheckpoint(checkpointNamespace, checkpointKey, {
        ...attempted,
        failure: {
          at: previous?.at ?? now.toISOString(), lastAt: now.toISOString(), attempts,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
          nextAttemptAt: new Date(now.getTime() + Math.min(6 * 3_600_000, attempts * 30 * 60_000)).toISOString(),
        },
      })
      this.logger.error('work journal close failed; retained for retry', error)
    } finally {
      this.controller = undefined
    }
  }
}

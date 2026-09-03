import type { DurableSignal } from '../storage/types.js'

export const WORK_JOURNAL_SIGNAL_KIND = 'assistant.work-journal.daily.v1'

export interface DailyWorkJournalRecord extends Record<string, unknown> {
  readonly version: 1
  readonly day: string
  readonly headline: string
  readonly highlights: readonly Readonly<Record<string, unknown>>[]
  readonly decisions: readonly string[]
  readonly deliverables: readonly string[]
  readonly collaboration: readonly string[]
  readonly nextSteps: readonly string[]
  readonly sources: readonly Readonly<Record<string, unknown>>[]
  readonly gaps: readonly string[]
}

const highlightStatuses = new Set(['completed', 'progressed', 'blocked', 'decision', 'observed'])
const confidenceLevels = new Set(['high', 'medium', 'low'])
const sourceKinds = new Set(['feishu', 'calendar', 'dida', 'codex', 'claude', 'dsh', 'jira', 'gitlab', 'local-git'])
const sourceStatuses = new Set(['available', 'partial', 'unavailable', 'not-configured'])

function compactText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, maximum) : ''
}

function textList(value: unknown, limit = 20, maximum = 500): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => compactText(item, maximum)).filter(Boolean).slice(0, limit)
}

function highlights(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const input = item as Record<string, unknown>
    const title = compactText(input.title, 200)
    if (!title) return []
    const status = compactText(input.status, 32)
    const confidence = compactText(input.confidence, 16)
    return [{
      title,
      summary: compactText(input.summary, 1_000),
      status: highlightStatuses.has(status) ? status : 'observed',
      outcomes: textList(input.outcomes, 12, 500),
      sourceRefs: textList(input.sourceRefs, 12, 500),
      confidence: confidenceLevels.has(confidence) ? confidence : 'low',
    }]
  })
}

function sources(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const input = item as Record<string, unknown>
    const kind = compactText(input.kind, 32)
    const status = compactText(input.status, 32)
    if (!sourceKinds.has(kind)) return []
    return [{
      kind,
      status: sourceStatuses.has(status) ? status : 'partial',
      evidenceCount: Math.max(0, Math.min(10_000, Number.isFinite(Number(input.evidenceCount)) ? Math.floor(Number(input.evidenceCount)) : 0)),
      note: compactText(input.note, 500),
    }]
  })
}

export interface WorkJournalEvidenceProvider {
  load(day: string): Promise<Readonly<Record<string, unknown>>>
}

export interface WorkJournalCompiler {
  compile(day: string, evidence: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<DailyWorkJournalRecord>
}

const dayPattern = /^\d{4}-\d{2}-\d{2}$/u

export function workJournalDay(value: unknown, name = 'day'): string {
  if (typeof value !== 'string' || !dayPattern.test(value) || Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())) {
    throw new Error(`${name} must be a calendar date in YYYY-MM-DD format`)
  }
  return value
}

export function dailyWorkJournalRecord(value: unknown): DailyWorkJournalRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('record must be an object')
  const record = value as Record<string, unknown>
  const day = workJournalDay(record.day)
  if (record.version !== 1 || typeof record.headline !== 'string' || record.headline.trim().length === 0) {
    throw new Error('record version and headline are required')
  }
  for (const field of ['highlights', 'decisions', 'deliverables', 'collaboration', 'nextSteps', 'sources', 'gaps']) {
    if (!Array.isArray(record[field])) throw new Error(`record.${field} must be an array`)
  }
  const normalized: DailyWorkJournalRecord = {
    version: 1,
    day,
    headline: compactText(record.headline, 300),
    highlights: highlights(record.highlights),
    decisions: textList(record.decisions),
    deliverables: textList(record.deliverables),
    collaboration: textList(record.collaboration),
    nextSteps: textList(record.nextSteps),
    sources: sources(record.sources),
    gaps: textList(record.gaps),
  }
  const encoded = JSON.stringify(normalized)
  if (Buffer.byteLength(encoded, 'utf8') > 128 * 1024) throw new Error('record exceeds the 128 KiB limit')
  return normalized
}

export function workJournalSignal(record: DailyWorkJournalRecord): {
  readonly id: string
  readonly kind: string
  readonly occurredAt: string
  readonly scope: Readonly<Record<string, unknown>>
  readonly data: DailyWorkJournalRecord
} {
  return {
    id: `work-journal:daily:${record.day}`,
    kind: WORK_JOURNAL_SIGNAL_KIND,
    occurredAt: `${record.day}T23:59:59.999+08:00`,
    scope: { day: record.day, owner: 'changdongxu' },
    data: record,
  }
}

export function queryWorkJournal(signals: readonly DurableSignal[], from: string, to: string): readonly DailyWorkJournalRecord[] {
  workJournalDay(from, 'from')
  workJournalDay(to, 'to')
  if (from > to) throw new Error('from must not be later than to')
  return signals
    .map(signal => dailyWorkJournalRecord(signal.data))
    .filter(record => record.day >= from && record.day <= to)
    .sort((left, right) => left.day.localeCompare(right.day))
}

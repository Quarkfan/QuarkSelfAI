import type { ControlReadStorePort } from '../storage/types.js'
import { dailyWorkJournalRecord, type WorkJournalCompiler, type WorkJournalEvidenceProvider } from './contract.js'

function insideDay(timestamp: string | null, day: string): boolean {
  if (!timestamp) return false
  const instant = new Date(timestamp)
  if (Number.isNaN(instant.getTime())) return false
  const rendered = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant)
  return rendered === day
}

/** Native bounded evidence. External Jira/GitLab/Feishu lookups remain the compiler's read-only responsibility. */
export class NativeStoreWorkEvidenceProvider implements WorkJournalEvidenceProvider {
  constructor(private readonly store: ControlReadStorePort) {}

  async load(day: string): Promise<Readonly<Record<string, unknown>>> {
    const [events, matters, actions] = await Promise.all([
      this.store.recentEvents(500), this.store.recentMatters(500), this.store.recentActions(500),
    ])
    return {
      day,
      events: events.filter(event => insideDay(event.occurredAt ?? event.receivedAt, day)).slice(0, 200),
      matters: matters.filter(matter => insideDay(matter.updatedAt, day)).slice(0, 100),
      actions: actions.filter(action => insideDay(action.updatedAt, day)).slice(0, 100),
      note: 'Bounded native ledger snapshot; the compiler independently verifies external read-only sources.',
    }
  }
}

/** Portable baseline compiler. Private packs may replace it through the same port. */
export class NativeStoreWorkJournalCompiler implements WorkJournalCompiler {
  async compile(day: string, evidence: Readonly<Record<string, unknown>>) {
    const events = list(evidence.events)
    const matters = list(evidence.matters)
    const actions = list(evidence.actions)
    const highlights = matters.slice(0, 20).map((value, index) => {
      const item = record(value)
      return {
        title: bounded(item?.title, `Matter ${index + 1}`, 160),
        summary: bounded(item?.latestSummary, 'Native durable matter activity.', 1_000),
        status: 'observed' as const,
        outcomes: [],
        sourceRefs: typeof item?.id === 'string' ? [item.id] : [],
        confidence: 'medium' as const,
      }
    })
    return dailyWorkJournalRecord({
      version: 1, day,
      headline: highlights.length ? `Recorded ${highlights.length} bounded native work matters.` : 'No bounded native work matter was recorded.',
      highlights, decisions: [], deliverables: [], collaboration: [], nextSteps: [],
      sources: [{ kind: 'local-git', status: 'partial', evidenceCount: events.length + matters.length + actions.length,
        note: 'Portable baseline uses only the local durable assistant ledger; optional integration packs may add independently authorized sources.' }],
      gaps: ['External work sources are not part of the generic product composition.'],
    })
  }
}

function list(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : [] }
function record(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function bounded(value: unknown, fallback: string, max: number): string {
  const text = typeof value === 'string' && value.trim() ? value.trim() : fallback
  return text.slice(0, max)
}

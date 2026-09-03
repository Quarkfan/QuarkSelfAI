import type { ControlReadStorePort } from '../storage/types.js'
import type { WorkJournalEvidenceProvider } from './contract.js'

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

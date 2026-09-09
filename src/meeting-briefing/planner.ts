import { createHash } from 'node:crypto'

export type MeetingBriefingSourceKind = 'calendar' | 'feishu' | 'dida' | 'work-journal' | 'linked-document' | 'assistant-knowledge'

export interface MeetingBriefingSourceSnapshot {
  readonly kind: MeetingBriefingSourceKind
  readonly status: 'available' | 'partial' | 'unavailable'
  readonly itemCount: number
}

export interface MeetingBriefingCandidateInput {
  readonly mode: 'inactive-shadow'
  readonly now: string
  readonly eventId: string
  readonly eventRevision: string
  readonly startsAt: string
  readonly attendance: 'organizer' | 'accepted' | 'tentative' | 'declined'
  readonly directResponsibility: boolean
  readonly sources: readonly MeetingBriefingSourceSnapshot[]
}

export interface MeetingBriefingShadowPlan {
  readonly outcome: 'skip' | 'shadow-draft'
  readonly reasons: readonly string[]
  readonly idempotencyKey?: string
  readonly briefDueAt?: string
  readonly sourceSummary: readonly MeetingBriefingSourceSnapshot[]
  readonly boundary: {
    readonly runtimeActive: false
    readonly sourceReadsExecuted: false
    readonly rawContentStored: false
    readonly externalEffectsEnabled: false
    readonly ownerNotificationAllowed: false
  }
}

const sourceKinds = new Set<MeetingBriefingSourceKind>(['calendar', 'feishu', 'dida', 'work-journal', 'linked-document', 'assistant-knowledge'])
const expectedInputKeys = ['attendance', 'directResponsibility', 'eventId', 'eventRevision', 'mode', 'now', 'sources', 'startsAt']
const expectedSourceKeys = ['itemCount', 'kind', 'status']

function exactKeys(value: object, expected: readonly string[], name: string): void {
  if (Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) throw new Error(`${name} contains unsupported fields`)
}

function boundedText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 || /[\r\n]/.test(value)) throw new Error(`${name} is invalid`)
  return value
}

function timestamp(value: unknown, name: string): number {
  const parsed = Date.parse(boundedText(value, name))
  if (Number.isNaN(parsed)) throw new Error(`${name} is invalid`)
  return parsed
}

function sourceSnapshot(value: unknown): MeetingBriefingSourceSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('source snapshot is invalid')
  exactKeys(value, expectedSourceKeys, 'source snapshot')
  const item = value as Record<string, unknown>
  if (!sourceKinds.has(item.kind as MeetingBriefingSourceKind)) throw new Error('source kind is invalid')
  if (!['available', 'partial', 'unavailable'].includes(String(item.status))) throw new Error('source status is invalid')
  if (!Number.isSafeInteger(item.itemCount) || Number(item.itemCount) < 0) throw new Error('source item count is invalid')
  return Object.freeze({ kind: item.kind as MeetingBriefingSourceKind, status: item.status as MeetingBriefingSourceSnapshot['status'], itemCount: Math.min(Number(item.itemCount), 20) })
}

function boundary(): MeetingBriefingShadowPlan['boundary'] {
  return Object.freeze({ runtimeActive: false, sourceReadsExecuted: false, rawContentStored: false, externalEffectsEnabled: false, ownerNotificationAllowed: false })
}

/**
 * Privacy-bounded planning seam for the proposed pre-meeting briefing pilot.
 *
 * It consumes metadata/counts only and cannot read sources, generate a brief,
 * schedule work, notify the owner, or activate itself.
 */
export function planInactiveMeetingBriefing(value: unknown): MeetingBriefingShadowPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('meeting briefing input is invalid')
  exactKeys(value, expectedInputKeys, 'meeting briefing input')
  const input = value as Record<string, unknown>
  if (input.mode !== 'inactive-shadow') throw new Error('meeting briefing planner must remain inactive-shadow')
  const now = timestamp(input.now, 'now')
  const startsAt = timestamp(input.startsAt, 'startsAt')
  const eventId = boundedText(input.eventId, 'eventId')
  const eventRevision = boundedText(input.eventRevision, 'eventRevision')
  if (!['organizer', 'accepted', 'tentative', 'declined'].includes(String(input.attendance))) throw new Error('attendance is invalid')
  if (typeof input.directResponsibility !== 'boolean') throw new Error('directResponsibility is invalid')
  if (!Array.isArray(input.sources) || input.sources.length > 6) throw new Error('sources are invalid')
  const sources = input.sources.map(sourceSnapshot)
  if (new Set(sources.map(source => source.kind)).size !== sources.length) throw new Error('sources contain duplicate kinds')

  const reasons: string[] = []
  const leadMs = startsAt - now
  if (input.attendance === 'declined') reasons.push('meeting-declined')
  if (input.attendance !== 'organizer' && input.directResponsibility !== true) reasons.push('no-direct-responsibility')
  if (leadMs < 15 * 60_000 || leadMs > 24 * 60 * 60_000) reasons.push('outside-15-minute-to-24-hour-window')
  const calendar = sources.find(source => source.kind === 'calendar')
  const context = sources.filter(source => source.kind !== 'calendar' && source.status !== 'unavailable' && source.itemCount > 0)
  if (!calendar || calendar.status === 'unavailable' || calendar.itemCount < 1 || context.length === 0) reasons.push('insufficient-bounded-context')

  if (reasons.length > 0) return Object.freeze({ outcome: 'skip', reasons, sourceSummary: sources, boundary: boundary() })
  const digest = createHash('sha256').update(`${eventId}\0${eventRevision}`).digest('hex')
  const briefDueAt = new Date(Math.max(now, startsAt - 60 * 60_000)).toISOString()
  return Object.freeze({
    outcome: 'shadow-draft',
    reasons: ['eligible-for-inactive-shadow-evaluation'],
    idempotencyKey: `meeting-briefing.v1.${digest}`,
    briefDueAt,
    sourceSummary: sources,
    boundary: boundary(),
  })
}

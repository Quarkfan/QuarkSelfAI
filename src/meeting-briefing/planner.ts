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

export interface MeetingBriefingPilotEvidence {
  readonly mode: 'inactive-shadow-evaluation'
  readonly workingDaysElapsed: number
  readonly eligibleMeetings: number
  readonly draftsCreated: number
  readonly reviewedDrafts: number
  readonly materiallyUsefulDrafts: number
  readonly lowValueOrMisleadingDrafts: number
  readonly violations: {
    readonly privacy: number
    readonly sourceScope: number
    readonly deduplication: number
    readonly externalEffect: number
  }
}

export interface MeetingBriefingPilotDecision {
  readonly outcome: 'continue' | 'pass' | 'fail'
  readonly reasons: readonly string[]
  readonly counters: {
    readonly workingDaysElapsed: number
    readonly eligibleMeetings: number
    readonly draftsCreated: number
    readonly reviewedDrafts: number
  }
  readonly rates: {
    readonly draftCoverage?: number
    readonly materiallyUseful?: number
    readonly lowValueOrMisleading?: number
  }
  readonly boundary: {
    readonly rawContentAccepted: false
    readonly sourceReadsExecuted: false
    readonly externalEffectsEnabled: false
  }
}

const sourceKinds = new Set<MeetingBriefingSourceKind>(['calendar', 'feishu', 'dida', 'work-journal', 'linked-document', 'assistant-knowledge'])
const expectedInputKeys = ['attendance', 'directResponsibility', 'eventId', 'eventRevision', 'mode', 'now', 'sources', 'startsAt']
const expectedSourceKeys = ['itemCount', 'kind', 'status']
const expectedPilotEvidenceKeys = ['draftsCreated', 'eligibleMeetings', 'lowValueOrMisleadingDrafts', 'materiallyUsefulDrafts', 'mode', 'reviewedDrafts', 'violations', 'workingDaysElapsed']
const expectedViolationKeys = ['deduplication', 'externalEffect', 'privacy', 'sourceScope']

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

function boundedCount(value: unknown, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) throw new Error(`${name} is invalid`)
  return Number(value)
}

function evaluationBoundary(): MeetingBriefingPilotDecision['boundary'] {
  return Object.freeze({ rawContentAccepted: false, sourceReadsExecuted: false, externalEffectsEnabled: false })
}

function rate(numerator: number, denominator: number): number | undefined {
  return denominator === 0 ? undefined : numerator / denominator
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

/**
 * Deterministic exit gate for the proposed shadow pilot.
 *
 * It accepts bounded counters only. It cannot read a meeting, review draft
 * content, activate the pilot, or perform an external effect.
 */
export function evaluateInactiveMeetingBriefingPilot(value: unknown): MeetingBriefingPilotDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('meeting briefing pilot evidence is invalid')
  exactKeys(value, expectedPilotEvidenceKeys, 'meeting briefing pilot evidence')
  const input = value as Record<string, unknown>
  if (input.mode !== 'inactive-shadow-evaluation') throw new Error('meeting briefing pilot evaluation must remain inactive-shadow')
  const workingDaysElapsed = boundedCount(input.workingDaysElapsed, 'working days elapsed', 10)
  const eligibleMeetings = boundedCount(input.eligibleMeetings, 'eligible meetings', 100)
  const draftsCreated = boundedCount(input.draftsCreated, 'drafts created', eligibleMeetings)
  const reviewedDrafts = boundedCount(input.reviewedDrafts, 'reviewed drafts', draftsCreated)
  const materiallyUsefulDrafts = boundedCount(input.materiallyUsefulDrafts, 'materially useful drafts', reviewedDrafts)
  const lowValueOrMisleadingDrafts = boundedCount(input.lowValueOrMisleadingDrafts, 'low value or misleading drafts', reviewedDrafts)
  if (materiallyUsefulDrafts + lowValueOrMisleadingDrafts > reviewedDrafts) throw new Error('review classifications overlap')
  if (!input.violations || typeof input.violations !== 'object' || Array.isArray(input.violations)) throw new Error('meeting briefing pilot violations are invalid')
  exactKeys(input.violations, expectedViolationKeys, 'meeting briefing pilot violations')
  const violationInput = input.violations as Record<string, unknown>
  const violations = expectedViolationKeys.reduce((total, key) => total + boundedCount(violationInput[key], `${key} violations`, 100), 0)

  const draftCoverage = rate(draftsCreated, eligibleMeetings)
  const materiallyUseful = rate(materiallyUsefulDrafts, reviewedDrafts)
  const lowValueOrMisleading = rate(lowValueOrMisleadingDrafts, reviewedDrafts)
  const counters = Object.freeze({ workingDaysElapsed, eligibleMeetings, draftsCreated, reviewedDrafts })
  const rates = Object.freeze({
    ...(draftCoverage === undefined ? {} : { draftCoverage }),
    ...(materiallyUseful === undefined ? {} : { materiallyUseful }),
    ...(lowValueOrMisleading === undefined ? {} : { lowValueOrMisleading }),
  })
  const decision = (outcome: MeetingBriefingPilotDecision['outcome'], reasons: readonly string[]): MeetingBriefingPilotDecision => Object.freeze({
    outcome,
    reasons: Object.freeze([...reasons]),
    counters,
    rates,
    boundary: evaluationBoundary(),
  })

  if (violations > 0) return decision('fail', ['safety-boundary-violation'])
  if (lowValueOrMisleading !== undefined && lowValueOrMisleading > 0.3) return decision('fail', ['low-value-or-misleading-rate-above-30-percent'])
  const evaluationComplete = eligibleMeetings >= 8 || workingDaysElapsed >= 10
  if (!evaluationComplete) return decision('continue', ['awaiting-8-eligible-meetings-or-10-working-days'])
  if (workingDaysElapsed >= 10 && eligibleMeetings < 8) return decision('fail', ['insufficient-eligible-meetings-within-10-working-days'])
  const reasons: string[] = []
  if (draftCoverage === undefined || draftCoverage < 0.8) reasons.push('draft-coverage-below-80-percent')
  if (materiallyUseful === undefined || materiallyUseful < 0.7) reasons.push('materially-useful-review-rate-below-70-percent')
  return reasons.length === 0 ? decision('pass', ['shadow-pilot-thresholds-met']) : decision('fail', reasons)
}

import type { WorkflowDecision, WorkflowDefinition, WorkflowEvent } from '../workflow/runtime.js'
import { INTAKE_EFFECTS, type FocusDiscoverySources } from './types.js'

const MINIMUM_INTERVAL_MS = 10 * 60_000
const DEFAULT_OVERLAP_MS = 2 * 60_000

type DiscoveryState = Readonly<Record<string, unknown>> & {
  readonly stage: 'scheduled' | 'discovering'
  readonly intervalMs: number
  readonly overlapMs: number
  readonly retryMs: number
  readonly sequence: number
  readonly sources: FocusDiscoverySources
  readonly lastSuccessfulAt?: string
  readonly windowEnd?: string
  readonly consecutiveFailures: number
}

export const FOCUS_DISCOVERY_WORKFLOW_KIND = 'focus-discovery.v1'
export const FOCUS_DISCOVERY_WORKFLOW_ID = 'focus-discovery:singleton'

export function focusDiscoveryWorkflow(): WorkflowDefinition {
  return {
    kind: FOCUS_DISCOVERY_WORKFLOW_KIND,
    version: 1,
    initialize(input, now) {
      const intervalMs = integer(input.intervalMs, 'focus discovery intervalMs', MINIMUM_INTERVAL_MS)
      const overlapMs = integer(input.overlapMs ?? DEFAULT_OVERLAP_MS, 'focus discovery overlapMs', 0)
      if (overlapMs >= intervalMs) throw new Error('focus discovery overlapMs must be less than intervalMs')
      const retryMs = integer(input.retryMs ?? intervalMs, 'focus discovery retryMs', MINIMUM_INTERVAL_MS)
      const sources = validateSources(input.sources)
      return {
        status: 'waiting',
        wakeAt: now,
        state: { stage: 'scheduled', intervalMs, overlapMs, retryMs, sequence: 0, sources, consecutiveFailures: 0 },
      }
    },
    reduce(raw, event) {
      const state = raw as DiscoveryState
      if (state.stage === 'scheduled' && event.type === 'timer') return startDiscovery(state, event)
      if (state.stage === 'discovering' && event.type === 'effect.delivered') return scheduleNext(state, event)
      if (state.stage === 'discovering' && event.type === 'effect.failed') return retryLater(state, event)
      return { status: 'waiting', state }
    },
  }
}

function startDiscovery(state: DiscoveryState, event: WorkflowEvent): WorkflowDecision {
  const until = validTime(event.occurredAt, 'focus discovery timer occurredAt')
  const last = state.lastSuccessfulAt ? new Date(state.lastSuccessfulAt) : new Date(until.getTime() - state.intervalMs)
  const from = new Date(last.getTime() - state.overlapMs)
  const sequence = state.sequence + 1
  return {
    status: 'waiting',
    wakeAt: null,
    state: { ...state, stage: 'discovering', sequence, windowEnd: until.toISOString() },
    effects: [{
      id: `focus-discovery:${sequence}`,
      kind: INTAKE_EFFECTS.discoverSignals,
      payload: { from: from.toISOString(), until: until.toISOString(), sources: state.sources },
    }],
  }
}

function scheduleNext(state: DiscoveryState, event: WorkflowEvent): WorkflowDecision {
  if (event.payload.effectKind !== INTAKE_EFFECTS.discoverSignals) return { status: 'waiting', state }
  const completedAt = validTime(event.occurredAt, 'focus discovery completion time')
  const lastSuccessfulAt = validTime(state.windowEnd, 'focus discovery window end').toISOString()
  return {
    status: 'waiting',
    wakeAt: new Date(completedAt.getTime() + state.intervalMs).toISOString(),
    state: { ...state, stage: 'scheduled', lastSuccessfulAt, consecutiveFailures: 0 },
  }
}

function retryLater(state: DiscoveryState, event: WorkflowEvent): WorkflowDecision {
  if (event.payload.effectKind !== INTAKE_EFFECTS.discoverSignals) return { status: 'waiting', state }
  const failedAt = validTime(event.occurredAt, 'focus discovery failure time')
  return {
    status: 'waiting',
    wakeAt: new Date(failedAt.getTime() + state.retryMs).toISOString(),
    state: { ...state, stage: 'scheduled', consecutiveFailures: state.consecutiveFailures + 1 },
  }
}

function validateSources(value: unknown): FocusDiscoverySources {
  if (!record(value)) throw new Error('focus discovery sources are required')
  const ownerOpenId = text(value.ownerOpenId, 'focus discovery ownerOpenId', 300)
  return {
    ownerOpenId,
    senderIds: strings(value.senderIds, 'focus discovery senderIds', 300),
    conversationIds: strings(value.conversationIds, 'focus discovery conversationIds', 300),
    includeOwnerParticipation: value.includeOwnerParticipation !== false,
    includeFlaggedConversations: value.includeFlaggedConversations !== false,
    includeDirectMessages: value.includeDirectMessages !== false,
    includeMentionBackfill: value.includeMentionBackfill !== false,
    feedGroupNames: strings(value.feedGroupNames ?? ['特别关注'], 'focus discovery feedGroupNames', 100),
  }
}

function integer(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new Error(`${label} must be an integer >= ${minimum}`)
  return Number(value)
}
function validTime(value: unknown, label: string): Date {
  const parsed = new Date(String(value ?? ''))
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a timestamp`)
  return parsed
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  if (value.length > max) throw new Error(`${label} exceeds ${max} characters`)
  return value.trim()
}
function strings(value: unknown, label: string, max: number): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim() || item.length > max)) throw new Error(`${label} must be a string array`)
  return [...new Set(value.map(item => String(item).trim()))]
}
function record(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

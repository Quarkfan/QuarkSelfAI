import { createHash } from 'node:crypto'
import type { WorkflowDecision, WorkflowDefinition, WorkflowEvent } from '../workflow/contracts.js'
import { ASSISTANT_EFFECTS } from '../workflow/effects.js'
import { TASK_PROJECTION_EFFECTS } from '../task-system/projection-effects.js'
import type { TaskProjectionTarget } from '../task-system/projection-effects.js'
import { CONVERSATION_EFFECTS } from '../conversation/types.js'
import { LARK_EFFECTS } from '../lark/effects.js'
import { INTAKE_EFFECTS, type IntakeDecision, type IntakeInput, validateIntakeDecision } from './types.js'

type IntakeState = Readonly<Record<string, unknown>> & {
  readonly stage: 'loading-context' | 'evaluating' | 'projecting' | 'awaiting-approval' | 'reporting' | 'completed' | 'failed'
  readonly route: IntakeInput['route']
  readonly sourceEvent: IntakeInput['event']
  readonly workspace: string
  readonly pending: readonly string[]
  readonly decision?: IntakeDecision
  readonly approvalId?: string
  readonly taskProjection?: TaskProjectionTarget
}

export const INTAKE_WORKFLOW_KIND = 'message-intake.v1'

export function messageIntakeWorkflow(): WorkflowDefinition {
  return {
    kind: INTAKE_WORKFLOW_KIND,
    version: 1,
    initialize(input, now) {
      const value = input as unknown as IntakeInput
      if (!value.workspace?.trim() || !value.event?.deduplicationKey || !['owner-command', 'focus', 'interaction'].includes(value.route)) throw new Error('invalid message intake input')
      if (value.route === 'interaction') {
        const effectId = effect(value.event, 'interaction')
        return {
          status: 'waiting',
          state: { stage: 'projecting', route: value.route, sourceEvent: value.event, workspace: value.workspace, pending: [effectId], ...(value.taskProjection ? { taskProjection: value.taskProjection } : {}) },
          effects: [{ id: effectId, kind: INTAKE_EFFECTS.applyInteraction, payload: { event: value.event, requireExactOwnerAndCorrelation: true } }],
        }
      }
      const effectId = effect(value.event, 'context')
      return {
        status: 'waiting',
        state: { stage: 'loading-context', route: value.route, sourceEvent: value.event, workspace: value.workspace, pending: [effectId], ...(value.taskProjection ? { taskProjection: value.taskProjection } : {}) },
        effects: [{ id: effectId, kind: LARK_EFFECTS.loadMessageContext, payload: { event: value.event, route: value.route, requestedAt: now } }],
      }
    },
    reduce(raw, event) {
      const state = raw as IntakeState
      if (event.type === 'effect.failed') return { status: 'failed', state: { ...state, stage: 'failed', failure: event.payload.error }, wakeAt: null }
      if (state.stage === 'awaiting-approval' && event.type === 'approval.response') return recordApprovalResponse(state, event)
      if (state.stage === 'awaiting-approval' && (event.type === 'approval.approved' || event.type === 'approval.declined')) return finishApproval(state, event)
      if (event.type !== 'effect.delivered') return { status: state.stage === 'completed' ? 'completed' : 'waiting', state }
      const effectKind = String(event.payload.effectKind ?? '')
      if (state.stage === 'loading-context' && effectKind === LARK_EFFECTS.loadMessageContext) return afterContext(state, event)
      if (state.stage === 'evaluating' && effectKind === INTAKE_EFFECTS.evaluateFocus) return afterEvaluation(state, event)
      if (state.stage === 'projecting' && state.route === 'owner-command' && effectKind === CONVERSATION_EFFECTS.dispatch) return afterDelegation(state, event)
      if (state.stage === 'projecting' || state.stage === 'reporting') return settleProjection(state, event)
      return { status: state.stage === 'completed' ? 'completed' : 'waiting', state }
    },
  }
}

function afterContext(state: IntakeState, event: WorkflowEvent): WorkflowDecision {
  const context = event.payload.context
  const effectId = effect(state.sourceEvent, state.route === 'owner-command' ? 'delegate' : 'evaluate')
  if (state.route === 'owner-command') {
    return {
      status: 'waiting', state: { ...state, stage: 'projecting', pending: [effectId] },
      effects: [{ id: effectId, kind: CONVERSATION_EFFECTS.dispatch, payload: { event: state.sourceEvent, context, workspace: state.workspace } }],
    }
  }
  return {
    status: 'waiting', state: { ...state, stage: 'evaluating', pending: [effectId] },
    effects: [{ id: effectId, kind: INTAKE_EFFECTS.evaluateFocus, payload: { event: state.sourceEvent, context } }],
  }
}

function afterDelegation(state: IntakeState, event: WorkflowEvent): WorkflowDecision {
  const sessionId = requiredText(event.payload.sessionId, 'delegated sessionId', 300)
  const summary = requiredText(event.payload.summary, 'delegated summary', 30_000)
  const effectId = effect(state.sourceEvent, 'delegation-result')
  return {
    status: 'waiting',
    state: { ...state, stage: 'reporting', pending: [effectId], delegatedSessionId: sessionId },
    effects: [{
      id: effectId,
      kind: ASSISTANT_EFFECTS.notifyOwner,
      payload: {
        title: '飞书要求已处理',
        body: `${summary}\n\nDSH 会话：${sessionId}`,
        idempotencyKey: `conversation-result:${state.sourceEvent.deduplicationKey}`,
      },
    }],
  }
}

function afterEvaluation(state: IntakeState, event: WorkflowEvent): WorkflowDecision {
  const decision = validateIntakeDecision(event.payload.decision)
  if (decision.outcome === 'ignored') return { status: 'completed', state: { ...state, stage: 'completed', pending: [], decision }, wakeAt: null }
  const effects = []
  if (decision.outcome === 'task') {
    if (!state.taskProjection) throw new Error('task intake requires projection target and authorization')
    effects.push({
      id: effect(state.sourceEvent, 'task'), kind: TASK_PROJECTION_EFFECTS.upsertIntake,
      payload: { sourceEvent: state.sourceEvent, decision, ...state.taskProjection, effectiveAt: event.occurredAt, idempotencyKey: `feishu:${state.sourceEvent.source.messageId ?? state.sourceEvent.deduplicationKey}` },
    })
  }
  const approvalId = decision.approvalRequired ? effect(state.sourceEvent, 'approval-decision') : undefined
  if (decision.notifyOwner) effects.push({
    id: effect(state.sourceEvent, decision.approvalRequired ? 'approval-card' : 'notification'),
    kind: decision.approvalRequired ? ASSISTANT_EFFECTS.requestInteraction : ASSISTANT_EFFECTS.notifyOwner,
    payload: { sourceEvent: state.sourceEvent, decision, ...(approvalId ? { mode: 'approval', approvalId } : {}), requireExactCorrelation: true, targetOwnerOnly: true },
  })
  if (effects.length === 0) return { status: 'completed', state: { ...state, stage: 'completed', pending: [], decision }, wakeAt: null }
  return { status: 'waiting', state: { ...state, stage: 'projecting', pending: effects.map(item => item.id), decision, ...(approvalId ? { approvalId } : {}) }, effects }
}

function settleProjection(state: IntakeState, event: WorkflowEvent): WorkflowDecision {
  const effectId = String(event.payload.effectId ?? '')
  const pending = state.pending.filter(id => id !== effectId)
  const settledStage = pending.length === 0 ? (state.approvalId ? 'awaiting-approval' : 'completed') : 'projecting'
  return { status: settledStage === 'completed' ? 'completed' : 'waiting', state: { ...state, stage: settledStage, pending }, ...(pending.length === 0 ? { wakeAt: null } : {}) }
}

function recordApprovalResponse(state: IntakeState, event: WorkflowEvent): WorkflowDecision {
  requireApproval(state, event)
  const response = requiredText(event.payload.response, 'approval response', 1_000)
  return { status: 'waiting', state: { ...state, approvalResponse: response, approvalResponseAt: event.occurredAt } }
}

function finishApproval(state: IntakeState, event: WorkflowEvent): WorkflowDecision {
  requireApproval(state, event)
  return {
    status: 'completed', wakeAt: null,
    state: { ...state, stage: 'completed', approvalDecision: event.type === 'approval.approved' ? 'approved' : 'declined', approvalDecidedAt: event.occurredAt },
  }
}

function requireApproval(state: IntakeState, event: WorkflowEvent): void {
  if (!state.approvalId || event.payload.approvalId !== state.approvalId) throw new Error('intake approval correlation mismatch')
}

function effect(event: IntakeInput['event'], suffix: string): string {
  return `intake:${createHash('sha256').update(event.deduplicationKey).digest('hex').slice(0, 24)}:${suffix}`
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  if (value.length > max) throw new Error(`${label} exceeds ${max} characters`)
  return value
}

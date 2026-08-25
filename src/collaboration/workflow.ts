import { createHash } from 'node:crypto'
import { ASSISTANT_EFFECTS } from '../workflow/effects.js'
import type { WorkflowDecision, WorkflowDefinition, WorkflowEvent } from '../workflow/runtime.js'
import type { CollaborationPolicyProposal } from './types.js'

const DAY_MS = 86_400_000
export const COLLABORATION_SCHEDULE_KIND = 'assistant.collaboration-learning.schedule.v1'
export const COLLABORATION_POLICY_APPROVAL_KIND = 'assistant.collaboration-learning.policy-approval.v1'
export const COLLABORATION_SCHEDULE_ID = 'collaboration-learning:schedule'
export const COLLABORATION_EFFECTS = {
  evaluate: 'assistant.collaboration.evaluate.v1',
  applyDecision: 'assistant.collaboration.apply-policy-decision.v1',
} as const

interface ScheduleState extends Record<string, unknown> {
  readonly phase: 'scheduled' | 'evaluating'
  readonly intervalMs: number
  readonly sequence: number
}

interface ApprovalState extends Record<string, unknown> {
  readonly phase: 'awaiting-approval' | 'applying' | 'completed' | 'failed'
  readonly policyId: string
  readonly revision: number
  readonly approvalId: string
  readonly title: string
  readonly prompt: string
  readonly sequence: number
  readonly decision?: 'approve' | 'decline'
  readonly response?: string
}

export function collaborationScheduleWorkflow(intervalMs = DAY_MS): WorkflowDefinition {
  const interval = integer(intervalMs, 'collaboration evaluation interval')
  return {
    kind: COLLABORATION_SCHEDULE_KIND,
    version: 1,
    initialize(_input, now) {
      return { status: 'waiting', state: { phase: 'scheduled', intervalMs: interval, sequence: 0 }, wakeAt: now }
    },
    reduce(raw, event) {
      const state = scheduleState(raw)
      if (event.type === 'timer' && state.phase === 'scheduled') {
        return {
          status: 'waiting', state: { ...state, phase: 'evaluating' }, wakeAt: null,
          effects: [{
            id: stable('collaboration-evaluate', String(state.sequence)), kind: COLLABORATION_EFFECTS.evaluate,
            availableAt: event.occurredAt, payload: { evaluatedAt: event.occurredAt },
          }],
        }
      }
      if ((event.type === 'effect.delivered' || event.type === 'effect.failed') && state.phase === 'evaluating'
        && event.payload.effectKind === COLLABORATION_EFFECTS.evaluate) {
        return {
          status: 'waiting', state: { ...state, phase: 'scheduled', sequence: state.sequence + 1 },
          wakeAt: at(event.occurredAt, state.intervalMs),
        }
      }
      return { status: 'waiting', state }
    },
  }
}

export function collaborationPolicyApprovalWorkflow(): WorkflowDefinition {
  return {
    kind: COLLABORATION_POLICY_APPROVAL_KIND,
    version: 1,
    initialize(input, now) {
      const proposal = proposalInput(input)
      const approvalId = `policy:${proposal.id}:${proposal.revision}`
      const state: ApprovalState = {
        phase: 'awaiting-approval', policyId: proposal.id, revision: proposal.revision, approvalId,
        title: proposal.document.name,
        prompt: proposalPrompt(proposal), sequence: 0,
      }
      return { status: 'waiting', state, effects: [approvalEffect(state, now)] }
    },
    reduce(raw, event) {
      const state = approvalState(raw)
      if (event.type === 'approval.response' && state.phase === 'awaiting-approval') {
        if (event.payload.approvalId !== undefined && event.payload.approvalId !== state.approvalId) throw new Error('collaboration policy approval correlation mismatch')
        const response = text(event.payload.response, 'approval response', 1_000)
        return { status: 'waiting', state: { ...state, ...(response ? { response } : {}) } }
      }
      if ((event.type === 'approval.approved' || event.type === 'approval.declined') && state.phase === 'awaiting-approval') {
        if (event.payload.approvalId !== state.approvalId) throw new Error('collaboration policy approval correlation mismatch')
        const decision = event.type === 'approval.approved' ? 'approve' : 'decline'
        const next: ApprovalState = { ...state, phase: 'applying', decision, sequence: state.sequence + 1 }
        return { status: 'waiting', state: next, effects: [decisionEffect(next, event.occurredAt)] }
      }
      if (event.type === 'effect.delivered' && state.phase === 'applying'
        && event.payload.effectKind === COLLABORATION_EFFECTS.applyDecision) {
        return { status: 'completed', state: { ...state, phase: 'completed' } }
      }
      if (event.type === 'effect.failed' && (state.phase === 'awaiting-approval' || state.phase === 'applying')) {
        return { status: 'failed', state: { ...state, phase: 'failed' } }
      }
      return { status: state.phase === 'completed' ? 'completed' : state.phase === 'failed' ? 'failed' : 'waiting', state }
    },
  }
}

function approvalEffect(state: ApprovalState, now: string) {
  return {
    id: stable('collaboration-policy-card', state.policyId, String(state.revision)),
    kind: ASSISTANT_EFFECTS.requestInteraction,
    availableAt: now,
    payload: {
      mode: 'approval', title: '确认新的协作策略', approvalId: state.approvalId, prompt: state.prompt,
      confirmText: '批准启用', declineText: '暂不启用',
      idempotencyKey: `collaboration-policy:${state.policyId}:${state.revision}:approval`,
    },
  }
}

function decisionEffect(state: ApprovalState, now: string) {
  if (!state.decision) throw new Error('collaboration policy decision is missing')
  return {
    id: stable('collaboration-policy-decision', state.policyId, String(state.revision), state.decision),
    kind: COLLABORATION_EFFECTS.applyDecision,
    availableAt: now,
    payload: {
      policyId: state.policyId, revision: state.revision, decision: state.decision, decidedAt: now,
      ...(state.response ? { response: state.response } : {}),
    },
  }
}

function proposalPrompt(proposal: CollaborationPolicyProposal): string {
  return [
    proposal.sourceText,
    '',
    `依据：${proposal.sampleCount} 条样本，其中 ${proposal.reducibleCount} 条可减少打扰，置信度 ${(proposal.confidence * 100).toFixed(0)}%。`,
    `策略范围：${proposal.document.description}`,
    '批准后才会启用；紧急、待批准、明确追问或调研消息仍受保护。',
  ].join('\n')
}

function proposalInput(input: Readonly<Record<string, unknown>>): CollaborationPolicyProposal {
  const proposal = input.proposal
  if (typeof proposal !== 'object' || proposal === null || Array.isArray(proposal)) throw new Error('collaboration policy proposal is required')
  const value = proposal as unknown as CollaborationPolicyProposal
  if (!value.id?.trim() || !Number.isSafeInteger(value.revision) || value.revision < 1 || !value.document?.name?.trim()) {
    throw new Error('collaboration policy proposal is invalid')
  }
  return value
}

function scheduleState(value: Readonly<Record<string, unknown>>): ScheduleState {
  if ((value.phase !== 'scheduled' && value.phase !== 'evaluating') || !Number.isSafeInteger(value.intervalMs)
    || !Number.isSafeInteger(value.sequence)) throw new Error('collaboration schedule state is invalid')
  return value as ScheduleState
}

function approvalState(value: Readonly<Record<string, unknown>>): ApprovalState {
  if (!['awaiting-approval', 'applying', 'completed', 'failed'].includes(String(value.phase))
    || typeof value.policyId !== 'string' || !Number.isSafeInteger(value.revision) || typeof value.approvalId !== 'string') {
    throw new Error('collaboration approval state is invalid')
  }
  return value as ApprovalState
}

function integer(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 60_000) throw new Error(`${label} must be an integer of at least 60000`)
  return value
}
function at(now: string, delayMs: number): string { return new Date(new Date(now).getTime() + delayMs).toISOString() }
function stable(prefix: string, ...parts: readonly string[]): string { return `${prefix}:${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)}` }
function text(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} is invalid`)
  return value.trim()
}

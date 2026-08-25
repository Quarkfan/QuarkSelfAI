import { createHash } from 'node:crypto'
import { LARK_EFFECTS } from '../lark/effects.js'
import { TASK_PROJECTION_EFFECTS } from '../task-system/projection-effects.js'
import { ASSISTANT_EFFECTS } from '../workflow/effects.js'
import type { WorkflowEffectInput } from '../storage/types.js'
import type { WorkflowDecision, WorkflowDefinition, WorkflowEvent } from '../workflow/contracts.js'
import type { FollowupContact, FollowupOutreachConfig, FollowupOutreachInput } from './types.js'

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
type Phase = 'ready' | 'resolving' | 'awaiting-contact' | 'awaiting-approval' | 'sending' | 'waiting-reply' | 'updating-task' | 'notifying' | 'completed'
type Operation = 'resolve-contact' | 'interaction' | 'send' | 'task-update' | 'notify'
interface FailureState { readonly operation: Operation; readonly at: string; readonly count: number }
interface TaskResult { readonly title: string; readonly changes: readonly string[]; readonly summary: string; readonly url?: string }
export interface FollowupOutreachState extends Record<string, unknown> {
  readonly requestId: string; readonly taskId: string; readonly title: string; readonly personName?: string; readonly personOpenId?: string
  readonly question: string; readonly reason: string; readonly context: string; readonly url?: string
  readonly phase: Phase; readonly sequence: number; readonly retryBaseMs: number; readonly retryMaxMs: number; readonly failureThreshold: number
  readonly query?: string; readonly candidates: readonly FollowupContact[]; readonly contact?: FollowupContact; readonly approvalId?: string
  readonly approvedAt?: string
  readonly sentMessageId?: string; readonly sentAt?: string; readonly chatId?: string
  readonly replyMessageId?: string; readonly replyContent?: string; readonly replyReceivedAt?: string; readonly replyUrl?: string
  readonly taskResult?: TaskResult; readonly completedAt?: string; readonly outcome?: 'completed' | 'declined'; readonly failure?: FailureState
}

function required(value: unknown, label: string, max = 12_000): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`); if (value.length > max) throw new Error(`${label} exceeds ${max} characters`); return value }
function optional(value: unknown, max = 2_000): string | undefined { if (value === undefined || value === null || value === '') return undefined; return required(value, 'optional text', max) }
function integer(value: number | undefined, fallback: number, label: string, minimum = 1) { const selected = value ?? fallback; if (!Number.isSafeInteger(selected) || selected < minimum) throw new Error(`${label} is invalid`); return selected }
function stable(prefix: string, ...values: readonly string[]) { return `${prefix}:${createHash('sha256').update(values.join('\0')).digest('hex').slice(0, 32)}` }
function at(now: string, delay: number) { return new Date(new Date(now).getTime() + delay).toISOString() }
function kind(event: WorkflowEvent) { return typeof event.payload.effectKind === 'string' ? event.payload.effectKind : undefined }
function idFrom(event: WorkflowEvent) { return typeof event.payload.effectId === 'string' ? event.payload.effectId : undefined }
function record(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function withoutFailure(state: FollowupOutreachState): FollowupOutreachState { const { failure: _failure, ...rest } = state; return rest as FollowupOutreachState }
function contact(value: unknown, index = 0): FollowupContact { const item = record(value); if (!item || typeof item.external !== 'boolean') throw new Error(`invalid contact ${index}`); const department = optional(item.department, 500); const email = optional(item.email, 500); return { openId: required(item.openId, 'contact openId', 300), name: required(item.name, 'contact name', 300), ...(department ? { department } : {}), ...(email ? { email } : {}), external: item.external } }
function contacts(value: unknown): FollowupContact[] { if (!Array.isArray(value)) throw new Error('contact resolution must return candidates'); const result = value.map(contact); if (new Set(result.map(x => x.openId)).size !== result.length) throw new Error('contact resolution returned duplicate candidates'); return result.slice(0, 5) }
function externalKey(state: FollowupOutreachState, suffix: string) { return `followup:${state.requestId}:${suffix}` }

function resolveEffect(state: FollowupOutreachState, now: string): WorkflowEffectInput { return { id: stable('followup-resolve', state.requestId, String(state.sequence)), kind: LARK_EFFECTS.resolveContact, availableAt: now, payload: { ...(state.personOpenId && !state.query ? { openId: state.personOpenId } : {}), query: state.query ?? state.personName ?? '', idempotencyKey: externalKey(state, `resolve:${state.sequence}`) } } }
function interactionEffect(state: FollowupOutreachState, now: string): WorkflowEffectInput {
  if (state.phase === 'awaiting-approval' && state.contact && state.approvalId) return { id: stable('followup-approval', state.requestId, state.contact.openId, String(state.sequence)), kind: ASSISTANT_EFFECTS.requestInteraction, availableAt: now, payload: { mode: 'approval', title: '确认对外跟进', approvalId: state.approvalId, prompt: `事项：${state.title}\n接收人：${state.contact.name}${state.contact.department ? ` · ${state.contact.department}` : ''}${state.contact.external ? ' · 外部联系人' : ''}\n\n拟发送问题：${state.question}\n为什么现在询问：${state.reason}\n背景：${state.context}`, confirmText: '同意并发送', declineText: '暂不联系', idempotencyKey: externalKey(state, `approval:${state.contact.openId}`) } }
  if (state.candidates.length) return { id: stable('followup-contact-choice', state.requestId, String(state.sequence)), kind: ASSISTANT_EFFECTS.requestInteraction, availableAt: now, payload: { mode: 'choice', title: '选择跟进联系人', prompt: `“${state.query ?? state.personName ?? ''}”匹配到多个联系人`, eventType: 'followup.contact-selected', payloadKey: 'openId', options: state.candidates.map(x => ({ label: `${x.name}${x.department ? ` · ${x.department}` : ''}`, value: x.openId })), idempotencyKey: externalKey(state, `choice:${state.sequence}`) } }
  return { id: stable('followup-contact-input', state.requestId, String(state.sequence)), kind: ASSISTANT_EFFECTS.requestInteraction, availableAt: now, payload: { mode: 'input', title: '补充跟进联系人', prompt: `没有找到联系人“${state.query ?? state.personName ?? ''}”，请填写更准确的姓名或企业邮箱。`, eventType: 'followup.contact-query', payloadKey: 'query', idempotencyKey: externalKey(state, `input:${state.sequence}`) } }
}
function sendEffect(state: FollowupOutreachState, now: string): WorkflowEffectInput { if (!state.contact || !state.approvalId || !state.approvedAt) throw new Error('followup contact approval is missing'); return { id: stable('followup-send', state.requestId, String(state.sequence)), kind: LARK_EFFECTS.sendAsUser, availableAt: now, payload: { openId: state.contact.openId, content: `**我是常东旭的 AI 分身。** 受他授权，我正在协助跟进事项“${state.title}”。\n\n想向你确认：${state.question}\n\n背景：${state.context}\n\n你的回复会由我整理后反馈给常东旭，并同步到对应的跟进任务中。`, approvalId: state.approvalId, approvedAt: state.approvedAt, idempotencyKey: externalKey(state, 'send') } } }
function taskEffect(state: FollowupOutreachState, now: string): WorkflowEffectInput { const target = record(state.taskProjection); if (!target) throw new Error('followup reply requires task projection authorization'); return { id: stable('followup-task-update', state.requestId, state.replyMessageId ?? '', String(state.sequence)), kind: TASK_PROJECTION_EFFECTS.recordFollowupReply, availableAt: now, payload: { taskId: state.taskId, requestId: state.requestId, contact: state.contact, replyMessageId: state.replyMessageId, replyContent: state.replyContent, replyReceivedAt: state.replyReceivedAt, ...(state.replyUrl ? { replyUrl: state.replyUrl } : {}), ...target, effectiveAt: now, idempotencyKey: externalKey(state, `reply:${state.replyMessageId}`) } } }
function notifyEffect(state: FollowupOutreachState, now: string): WorkflowEffectInput { if (!state.contact || !state.taskResult) throw new Error('followup result is incomplete'); return { id: stable('followup-result-notify', state.requestId, state.replyMessageId ?? '', String(state.sequence)), kind: ASSISTANT_EFFECTS.notifyOwner, availableAt: now, payload: { title: `${state.contact.name} 已回复自动化跟进事项`, body: `事项：${state.title}\n回复：${state.replyContent}\n\n已写回任务：${state.taskResult.title}\n变更：${state.taskResult.changes.join('；')}\n结论：${state.taskResult.summary}${state.taskResult.url ? `\n${state.taskResult.url}` : ''}`, idempotencyKey: externalKey(state, `result:${state.replyMessageId}`) } } }

function retry(state: FollowupOutreachState, operation: Operation, event: WorkflowEvent): WorkflowDecision {
  const prior = state.failure?.operation === operation ? state.failure : undefined; const failure = { operation, at: prior?.at ?? event.occurredAt, count: (prior?.count ?? 0) + 1 }; const delay = Math.min(state.retryMaxMs, state.retryBaseMs * 2 ** Math.min(failure.count - 1, 10))
  const next = { ...state, failure }; const effects = failure.count === state.failureThreshold ? [{ id: stable('followup-failure-notice', state.requestId, operation, failure.at), kind: ASSISTANT_EFFECTS.notifyOwner, availableAt: event.occurredAt, payload: { title: '自动化跟进处理持续失败', body: `事项：${state.title}\n阶段：${operation}\n后台会继续重试。`, idempotencyKey: externalKey(state, `failure:${operation}:${failure.at}`) } }] : undefined
  return { status: 'waiting', state: next, wakeAt: at(event.occurredAt, delay), ...(effects ? { effects } : {}) }
}

export function followupOutreachWorkflow(config: FollowupOutreachConfig = {}): WorkflowDefinition {
  const retryBaseMs = integer(config.retryBaseMs, 2 * MINUTE_MS, 'retryBaseMs', 1_000); const retryMaxMs = integer(config.retryMaxMs, 6 * HOUR_MS, 'retryMaxMs', retryBaseMs); const failureThreshold = integer(config.failureNotifyThreshold, 1, 'failureNotifyThreshold')
  return { kind: 'followup.outreach', version: 1,
    initialize(raw, now) { const input = raw as unknown as FollowupOutreachInput; const personName = optional(input.personName, 300); const personOpenId = optional(input.personOpenId, 300); if (!personName && !personOpenId) throw new Error('followup outreach requires a person hint'); const taskId = required(input.taskId, 'taskId', 300); const question = required(input.question, 'question'); const requestId = stable('followup-request', taskId, personOpenId ?? personName ?? '', question).slice('followup-request:'.length); const url = optional(input.url); const state: FollowupOutreachState = { requestId, taskId, title: required(input.title, 'title', 300), ...(personName ? { personName } : {}), ...(personOpenId ? { personOpenId } : {}), question, reason: required(input.reason, 'reason'), context: required(input.context, 'context'), ...(url ? { url } : {}), ...(config.taskProjection ? { taskProjection: config.taskProjection } : {}), phase: 'ready', sequence: 0, retryBaseMs, retryMaxMs, failureThreshold, candidates: [] }; return { status: 'waiting', state, wakeAt: now } },
    reduce(raw, event): WorkflowDecision { const state = raw as FollowupOutreachState
      if (event.type === 'timer') {
        const next = { ...state, sequence: state.sequence + 1 }
        if (state.phase === 'ready' || state.phase === 'resolving') return { status: 'waiting', state: { ...next, phase: 'resolving' }, wakeAt: null, effects: [resolveEffect(next, event.occurredAt)] }
        if (state.phase === 'awaiting-contact' || state.phase === 'awaiting-approval') return { status: 'waiting', state: next, wakeAt: null, effects: [interactionEffect(next, event.occurredAt)] }
        if (state.phase === 'sending') return { status: 'waiting', state: next, wakeAt: null, effects: [sendEffect(next, event.occurredAt)] }
        if (state.phase === 'updating-task') return { status: 'waiting', state: next, wakeAt: null, effects: [taskEffect(next, event.occurredAt)] }
        if (state.phase === 'notifying') return { status: 'waiting', state: next, wakeAt: null, effects: [notifyEffect(next, event.occurredAt)] }
      }
      if (event.type === 'effect.delivered' && state.phase === 'resolving' && kind(event) === LARK_EFFECTS.resolveContact) {
        const found = contacts(event.payload.candidates)
        if (found.length === 1) {
          const selected = found[0]!
          const next = { ...withoutFailure(state), phase: 'awaiting-approval' as const, contact: selected, candidates: [], approvalId: externalKey(state, `approval:${selected.openId}`) }
          return { status: 'waiting', state: next, wakeAt: null, effects: [interactionEffect(next, event.occurredAt)] }
        }
        const next = { ...withoutFailure(state), phase: 'awaiting-contact' as const, candidates: found }
        return { status: 'waiting', state: next, wakeAt: null, effects: [interactionEffect(next, event.occurredAt)] }
      }
      if (event.type === 'followup.contact-selected' && state.phase === 'awaiting-contact') { const openId = required(event.payload.openId, 'selected openId', 300); const selected = state.candidates.find(x => x.openId === openId); if (!selected) throw new Error('selected contact is not a candidate'); const next = { ...state, phase: 'awaiting-approval' as const, contact: selected, candidates: [], approvalId: externalKey(state, `approval:${selected.openId}`) }; return { status: 'waiting', state: next, wakeAt: null, effects: [interactionEffect(next, event.occurredAt)] } }
      if (event.type === 'followup.contact-query' && state.phase === 'awaiting-contact') { const next = { ...state, phase: 'resolving' as const, query: required(event.payload.query, 'contact query', 500), candidates: [], sequence: state.sequence + 1 }; return { status: 'waiting', state: next, wakeAt: null, effects: [resolveEffect(next, event.occurredAt)] } }
      if (event.type === 'approval.declined' && state.phase === 'awaiting-approval') { if (event.payload.approvalId !== state.approvalId) throw new Error('approval correlation mismatch'); return { status: 'completed', state: { ...state, phase: 'completed', outcome: 'declined', completedAt: event.occurredAt }, wakeAt: null } }
      if (event.type === 'approval.approved' && state.phase === 'awaiting-approval') { if (event.payload.approvalId !== state.approvalId) throw new Error('approval correlation mismatch'); const next = { ...state, phase: 'sending' as const, sequence: state.sequence + 1, approvedAt: event.occurredAt }; return { status: 'waiting', state: next, wakeAt: null, effects: [sendEffect(next, event.occurredAt)] } }
      if (event.type === 'effect.delivered' && state.phase === 'sending' && kind(event) === LARK_EFFECTS.sendAsUser) { const messageId = required(event.payload.messageId, 'sent messageId', 300); const chatId = required(event.payload.chatId, 'sent chatId', 300); return { status: 'waiting', state: { ...withoutFailure(state), phase: 'waiting-reply', sentMessageId: messageId, chatId, sentAt: event.occurredAt }, wakeAt: null } }
      if (event.type === 'followup.reply' && state.phase === 'waiting-reply') { const replyUrl = optional(event.payload.url); const next = { ...state, phase: 'updating-task' as const, sequence: state.sequence + 1, replyMessageId: required(event.payload.messageId, 'reply messageId', 300), replyContent: required(event.payload.content, 'reply content', 5_000), replyReceivedAt: event.occurredAt, ...(replyUrl ? { replyUrl } : {}) }; return { status: 'waiting', state: next, wakeAt: null, effects: [taskEffect(next, event.occurredAt)] } }
      if (event.type === 'effect.delivered' && state.phase === 'updating-task' && kind(event) === TASK_PROJECTION_EFFECTS.recordFollowupReply) { const result = record(event.payload.result); if (!result || !Array.isArray(result.changes) || !result.changes.every(x => typeof x === 'string')) throw new Error('followup task result is invalid'); const resultUrl = optional(result.url); const next = { ...withoutFailure(state), phase: 'notifying' as const, sequence: state.sequence + 1, taskResult: { title: required(result.title, 'result title', 300), changes: result.changes, summary: required(result.summary, 'result summary'), ...(resultUrl ? { url: resultUrl } : {}) } }; return { status: 'waiting', state: next, wakeAt: null, effects: [notifyEffect(next, event.occurredAt)] } }
      if (['effect.delivered', 'effect.failed'].includes(event.type) && idFrom(event)?.startsWith('followup-failure-notice:')) return { status: 'waiting', state }
      if (event.type === 'effect.delivered' && state.phase === 'notifying' && kind(event) === ASSISTANT_EFFECTS.notifyOwner) return { status: 'completed', state: { ...withoutFailure(state), phase: 'completed', outcome: 'completed', completedAt: event.occurredAt }, wakeAt: null }
      if (event.type === 'effect.delivered' && kind(event) === ASSISTANT_EFFECTS.requestInteraction) return { status: 'waiting', state }
      if (event.type === 'effect.failed') { if (state.phase === 'resolving' && kind(event) === LARK_EFFECTS.resolveContact) return retry({ ...state, phase: 'ready' }, 'resolve-contact', event); if (state.phase === 'sending' && kind(event) === LARK_EFFECTS.sendAsUser) return retry(state, 'send', event); if (state.phase === 'updating-task' && kind(event) === TASK_PROJECTION_EFFECTS.recordFollowupReply) return retry(state, 'task-update', event); if (state.phase === 'notifying' && kind(event) === ASSISTANT_EFFECTS.notifyOwner) return retry(state, 'notify', event) }
      if (event.type === 'effect.failed' && kind(event) === ASSISTANT_EFFECTS.requestInteraction) return retry(state, 'interaction', event)
      return { status: state.phase === 'completed' ? 'completed' : 'waiting', state }
    } }
}

import { createHash } from 'node:crypto'
import type { CreateWorkflowInput } from '../storage/types.js'
import { followupOutreachWorkflow, type FollowupOutreachState } from '../followup/outreach-workflow.js'
import { followupReviewWorkflow, type FollowupReviewState } from '../followup/review-workflow.js'
import type { FollowupContact, FollowupPluginConfig } from '../followup/plugin.js'

export interface FollowupHandoff { readonly workflows: readonly CreateWorkflowInput[]; readonly digest: string; readonly counts: { readonly outreach: number; readonly awaitingContact: number; readonly awaitingApproval: number; readonly waitingReply: number; readonly completed: number; readonly failures: number; readonly reviewCheckpoint: number } }
export interface FollowupHandoffTarget { createWorkflow(input: CreateWorkflowInput): Promise<{ readonly inserted: boolean }> }
function record(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function array(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : [] }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`; return JSON.stringify(value) }
function text(value: unknown, label: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`); return value }
function optional(value: unknown): string | undefined { return typeof value === 'string' && value ? value : undefined }
function timestamp(value: unknown, label: string): string | undefined { if (value === null || value === undefined || value === '') return undefined; if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) throw new Error(`${label} must be a timestamp`); return value }
function count(value: unknown, label: string): number { const selected = value ?? 0; if (!Number.isSafeInteger(selected) || Number(selected) < 0) throw new Error(`${label} must be a non-negative integer`); return Number(selected) }
function contact(value: unknown, label: string): FollowupContact | undefined { if (value === null || value === undefined) return undefined; const item = record(value); if (!item || typeof item.external !== 'boolean') throw new Error(`${label} is invalid`); const department = optional(item.department); const email = optional(item.email); return { openId: text(item.openId, `${label}.openId`), name: text(item.name, `${label}.name`), ...(department ? { department } : {}), ...(email ? { email } : {}), external: item.external } }

export function prepareFollowupHandoff(legacyRoot: unknown, config: FollowupPluginConfig, frozenAt: string): FollowupHandoff {
  timestamp(frozenAt, 'frozenAt'); const root = record(legacyRoot) ?? {}; const reviewDefinition = followupReviewWorkflow(config); const reviewInitial = reviewDefinition.initialize({}, frozenAt); const lastDay = optional(root.followupLastCheckedDay)
  if (lastDay && !/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) throw new Error('followupLastCheckedDay must use YYYY-MM-DD')
  const reviewState: FollowupReviewState = { ...(reviewInitial.state as FollowupReviewState), ...(lastDay ? { lastCompletedDay: lastDay } : {}) }
  const workflows: CreateWorkflowInput[] = [{ id: 'followup-review:automation', kind: reviewDefinition.kind, definitionVersion: reviewDefinition.version, status: 'waiting', state: reviewState, wakeAt: frozenAt }]
  const outreachDefinition = followupOutreachWorkflow(config); const seen = new Set<string>(); let awaitingContact = 0; let awaitingApproval = 0; let waitingReply = 0; let completed = 0; let failures = 0
  for (const [index, raw] of array(root.followupOutreachRequests).entries()) {
    const item = record(raw); if (!item) throw new Error(`followup outreach ${index} is invalid`); const requestId = text(item.id, `followup outreach ${index} id`); if (seen.has(requestId)) throw new Error(`followup outreach ${index} duplicates id`); seen.add(requestId)
    const input = { taskId: text(item.taskId, `followup outreach ${index} taskId`), title: text(item.title, `followup outreach ${index} title`), ...(optional(item.personName) ? { personName: optional(item.personName) } : {}), ...(optional(item.personOpenId) ? { personOpenId: optional(item.personOpenId) } : {}), question: text(item.question, `followup outreach ${index} question`), reason: text(item.reason, `followup outreach ${index} reason`), context: text(item.context, `followup outreach ${index} context`), ...(optional(item.url) ? { url: optional(item.url) } : {}) }
    const base = outreachDefinition.initialize(input, frozenAt).state as FollowupOutreachState; const legacyStatus = String(item.status); let phase: FollowupOutreachState['phase']; let status: CreateWorkflowInput['status'] = 'waiting'; let wakeAt: string | undefined; let outcome: FollowupOutreachState['outcome']
    const selected = contact(item.contact, `followup outreach ${index} contact`); const candidates = array(item.candidates).map((value, candidateIndex) => contact(value, `followup outreach ${index} candidate ${candidateIndex}`)!).filter(Boolean)
    const attempts = count(item.attempts, `followup outreach ${index} attempts`) + count(item.replyCheckFailures, `followup outreach ${index} reply failures`); failures += attempts
    if (['new', 'resolution_failed'].includes(legacyStatus)) { phase = 'ready'; wakeAt = timestamp(item.nextAttemptAt, `followup outreach ${index} nextAttemptAt`) ?? frozenAt }
    else if (['selecting_contact', 'awaiting_contact_input'].includes(legacyStatus)) { phase = 'awaiting-contact'; awaitingContact += 1 }
    else if (legacyStatus === 'pending_approval') { if (!selected) throw new Error(`followup outreach ${index} pending approval has no contact`); phase = 'awaiting-approval'; awaitingApproval += 1 }
    else if (legacyStatus === 'waiting_reply') { if (!selected) throw new Error(`followup outreach ${index} waiting reply has no contact`); phase = 'waiting-reply'; waitingReply += 1 }
    else if (legacyStatus === 'declined' || legacyStatus === 'completed') { phase = 'completed'; status = 'completed'; outcome = legacyStatus === 'declined' ? 'declined' : 'completed'; completed += 1 }
    else throw new Error(`followup outreach ${index} has unsupported status ${legacyStatus}`)
    const sentMessageId = optional(item.sentMessageId); const sentAt = timestamp(item.sentAt, `followup outreach ${index} sentAt`); const chatId = optional(item.chatId)
    if (phase === 'waiting-reply' && (!sentMessageId || !sentAt || !chatId)) throw new Error(`followup outreach ${index} waiting reply has incomplete message correlation`)
    const state: FollowupOutreachState = { ...base, requestId, phase, sequence: attempts, candidates, ...(selected ? { contact: selected } : {}), ...(phase === 'awaiting-approval' && selected ? { approvalId: `followup:${requestId}:approval:${selected.openId}` } : {}), ...(sentMessageId && sentAt && chatId ? { sentMessageId, sentAt, chatId } : {}), ...(outcome ? { outcome, completedAt: timestamp(item.completedAt ?? item.decidedAt, `followup outreach ${index} completedAt`) ?? frozenAt } : {}) }
    workflows.push({ id: `followup-outreach:${requestId}`, kind: outreachDefinition.kind, definitionVersion: outreachDefinition.version, status, state, ...(wakeAt ? { wakeAt } : {}) })
  }
  return { workflows, digest: createHash('sha256').update(canonical(workflows)).digest('hex'), counts: { outreach: workflows.length - 1, awaitingContact, awaitingApproval, waitingReply, completed, failures, reviewCheckpoint: Number(Boolean(lastDay)) } }
}
export async function applyFollowupHandoff(target: FollowupHandoffTarget, handoff: FollowupHandoff, expectedDigest: string) { if (handoff.digest !== expectedDigest) throw new Error('followup handoff digest changed after audit'); let inserted = 0; for (const workflow of handoff.workflows) if ((await target.createWorkflow(workflow)).inserted) inserted += 1; return { inserted, existing: handoff.workflows.length - inserted } }

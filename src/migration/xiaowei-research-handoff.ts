import { createHash } from 'node:crypto'
import type { CreateWorkflowInput } from '../storage/types.js'
import type { XiaoweiResearchConfig } from '../xiaowei/types.js'
import { xiaoweiResearchWorkflow, type XiaoweiResearchState } from '../xiaowei/workflow.js'

export interface XiaoweiResearchHandoff {
  readonly workflows: readonly CreateWorkflowInput[]
  readonly digest: string
  readonly counts: { readonly tracked: number; readonly waitingReply: number; readonly syncing: number; readonly completed: number; readonly failures: number }
}
export interface XiaoweiResearchHandoffTarget { createWorkflow(input: CreateWorkflowInput): Promise<{ readonly inserted: boolean }> }
function record(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function array(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : [] }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}
function timestamp(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) throw new Error(`${label} must be a timestamp`)
  return value
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value
}
function count(value: unknown, label: string): number {
  const selected = value ?? 0
  if (!Number.isSafeInteger(selected) || Number(selected) < 0) throw new Error(`${label} must be a non-negative integer`)
  return Number(selected)
}

export function prepareXiaoweiResearchHandoff(legacyRoot: unknown, config: XiaoweiResearchConfig, frozenAt: string): XiaoweiResearchHandoff {
  timestamp(frozenAt, 'frozenAt')
  const root = record(legacyRoot) ?? {}
  const definition = xiaoweiResearchWorkflow(config)
  const seen = new Set<string>()
  let waitingReply = 0; let syncing = 0; let completed = 0; let failures = 0
  const workflows = array(root.xiaoweiResearchRequests).map((value, index): CreateWorkflowInput => {
    const item = record(value)
    if (!item) throw new Error(`Xiaowei request ${index} is invalid`)
    const requestId = text(item.id, `Xiaowei request ${index} id`)
    if (seen.has(requestId)) throw new Error(`Xiaowei request ${index} duplicates id`)
    seen.add(requestId)
    const status = String(item.status)
    if (!['new', 'waiting_reply', 'reply_received', 'task_update_failed', 'completed', 'cancelled'].includes(status)) throw new Error(`Xiaowei request ${index} has unsupported status`)
    const createdAt = timestamp(item.createdAt, `Xiaowei request ${index} createdAt`) ?? frozenAt
    const sentMessageId = typeof item.sentMessageId === 'string' && item.sentMessageId ? item.sentMessageId : undefined
    const sentAt = timestamp(item.sentAt, `Xiaowei request ${index} sentAt`)
    if (status !== 'new' && (!sentMessageId || !sentAt)) throw new Error(`Xiaowei request ${index} has no sent message correlation`)
    const initialized = definition.initialize({ requestId, approvedAt: createdAt,
      ...(typeof item.taskId === 'string' && item.taskId ? { taskId: item.taskId } : {}),
      title: text(item.title, `Xiaowei request ${index} title`), prompt: text(item.prompt, `Xiaowei request ${index} prompt`),
      ...(typeof item.sourceChat === 'string' ? { sourceChat: item.sourceChat } : {}),
      ...(typeof item.sourceSender === 'string' ? { sourceSender: item.sourceSender } : {}),
      ...(sentMessageId && sentAt ? { sentMessageId, sentAt } : {}),
    }, frozenAt)
    const base = initialized.state as XiaoweiResearchState
    const attempts = count(item.attempts, `Xiaowei request ${index} attempts`)
    const replyContent = typeof item.replyContent === 'string' && item.replyContent ? item.replyContent : undefined
    const replyMessageId = typeof item.replyMessageId === 'string' && item.replyMessageId ? item.replyMessageId : undefined
    const replyReceivedAt = timestamp(item.replyReceivedAt, `Xiaowei request ${index} replyReceivedAt`)
    let phase: XiaoweiResearchState['phase']; let workflowStatus: CreateWorkflowInput['status']; let wakeAt: string | undefined
    let ownerNotified = false; let taskUpdated = !base.taskId
    if (status === 'new') { phase = 'ready'; workflowStatus = 'waiting'; wakeAt = timestamp(item.nextAttemptAt, `Xiaowei request ${index} nextAttemptAt`) ?? frozenAt }
    else if (status === 'waiting_reply') { phase = 'waiting-reply'; workflowStatus = 'waiting'; waitingReply += 1 }
    else if (status === 'reply_received' || status === 'task_update_failed') {
      if (!replyContent || !replyMessageId || !replyReceivedAt) throw new Error(`Xiaowei request ${index} has no reply correlation`)
      phase = 'syncing'; workflowStatus = 'waiting'; ownerNotified = true; taskUpdated = false; syncing += 1
      wakeAt = timestamp(item.nextTaskUpdateAt, `Xiaowei request ${index} nextTaskUpdateAt`) ?? frozenAt
    } else { phase = 'completed'; workflowStatus = 'completed'; ownerNotified = Boolean(replyContent); taskUpdated = true; completed += 1 }
    failures += attempts + count(item.taskUpdateAttempts, `Xiaowei request ${index} task update attempts`)
    const state: XiaoweiResearchState = { ...base, phase, sequence: attempts,
      ...(replyContent && replyMessageId && replyReceivedAt ? { replyContent, replyMessageId, replyReceivedAt,
        ...(typeof item.replyUrl === 'string' && item.replyUrl ? { replyUrl: item.replyUrl } : {}) } : {}),
      ownerNotified, taskUpdated,
      ...(workflowStatus === 'completed' ? { completedAt: timestamp(item.completedAt, `Xiaowei request ${index} completedAt`) ?? frozenAt } : {}),
    }
    return { id: `xiaowei-research:${requestId}`, kind: definition.kind, definitionVersion: definition.version,
      status: workflowStatus, state, ...(wakeAt ? { wakeAt } : {}) }
  })
  return { workflows, digest: createHash('sha256').update(canonical(workflows)).digest('hex'), counts: {
    tracked: workflows.length, waitingReply, syncing, completed, failures,
  } }
}

export async function applyXiaoweiResearchHandoff(target: XiaoweiResearchHandoffTarget, handoff: XiaoweiResearchHandoff, expectedDigest: string) {
  if (handoff.digest !== expectedDigest) throw new Error('Xiaowei research handoff digest changed after audit')
  let inserted = 0
  for (const workflow of handoff.workflows) if ((await target.createWorkflow(workflow)).inserted) inserted += 1
  return { inserted, existing: handoff.workflows.length - inserted }
}

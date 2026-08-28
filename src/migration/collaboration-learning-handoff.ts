import { createHash } from 'node:crypto'
import type { DurableSignalInput } from '../storage/types.js'

export interface CollaborationLearningHandoff {
  readonly signals: readonly DurableSignalInput[]
  readonly checkpoints: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly digest: string
  readonly counts: {
    readonly observations: number
    readonly ownerSignals: number
    readonly candidates: number
    readonly proactiveInsights: number
    readonly proactiveQuestions: number
  }
}

export interface CollaborationHandoffTarget {
  appendSignal(input: DurableSignalInput): Promise<{ readonly inserted: boolean }>
  readFeatureCheckpoint(namespace: string, key: string): Promise<Readonly<Record<string, unknown>> | undefined>
  writeFeatureCheckpoint(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<void>
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}:${createHash('sha256').update(canonical(value)).digest('hex')}`
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) throw new Error(`${label} has no valid timestamp`)
  return value
}

/**
 * Converts privacy-bounded learning metadata plus explicit owner-stated
 * insights. It never carries ambient message content, context excerpts or credentials.
 */
export function prepareCollaborationLearningHandoff(legacyRoot: unknown): CollaborationLearningHandoff {
  const root = record(legacyRoot)
  const learning = record(root?.collaborationLearning)
  const proactive = record(root?.proactiveConversation)
  if (!learning && !proactive) return {
    signals: [], checkpoints: {}, digest: createHash('sha256').update('[]').digest('hex'),
    counts: { observations: 0, ownerSignals: 0, candidates: 0, proactiveInsights: 0, proactiveQuestions: 0 },
  }
  const signals: DurableSignalInput[] = []
  const observations = array(learning?.observations).map((value, index) => {
    const item = record(value)
    if (!item || typeof item.messageId !== 'string') throw new Error(`collaboration observation ${index} has no messageId`)
    const occurredAt = timestamp(item.at, `collaboration observation ${index}`)
    const data = { ...item }
    delete data.content
    delete data.title
    return {
      id: stableId('legacy-collaboration-observation', { messageId: item.messageId, occurredAt }),
      kind: 'collaboration.observation.v1', occurredAt,
      scope: { ...(typeof item.chatId === 'string' ? { chatId: item.chatId } : {}), ...(typeof item.senderId === 'string' ? { senderId: item.senderId } : {}) },
      data,
    } satisfies DurableSignalInput
  })
  const ownerSignals = array(learning?.ownerSignals).map((value, index) => {
    const item = record(value)
    if (!item) throw new Error(`collaboration owner signal ${index} is invalid`)
    const occurredAt = timestamp(item.at, `collaboration owner signal ${index}`)
    return {
      id: stableId('legacy-collaboration-owner-signal', item),
      kind: 'collaboration.owner-signal.v1', occurredAt,
      scope: typeof item.policyId === 'string' ? { policyId: item.policyId } : {}, data: item,
    } satisfies DurableSignalInput
  })
  const candidateRecords = array(learning?.candidates)
  const candidates = candidateRecords.flatMap((value, index) => {
    const item = record(value)
    if (!item || typeof item.policyId !== 'string') throw new Error(`collaboration candidate ${index} has no policyId`)
    const occurredAt = timestamp(item.proposedAt, `collaboration candidate ${index}`)
    const proposal = {
      id: stableId('legacy-collaboration-proposal', item),
      kind: 'collaboration.policy-proposal.v1', occurredAt,
      scope: typeof item.scopeKey === 'string' ? { scopeKey: item.scopeKey } : {}, data: item,
    } satisfies DurableSignalInput
    if (!['proposed', 'approved', 'declined'].includes(String(item.status))) return [proposal]
    return [proposal, {
      id: stableId('legacy-collaboration-proposal-published', item),
      kind: 'collaboration.policy-proposal-published.v1', occurredAt,
      scope: typeof item.scopeKey === 'string' ? { scopeKey: item.scopeKey } : {},
      data: { scopeKey: item.scopeKey, policyId: item.policyId, revision: item.revision, legacyStatus: item.status },
    } satisfies DurableSignalInput]
  })
  const proactiveInsights = array(learning?.proactiveInsights).map((value, index) => {
    const item = record(value)
    if (!item || typeof item.questionId !== 'string' || typeof item.knowledgeKey !== 'string' || typeof item.answer !== 'string') throw new Error(`proactive insight ${index} is invalid`)
    const occurredAt = timestamp(item.at, `proactive insight ${index}`)
    return { id: stableId('legacy-proactive-insight', { questionId: item.questionId, occurredAt }), kind: 'collaboration.owner-insight.v1', occurredAt,
      scope: { knowledgeKey: item.knowledgeKey }, data: { questionId: item.questionId, knowledgeKey: item.knowledgeKey, answer: item.answer.slice(0, 2000), status: 'owner-stated' } } satisfies DurableSignalInput
  })
  const proactiveQuestions = array(proactive?.questions).map((value, index) => {
    const item = record(value)
    if (!item || typeof item.id !== 'string' || typeof item.question !== 'string') throw new Error(`proactive question ${index} is invalid`)
    const occurredAt = timestamp(item.askedAt, `proactive question ${index}`)
    return { id: stableId('legacy-proactive-question', { id: item.id, occurredAt }), kind: 'collaboration.proactive-question.v1', occurredAt,
      scope: typeof item.knowledgeKey === 'string' ? { knowledgeKey: item.knowledgeKey } : {}, data: { id: item.id, question: item.question.slice(0, 180),
        knowledgeKey: item.knowledgeKey, status: item.status, messageId: item.messageId ?? null, answeredAt: item.answeredAt ?? null } } satisfies DurableSignalInput
  })
  signals.push(...observations, ...ownerSignals, ...candidates, ...proactiveInsights, ...proactiveQuestions)
  const ids = signals.map(signal => signal.id)
  if (new Set(ids).size !== ids.length) throw new Error('legacy collaboration state contains duplicate durable signal ids')
  const checkpoints: Record<string, Readonly<Record<string, unknown>>> = {}
  if (typeof learning?.lastEvaluatedAt === 'string') checkpoints.evaluation = { lastEvaluatedAt: timestamp(learning.lastEvaluatedAt, 'lastEvaluatedAt') }
  if (typeof learning?.lastProposalAt === 'string') checkpoints.proposal = { lastProposalAt: timestamp(learning.lastProposalAt, 'lastProposalAt') }
  if (proactive && (typeof proactive.lastEvaluatedAt === 'string' || typeof proactive.nextEvaluateAt === 'string')) checkpoints['proactive-dialogue'] = {
    ...(typeof proactive.lastEvaluatedAt === 'string' ? { lastEvaluatedAt: timestamp(proactive.lastEvaluatedAt, 'proactive lastEvaluatedAt') } : {}),
    ...(typeof proactive.nextEvaluateAt === 'string' ? { nextEvaluateAt: timestamp(proactive.nextEvaluateAt, 'proactive nextEvaluateAt') } : {}),
  }
  return {
    signals,
    checkpoints,
    digest: createHash('sha256').update(canonical({ signals, checkpoints })).digest('hex'),
    counts: { observations: observations.length, ownerSignals: ownerSignals.length, candidates: candidateRecords.length,
      proactiveInsights: proactiveInsights.length, proactiveQuestions: proactiveQuestions.length },
  }
}

/** Applies a previously audited handoff without overwriting native state. */
export async function applyCollaborationLearningHandoff(
  target: CollaborationHandoffTarget,
  handoff: CollaborationLearningHandoff,
  expectedDigest: string,
): Promise<{ readonly insertedSignals: number; readonly existingSignals: number; readonly writtenCheckpoints: number }> {
  if (handoff.digest !== expectedDigest) throw new Error('collaboration handoff digest changed after audit')
  let insertedSignals = 0
  for (const signal of handoff.signals) {
    const result = await target.appendSignal(signal)
    if (result.inserted) insertedSignals += 1
  }
  let writtenCheckpoints = 0
  for (const [key, value] of Object.entries(handoff.checkpoints)) {
    const existing = await target.readFeatureCheckpoint('collaboration-learning', key)
    if (existing) {
      if (canonical(existing) !== canonical(value)) throw new Error(`native collaboration checkpoint ${key} already has different content`)
      continue
    }
    await target.writeFeatureCheckpoint('collaboration-learning', key, value)
    writtenCheckpoints += 1
  }
  return { insertedSignals, existingSignals: handoff.signals.length - insertedSignals, writtenCheckpoints }
}

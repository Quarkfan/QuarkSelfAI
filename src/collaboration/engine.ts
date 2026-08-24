import { createHash } from 'node:crypto'
import { policyProposalId } from '../policy/authoring.js'
import { simulatePolicy, validatePolicy } from '../policy/engine.js'
import type { PolicyDocument, PolicySample } from '../policy/types.js'
import type { DurableSignal, DurableSignalInput, PolicyDraftInput } from '../storage/types.js'
import type {
  AttentionTier,
  CollaborationLearningConfig,
  CollaborationMessage,
  CollaborationPolicyProposal,
  CollaborationTaskDecision,
} from './types.js'

const DAY_MS = 86_400_000
const OBSERVATION_KIND = 'collaboration.observation.v1'
const OWNER_SIGNAL_KIND = 'collaboration.owner-signal.v1'
const PROPOSAL_KIND = 'collaboration.policy-proposal.v1'
const PROPOSAL_PUBLISHED_KIND = 'collaboration.policy-proposal-published.v1'
const CHECKPOINT_NAMESPACE = 'collaboration-learning'

export interface CollaborationLearningPort {
  appendSignal(input: DurableSignalInput): Promise<{ readonly inserted: boolean }>
  recentSignals(kind: string, limit: number): Promise<readonly DurableSignal[]>
  readCheckpoint(namespace: string, key: string): Promise<Readonly<Record<string, unknown>> | undefined>
  writeCheckpoint(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<void>
  recentPolicySamples(limit: number): Promise<readonly PolicySample[]>
  savePolicyDraft(input: PolicyDraftInput): Promise<number>
  publishProposal(proposal: CollaborationPolicyProposal): Promise<void>
}

interface Observation {
  readonly at: string
  readonly messageId: string
  readonly chatId?: string
  readonly senderId?: string
  readonly intakeReasons: readonly string[]
  readonly attentionTier: AttentionTier
  readonly actualNotification: 'silent' | 'notify'
  readonly difference: 'aligned' | 'possible_noise' | 'could_batch' | 'possible_miss'
  readonly taskAction: string
  readonly approvalRequired: boolean
  readonly researchDecision: string
  readonly actionOwner: string
  readonly materialChange: boolean
  readonly signalType?: string
  readonly signalOperation?: string
  readonly emojiType?: string
  readonly ownerOperated?: boolean
}

interface ScopeEvaluation {
  readonly key: string
  readonly kind: 'chat' | 'sender'
  readonly id: string
  readonly sampleCount: number
  readonly reducible: number
  readonly protectedCount: number
  readonly confidence: number
}

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function signalId(prefix: string, ...parts: readonly string[]): string {
  return `${prefix}:${createHash('sha256').update(parts.join('\0')).digest('hex')}`
}

export function classifyAttention(task: CollaborationTaskDecision = {}, now = new Date()): AttentionTier {
  const priority = Number(task.priority ?? 0)
  const due = task.dueDate ? new Date(task.dueDate) : undefined
  const dueSoon = due && !Number.isNaN(due.getTime()) && due.getTime() <= now.getTime() + DAY_MS
  if (priority === 5 || (priority >= 3 && dueSoon)) return 'realtime'
  if (task.notificationDecision === 'notify' || priority >= 3 || task.needsClarification
    || task.researchDecision === 'start' || task.researchDecision === 'confirm'
    || (task.actionRequired && (task.actionOwner === 'changdongxu' || task.actionOwner === 'shared'))) return 'today'
  return 'silent'
}

function observationFromSignal(signal: DurableSignal): Observation | undefined {
  const data = signal.data
  if (typeof data.messageId !== 'string' || typeof data.at !== 'string' || !Array.isArray(data.intakeReasons)) return undefined
  return data as unknown as Observation
}

export class CollaborationLearningEngine {
  private evaluating = false

  constructor(
    private readonly port: CollaborationLearningPort,
    private readonly config: CollaborationLearningConfig = {},
  ) {}

  async observe(message: CollaborationMessage, task: CollaborationTaskDecision, now = new Date()): Promise<boolean> {
    const attentionTier = classifyAttention(task, now)
    const actualNotification = task.notificationDecision ?? 'silent'
    let difference: Observation['difference'] = 'aligned'
    if (actualNotification === 'notify' && attentionTier === 'silent') difference = 'possible_noise'
    else if (actualNotification === 'notify' && attentionTier === 'today') difference = 'could_batch'
    else if (actualNotification === 'silent' && attentionTier === 'realtime') difference = 'possible_miss'
    const at = now.toISOString()
    const data: Observation = {
      at,
      messageId: message.messageId,
      ...(message.chatId ? { chatId: message.chatId } : {}),
      ...(message.senderId ? { senderId: message.senderId } : {}),
      intakeReasons: unique(message.intakeReasons ?? []).slice(0, 5),
      attentionTier,
      actualNotification,
      difference,
      taskAction: task.taskAction ?? 'ignored',
      approvalRequired: task.approvalRequired === true,
      researchDecision: task.researchDecision ?? 'skip',
      actionOwner: task.actionOwner ?? 'unknown',
      materialChange: Boolean(task.materialChangeSummary),
      ...(message.signal?.type ? { signalType: message.signal.type } : {}),
      ...(message.signal?.operation ? { signalOperation: message.signal.operation } : {}),
      ...(message.signal?.emojiType ? { emojiType: message.signal.emojiType } : {}),
      ...(message.signal?.ownerOperated === undefined ? {} : { ownerOperated: message.signal.ownerOperated }),
    }
    const result = await this.port.appendSignal({
      id: signalId('collaboration-observation', message.messageId),
      kind: OBSERVATION_KIND,
      occurredAt: at,
      scope: { ...(message.chatId ? { chatId: message.chatId } : {}), ...(message.senderId ? { senderId: message.senderId } : {}) },
      data: data as unknown as Record<string, unknown>,
    })
    return result.inserted
  }

  async recordOwnerMessage(messageId: string, text: string, explicitReply: boolean, now = new Date()): Promise<boolean> {
    const occurredAt = now.toISOString()
    const normalized = text.trim()
    const result = await this.port.appendSignal({
      id: signalId('collaboration-owner-message', messageId),
      kind: OWNER_SIGNAL_KIND,
      occurredAt,
      data: {
        type: 'direct_message', messageId, explicitReply, shortMessage: normalized.length <= 20,
        continuationCue: /^(继续|就这个|按这个|可以|好的|处理吧|执行吧|改一下|再补充|另外)/u.test(normalized),
        correctionCue: /(不对|不是|应该|改为|改成|纠正|补充)/u.test(normalized),
        approvalCue: /(同意|批准|确认|可以执行|执行吧)/u.test(normalized),
        rejectionCue: /(不同意|不批准|先不|暂不|不要|取消)/u.test(normalized),
      },
    })
    return result.inserted
  }

  async recordPolicyDecision(policyId: string, decision: 'approve' | 'decline', now = new Date()): Promise<boolean> {
    const occurredAt = now.toISOString()
    const result = await this.port.appendSignal({
      id: signalId('collaboration-policy-decision', policyId, decision),
      kind: OWNER_SIGNAL_KIND,
      occurredAt,
      scope: { policyId },
      data: { type: 'policy_decision', policyId, decision },
    })
    return result.inserted
  }

  async guidanceFor(message: CollaborationMessage): Promise<string> {
    if (!message.signal?.type) return '暂无同类协作信号样本；按当前上下文保守判断。'
    const observations = (await this.observations())
      .filter(item => item.signalType === message.signal?.type)
      .filter(item => !message.signal?.emojiType || item.emojiType === message.signal.emojiType)
      .filter(item => message.signal?.ownerOperated === undefined || item.ownerOperated === message.signal.ownerOperated)
      .slice(-20)
    if (!observations.length) return '暂无同类协作信号样本；按当前上下文保守判断。'
    const count = (field: keyof Observation, value: unknown) => observations.filter(item => item[field] === value).length
    return [
      `同类脱敏样本 ${observations.length} 条`,
      `建单 ${count('taskAction', 'created')}、更新 ${count('taskAction', 'updated')}、忽略 ${count('taskAction', 'ignored')}`,
      `即时通知 ${count('actualNotification', 'notify')}、静默 ${count('actualNotification', 'silent')}`,
      `本人责任 ${count('actionOwner', 'changdongxu')}、共同责任 ${count('actionOwner', 'shared')}、他人责任 ${count('actionOwner', 'other')}`,
    ].join('；')
  }

  async poll(now = new Date()): Promise<CollaborationPolicyProposal | undefined> {
    if (this.evaluating || this.config.enabled === false) return undefined
    this.evaluating = true
    try {
      const checkpoint = await this.port.readCheckpoint(CHECKPOINT_NAMESPACE, 'evaluation')
      const lastEvaluatedAt = typeof checkpoint?.lastEvaluatedAt === 'string' ? checkpoint.lastEvaluatedAt : undefined
      const interval = this.config.evaluationIntervalMs ?? DAY_MS
      if (lastEvaluatedAt && now.getTime() - new Date(lastEvaluatedAt).getTime() < interval) return undefined
      await this.port.writeCheckpoint(CHECKPOINT_NAMESPACE, 'evaluation', { lastEvaluatedAt: now.toISOString() })
      const observations = await this.observations()
      if (observations.length < (this.config.minimumSamples ?? 20)) return undefined
      const proposalCheckpoint = await this.port.readCheckpoint(CHECKPOINT_NAMESPACE, 'proposal')
      const lastProposalAt = typeof proposalCheckpoint?.lastProposalAt === 'string' ? proposalCheckpoint.lastProposalAt : undefined
      if (lastProposalAt && now.getTime() - new Date(lastProposalAt).getTime() < (this.config.proposalCooldownMs ?? 7 * DAY_MS)) return undefined
      const publishedProposals = await this.port.recentSignals(PROPOSAL_PUBLISHED_KIND, 100)
      const priorScopes = new Set(publishedProposals.flatMap(signal => {
        return typeof signal.data.scopeKey === 'string' ? [signal.data.scopeKey] : []
      }))
      const candidate = this.evaluateScopes(observations)
        .filter(scope => scope.sampleCount >= (this.config.minimumScopeSamples ?? 8) && scope.protectedCount === 0 && scope.confidence >= 0.75)
        .filter(scope => !priorScopes.has(scope.key))
        .sort((left, right) => right.reducible - left.reducible || right.confidence - left.confidence)[0]
      if (!candidate) return undefined
      const label = candidate.kind === 'chat' ? '这个飞书会话' : '这位联系人'
      const sourceText = `根据持续协作样本，${label}的普通非紧急消息优先批量汇总；明确紧急、待批准、需要追问或调研的消息仍即时通知。`
      const document: PolicyDocument = {
        version: 1,
        name: `${label}普通消息批量汇总`,
        description: `从 ${candidate.sampleCount} 条脱敏协作样本中发现 ${candidate.reducible} 条可合并通知；只限定精确来源，紧急保护由模拟门禁复核。`,
        priority: 200,
        when: { fact: candidate.kind === 'chat' ? 'source.chatId' : 'source.senderId', op: 'eq', value: candidate.id },
        effect: { attention: 'batch' },
      }
      validatePolicy(document)
      const samples = await this.port.recentPolicySamples(2000)
      const simulation = simulatePolicy(document, samples)
      const id = policyProposalId(sourceText, document)
      const revision = await this.port.savePolicyDraft({ id, name: document.name, sourceText, document, simulation })
      const proposal: CollaborationPolicyProposal = {
        id, revision, sourceText, document, simulation,
        sampleCount: candidate.sampleCount, reducibleCount: candidate.reducible, confidence: candidate.confidence,
      }
      await this.port.appendSignal({
        id: signalId('collaboration-proposal', id, String(revision)),
        kind: PROPOSAL_KIND,
        occurredAt: now.toISOString(),
        scope: { [candidate.kind === 'chat' ? 'chatId' : 'senderId']: candidate.id },
        data: { scopeKey: candidate.key, policyId: id, revision, safeToActivate: simulation.safeToActivate },
      })
      if (simulation.safeToActivate !== true) return undefined
      await this.port.publishProposal(proposal)
      await this.port.appendSignal({
        id: signalId('collaboration-proposal-published', id, String(revision)),
        kind: PROPOSAL_PUBLISHED_KIND,
        occurredAt: now.toISOString(),
        data: { scopeKey: candidate.key, policyId: id, revision },
      })
      await this.port.writeCheckpoint(CHECKPOINT_NAMESPACE, 'proposal', { lastProposalAt: now.toISOString(), policyId: id, revision })
      return proposal
    } finally {
      this.evaluating = false
    }
  }

  private async observations(): Promise<Observation[]> {
    return (await this.port.recentSignals(OBSERVATION_KIND, 2000)).flatMap(signal => {
      const observation = observationFromSignal(signal)
      return observation ? [observation] : []
    }).reverse()
  }

  private evaluateScopes(observations: readonly Observation[]): ScopeEvaluation[] {
    const scopes = new Map<string, { kind: 'chat' | 'sender'; id: string; items: Observation[] }>()
    for (const observation of observations) {
      for (const [kind, id] of [['chat', observation.chatId], ['sender', observation.senderId]] as const) {
        if (!id) continue
        const key = `${kind}:${id}`
        const scope = scopes.get(key) ?? { kind, id, items: [] }
        scope.items.push(observation)
        scopes.set(key, scope)
      }
    }
    return [...scopes.entries()].map(([key, scope]) => {
      const reducible = scope.items.filter(item => item.difference === 'possible_noise' || item.difference === 'could_batch').length
      const protectedCount = scope.items.filter(item => item.attentionTier === 'realtime' || item.difference === 'possible_miss'
        || item.approvalRequired || item.researchDecision === 'start' || item.researchDecision === 'confirm'
        || item.intakeReasons.includes('@常东旭') || item.intakeReasons.some(reason => reason.startsWith('特别关注'))).length
      return { key, kind: scope.kind, id: scope.id, sampleCount: scope.items.length, reducible, protectedCount, confidence: reducible / scope.items.length }
    })
  }
}

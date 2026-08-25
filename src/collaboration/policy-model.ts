import {
  matchesPolicy,
  policyConditionFacts,
  validatePolicy,
  type PolicySchema,
} from '../policy/engine.js'
import type { PolicyDocument, PolicySample, PolicySimulation } from '../policy/types.js'

export type AssistantPolicyFact =
  | 'channel.chatType'
  | 'channel.external'
  | 'source.chatId'
  | 'source.senderId'
  | 'message.text'
  | 'message.mentionsOwner'
  | 'message.hasDeadline'
  | 'relation.kind'
  | 'business.tags'
  | 'attention.current'
  | 'urgency'

export interface AssistantPolicyEffect {
  readonly attention?: 'unchanged' | 'silent' | 'batch' | 'realtime'
  readonly task?: 'unchanged' | 'ignore' | 'upsert'
  readonly reply?: 'never' | 'draft' | 'ask'
  readonly settleMinutes?: number
  readonly addTags?: readonly string[]
}

export type AssistantPolicyDocument = PolicyDocument<AssistantPolicyEffect>

export interface AssistantPolicySimulation extends PolicySimulation {
  readonly silentCount: number
  readonly batchCount: number
  readonly realtimeCount: number
  readonly urgentSuppressedCount: number
}

const facts = new Set<AssistantPolicyFact>([
  'channel.chatType', 'channel.external', 'source.chatId', 'source.senderId',
  'message.text', 'message.mentionsOwner', 'message.hasDeadline', 'relation.kind',
  'business.tags', 'attention.current', 'urgency',
])

const schema: PolicySchema = {
  facts,
  validateEffect(value) {
    const effect = value as AssistantPolicyEffect
    if (effect.settleMinutes !== undefined && (!Number.isSafeInteger(effect.settleMinutes) || effect.settleMinutes < 0 || effect.settleMinutes > 1440)) {
      throw new Error('settleMinutes must be an integer from 0 to 1440')
    }
    if ((effect.addTags?.length ?? 0) > 5 || effect.addTags?.some((tag) => !tag.trim() || tag.length > 30)) {
      throw new Error('addTags supports at most five non-empty tags of 30 characters')
    }
    if (effect.reply === undefined && effect.attention === undefined && effect.task === undefined && effect.settleMinutes === undefined && effect.addTags === undefined) {
      throw new Error('policy must define at least one effect')
    }
  },
}

function valueAt(input: Readonly<Record<string, unknown>>, path: string): unknown {
  let current: unknown = input
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export function validateAssistantPolicy(document: AssistantPolicyDocument): void {
  validatePolicy(document, schema)
}

export function assistantPolicyRequiresApproval(document: AssistantPolicyDocument): boolean {
  return document.effect.attention === 'silent'
    || document.effect.attention === 'batch'
    || document.effect.task === 'ignore'
    || document.effect.reply !== undefined
}

export function simulateAssistantPolicy(document: AssistantPolicyDocument, samples: readonly PolicySample[]): AssistantPolicySimulation {
  validateAssistantPolicy(document)
  const matched = samples.filter((sample) => matchesPolicy(document.when, sample.facts))
  const attention = document.effect.attention
  const urgentSuppressedCount = matched.filter((sample) => {
    const urgency = valueAt(sample.facts, 'urgency')
    return urgency === 'urgent' && (attention === 'silent' || attention === 'batch' || document.effect.task === 'ignore')
  }).length
  const requiredFacts = [...policyConditionFacts(document.when)]
  const factsCovered = requiredFacts.every((requiredFact) => samples.some((sample) => valueAt(sample.facts, requiredFact) !== undefined))
  const coverageSufficient = !assistantPolicyRequiresApproval(document) || (samples.length >= 20 && factsCovered)
  return {
    sampleCount: samples.length,
    matchedCount: matched.length,
    silentCount: attention === 'silent' ? matched.length : 0,
    batchCount: attention === 'batch' ? matched.length : 0,
    realtimeCount: attention === 'realtime' ? matched.length : 0,
    urgentSuppressedCount,
    coverageSufficient,
    safeToActivate: urgentSuppressedCount === 0 && coverageSufficient,
    matchedSampleIds: matched.slice(0, 20).map((sample) => sample.id),
  }
}

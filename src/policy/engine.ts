import type {
  FactCondition,
  PolicyCondition,
  PolicyDocument,
  PolicySample,
  PolicySimulation,
} from './types.js'

const facts = new Set([
  'channel.chatType', 'channel.external', 'source.chatId', 'source.senderId',
  'message.text', 'message.mentionsOwner', 'message.hasDeadline', 'relation.kind',
  'business.tags', 'attention.current', 'urgency',
])
const operators = new Set(['eq', 'neq', 'contains', 'in', 'exists', 'gte', 'lte'])

function valueAt(input: Readonly<Record<string, unknown>>, path: string): unknown {
  let current: unknown = input
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function conditionFacts(condition: PolicyCondition, result = new Set<string>()): ReadonlySet<string> {
  if ('fact' in condition) {
    result.add(condition.fact)
    return result
  }
  if ('all' in condition || 'any' in condition) {
    const children = 'all' in condition ? condition.all : condition.any
    children.forEach((child) => conditionFacts(child, result))
    return result
  }
  return conditionFacts(condition.not, result)
}

function fact(condition: FactCondition, input: Readonly<Record<string, unknown>>): boolean {
  const actual = valueAt(input, condition.fact)
  switch (condition.op) {
    case 'exists': return condition.value === false ? actual === undefined : actual !== undefined
    case 'eq': return actual === condition.value
    case 'neq': return actual !== condition.value
    case 'contains':
      if (typeof actual === 'string' && typeof condition.value === 'string') return actual.includes(condition.value)
      if (Array.isArray(actual)) return actual.includes(condition.value)
      return false
    case 'in': return Array.isArray(condition.value) && condition.value.includes(actual as never)
    case 'gte': return typeof actual === 'number' && typeof condition.value === 'number' && actual >= condition.value
    case 'lte': return typeof actual === 'number' && typeof condition.value === 'number' && actual <= condition.value
  }
}

export function matchesPolicy(condition: PolicyCondition, input: Readonly<Record<string, unknown>>): boolean {
  if ('fact' in condition) return fact(condition, input)
  if ('all' in condition) return condition.all.every((item) => matchesPolicy(item, input))
  if ('any' in condition) return condition.any.some((item) => matchesPolicy(item, input))
  return !matchesPolicy(condition.not, input)
}

export function validatePolicy(document: PolicyDocument): void {
  if (document.version !== 1) throw new Error('policy version must be 1')
  if (!document.name.trim() || document.name.length > 80) throw new Error('policy name must contain 1-80 characters')
  if (document.description.length > 500) throw new Error('policy description exceeds 500 characters')
  if (!Number.isSafeInteger(document.priority) || document.priority < 0 || document.priority > 1000) {
    throw new Error('policy priority must be an integer from 0 to 1000')
  }
  let clauses = 0
  const walk = (condition: PolicyCondition, depth: number): void => {
    if (depth > 8) throw new Error('policy condition exceeds maximum depth 8')
    clauses += 1
    if (clauses > 40) throw new Error('policy condition exceeds maximum 40 clauses')
    if ('fact' in condition) {
      if (!facts.has(condition.fact)) throw new Error(`unsupported policy fact: ${condition.fact}`)
      if (!operators.has(condition.op)) throw new Error(`unsupported policy operator: ${condition.op}`)
      if (typeof condition.value === 'string' && condition.value.length > 500) throw new Error('policy value exceeds 500 characters')
      return
    }
    if ('all' in condition || 'any' in condition) {
      const children = 'all' in condition ? condition.all : condition.any
      if (children.length < 1 || children.length > 20) throw new Error('policy boolean group must contain 1-20 clauses')
      children.forEach((item) => walk(item, depth + 1))
      return
    }
    walk(condition.not, depth + 1)
  }
  walk(document.when, 1)
  const effect = document.effect
  if (effect.settleMinutes !== undefined && (!Number.isSafeInteger(effect.settleMinutes) || effect.settleMinutes < 0 || effect.settleMinutes > 1440)) {
    throw new Error('settleMinutes must be an integer from 0 to 1440')
  }
  if ((effect.addTags?.length ?? 0) > 5 || effect.addTags?.some((tag) => !tag.trim() || tag.length > 30)) {
    throw new Error('addTags supports at most five non-empty tags of 30 characters')
  }
  if (effect.reply === undefined && effect.attention === undefined && effect.task === undefined && effect.settleMinutes === undefined && effect.addTags === undefined) {
    throw new Error('policy must define at least one effect')
  }
  if (document.expiresAt && Number.isNaN(new Date(document.expiresAt).getTime())) throw new Error('expiresAt must be an ISO timestamp')
}

export function simulatePolicy(document: PolicyDocument, samples: readonly PolicySample[]): PolicySimulation {
  validatePolicy(document)
  const matched = samples.filter((sample) => matchesPolicy(document.when, sample.facts))
  const attention = document.effect.attention
  const urgentSuppressedCount = matched.filter((sample) => {
    const urgency = valueAt(sample.facts, 'urgency')
    return urgency === 'urgent' && (attention === 'silent' || attention === 'batch' || document.effect.task === 'ignore')
  }).length
  const requiredFacts = [...conditionFacts(document.when)]
  const factsCovered = requiredFacts.every((requiredFact) => samples.some((sample) => valueAt(sample.facts, requiredFact) !== undefined))
  const coverageSufficient = !policyRequiresApproval(document) || (samples.length >= 20 && factsCovered)
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

export function policyRequiresApproval(document: PolicyDocument): boolean {
  return document.effect.attention === 'silent'
    || document.effect.attention === 'batch'
    || document.effect.task === 'ignore'
    || document.effect.reply !== undefined
}

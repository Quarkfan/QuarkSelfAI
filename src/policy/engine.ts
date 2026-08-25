import type {
  FactCondition,
  PolicyCondition,
  PolicyDocument,
} from './types.js'

const operators = new Set(['eq', 'neq', 'contains', 'in', 'exists', 'gte', 'lte'])

function valueAt(input: Readonly<Record<string, unknown>>, path: string): unknown {
  let current: unknown = input
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
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

export interface PolicySchema {
  readonly facts: ReadonlySet<string>
  validateEffect(effect: object): void
}

export function policyConditionFacts(condition: PolicyCondition, result = new Set<string>()): ReadonlySet<string> {
  if ('fact' in condition) {
    result.add(condition.fact)
    return result
  }
  if ('all' in condition || 'any' in condition) {
    const children = 'all' in condition ? condition.all : condition.any
    children.forEach((child) => policyConditionFacts(child, result))
    return result
  }
  return policyConditionFacts(condition.not, result)
}

export function validatePolicy(document: PolicyDocument<object>, schema: PolicySchema): void {
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
      if (!schema.facts.has(condition.fact)) throw new Error(`unsupported policy fact: ${condition.fact}`)
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
  schema.validateEffect(document.effect)
  if (document.expiresAt && Number.isNaN(new Date(document.expiresAt).getTime())) throw new Error('expiresAt must be an ISO timestamp')
}
